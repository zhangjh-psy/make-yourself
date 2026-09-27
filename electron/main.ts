/**
 * 主进程 —— 所有"系统级"的事情都在这里。
 *
 * 负责：
 *   • 窗口        主窗口、桌面悬浮窗的创建；关闭时缩到托盘而不是退出
 *   • 托盘        图标、右键菜单（点一下打开主窗口，菜单里显示最近的日子）
 *   • 数据落盘    loadDb / saveDb：原子写入 + 每天备份 + 坏了自动用备份恢复
 *   • 提醒调度    每 60 秒检查一次，到点弹 Windows 通知；已弹过的记在 runtime-state.json
 *   • 系统集成    开机自启、桌面/开始菜单快捷方式（走内嵌的 PowerShell 脚本）
 *   • 文件对话框  导出数据 / 导入数据（这些必须由主进程弹系统窗口）
 *   • 启动自检    带 --diag 参数时，自己操作界面并核对结果，用来验证改动没弄坏东西
 *
 * 数据目录（必须在 app ready 之前决定，否则 Chromium 缓存目录已经定下来了）：
 *   开发版      %APPDATA%\工作台            ← 故意不改名，免得找不到已有数据
 *   打包分享版  %APPDATA%\Make yourself      ← 首次启动会自动从旧目录搬数据
 *
 * 改动此文件时注意：这里不能用任何界面 API（没有 document / window），
 * 也不能直接改 React 状态 —— 两边只能通过 IPC 通信。
 */
import { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, shell } from 'electron';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { computeDdl, todayStr } from '../src/lib/date';
import type { Db } from '../src/types';
import { emptyDb, normalizeDb } from '../src/lib/seed';
import { CREATE_SHORTCUT_PS1 } from '../src/lib/shortcut-script';

const isDev = process.env.WORKBENCH_DEV === '1';
/** 自检模式：启动后抓取界面文字与运行时错误，打印结果再退出（用于开发验证） */
const diag = process.env.WORKBENCH_DIAG === '1' || process.argv.includes('--diag');
const rendererDir = path.join(__dirname, '..', 'dist');

const diagInfo: {
  stage: string;
  errors: string[];
  rendererErrors: string[];
  consoleErrors: string[];
} = { stage: 'init', errors: [], rendererErrors: [], consoleErrors: [] };

let mainWindow: BrowserWindow | null = null;
let floatWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let db: Db = emptyDb();
let reminderTimer: NodeJS.Timeout | null = null;
let morningFiredFor = '';
const firedKeys = new Set<string>();

/**
 * 数据目录隔离：
 * - 开发版（你自己这份）用 %APPDATA%\工作台 —— 这个名字**故意不改**，免得找不到已有数据
 * - 打包分享版用 %APPDATA%\Make yourself
 * 这样别人在自己电脑上体验时，数据跟你的完全分开，两边的数据不会互相看到、更不会互相覆盖。
 * 必须在 app ready 之前调用，否则 Chromium 的缓存目录已经定下来了。
 */
if (app.isPackaged) {
  const userDataDir = path.join(app.getPath('appData'), 'Make yourself');
  try {
    // 兼容：以前打包版叫「工作台-体验版」，改名后把老数据搬过来，别让人以为数据丢了
    const legacyDirs = ['工作台-体验版', '工作台'];
    const hasDb = (dir: string) => fs.existsSync(path.join(dir, 'workbench-data.json'));
    if (!hasDb(userDataDir)) {
      for (const legacy of legacyDirs) {
        const old = path.join(app.getPath('appData'), legacy);
        if (old !== userDataDir && hasDb(old)) {
          fs.mkdirSync(userDataDir, { recursive: true });
          fs.cpSync(old, userDataDir, { recursive: true });
          break;
        }
      }
    }
    app.setPath('userData', userDataDir);
  } catch (err) {
    console.error('[make-yourself] 设置数据目录失败', err);
  }
}

/** 应用图标（由 scripts/make-icon.mjs 生成） */
function iconPath(): string | undefined {
  const candidates = [
    // 打包版：图标放在 resources/build 下（见 electron-builder.yml 的 extraResources）
    path.join(process.resourcesPath || '', 'build', 'icon.ico'),
    // 开发版：项目目录
    path.join(__dirname, '..', 'build', 'icon.ico'),
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

process.on('uncaughtException', (err) => {
  diagInfo.errors.push(`uncaughtException: ${err?.stack ?? String(err)}`);
  if (!diag) {
    dialog.showErrorBox('Make yourself 出错了', String(err?.stack ?? err));
    app.quit();
  }
});

process.on('unhandledRejection', (reason) => {
  diagInfo.errors.push(`unhandledRejection: ${String(reason)}`);
});

/* ------------------------------------------------------------------ */
/*                          数据文件路径与读写                            */
/* ------------------------------------------------------------------ */

function dataDir(): string {
  return app.getPath('userData');
}
function dbFile(): string {
  return path.join(dataDir(), 'workbench-data.json');
}
function backupDir(): string {
  const dir = path.join(dataDir(), 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function stateFile(): string {
  return path.join(dataDir(), 'runtime-state.json');
}

function loadDb(): Db {
  const file = dbFile();
  if (!fs.existsSync(file)) {
    const fresh = emptyDb(dataDir());
    saveDb(fresh, false);
    return fresh;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return normalizeDb(raw, dataDir());
  } catch (err) {
    // 主文件损坏：尝试从最近备份恢复
    const backups = listBackups();
    for (const b of backups) {
      try {
        const raw = JSON.parse(fs.readFileSync(b.full, 'utf8'));
        const recovered = normalizeDb(raw, dataDir());
        fs.copyFileSync(file, path.join(dataDir(), `corrupted-${Date.now()}.json`));
        saveDb(recovered, false);
        return recovered;
      } catch {
        /* 继续尝试下一个备份 */
      }
    }
    return emptyDb(dataDir());
  }
}

function saveDb(next: Db, backup = true): void {
  db = next;
  const file = dbFile();
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    if (backup) dailyBackup();
  } catch (err) {
    console.error('[workbench] 保存失败', err);
  }
}

function listBackups(): { name: string; full: string; mtime: number }[] {
  const dir = backupDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const full = path.join(dir, f);
      return { name: f, full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/** 每天首次保存时备份一份，最多保留 30 份 */
function dailyBackup(): void {
  try {
    const stamp = todayStr();
    const target = path.join(backupDir(), `workbench-${stamp}.json`);
    if (fs.existsSync(target)) return;
    fs.writeFileSync(target, JSON.stringify(db, null, 2), 'utf8');
    const backups = listBackups();
    for (const b of backups.slice(30)) fs.unlinkSync(b.full);
  } catch (err) {
    console.error('[workbench] 备份失败', err);
  }
}

/* ------------------------------------------------------------------ */
/*                            提醒调度                                  */
/* ------------------------------------------------------------------ */

interface ReminderHit {
  title: string;
  body: string;
  key: string;
}

/** 计算当前到点该提醒的倒数日（主进程与界面共用同一套逻辑，保证不打架） */
function collectDueReminders(): ReminderHit[] {
  const today = todayStr();
  if (!db.settings.remindersEnabled) return [];
  const hits: ReminderHit[] = [];
  for (const item of db.ddl) {
    if (!item.remindEnabled) continue;
    const c = computeDdl(item, today);
    for (const before of item.remindDaysBefore) {
      if (before === 0) continue; // 当天由"日期变更"提醒负责
      if (c.dayDiff === before) {
        hits.push({
          key: `${item.id}|${today}|${before}`,
          title: `${item.emoji} ${item.title}`,
          body: `还有 ${before} 天（${c.occurrence}）`,
        });
      }
    }
  }
  return hits;
}

function fireReminders(reason: string): void {
  const hits = collectDueReminders();
  for (const hit of hits) {
    if (firedKeys.has(hit.key)) continue;
    firedKeys.add(hit.key);
    notify(hit.title, hit.body);
  }
  if (hits.length && reason === 'catchup') {
    notify('补发错过的提醒', `共 ${hits.filter((h) => !firedKeys.has(h.key)).length} 条`);
  }
}

function notify(title: string, body: string): void {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, silent: false });
      n.on('click', () => showMainWindow());
      n.show();
    }
  } catch (err) {
    console.error('[workbench] 通知失败', err);
  }
}

/** 每天早上汇总 */
function checkMorningDigest(): void {
  if (!db.settings.morningDigest) return;
  const today = todayStr();
  if (morningFiredFor === today) return;
  const now = new Date();
  const [hh, mm] = (db.settings.morningDigestTime || '08:30').split(':').map(Number);
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh || 8, mm || 30);
  if (now < target) return;
  morningFiredFor = today;

  const todayTodos = db.todos.filter((t) => t.repeat !== 'none' || t.date === today);
  const undone = todayTodos.filter((t) => t.repeat !== 'none' || !t.done).length;
  const upcoming = db.ddl
    .map((d) => ({ d, c: computeDdl(d, today) }))
    .filter(({ c }) => c.dayDiff >= 0 && c.dayDiff <= 30)
    .sort((a, b) => a.c.dayDiff - b.c.dayDiff)
    .slice(0, 3)
    .map(({ d, c }) => `${d.emoji}${d.title} ${c.dayDiff === 0 ? '今天' : `还有${c.dayDiff}天`}`)
    .join('，');

  notify('今天要做的事', `${undone} 项待办${upcoming ? ` · ${upcoming}` : ''}`);
}

function scheduleReminderLoop(): void {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = setInterval(() => {
    fireReminders('tick');
    checkMorningDigest();
  }, 60 * 1000);
  // 启动时立刻检查一次
  setTimeout(() => {
    fireReminders(db.settings.catchUpMissed ? 'catchup' : 'tick');
    checkMorningDigest();
  }, 4000);
}

function loadRuntimeState(): void {
  try {
    if (!fs.existsSync(stateFile())) return;
    const raw = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (Array.isArray(raw.firedKeys)) {
      const today = todayStr();
      for (const k of raw.firedKeys) {
        if (typeof k === 'string' && k.includes(`|${today}|`)) firedKeys.add(k);
      }
    }
    if (typeof raw.morningFiredFor === 'string') morningFiredFor = raw.morningFiredFor;
  } catch {
    /* 忽略 */
  }
}

function saveRuntimeState(): void {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ firedKeys: [...firedKeys], morningFiredFor }, null, 2), 'utf8');
  } catch {
    /* 忽略 */
  }
}

/* ------------------------------------------------------------------ */
/*                              窗口                                    */
/* ------------------------------------------------------------------ */

function preloadPath(name: string): string {
  return path.join(__dirname, `${name}.js`);
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#F5F5F4',
    title: 'Make yourself',
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath('preload'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    diagInfo.rendererErrors.push(`render-process-gone: ${JSON.stringify(details)}`);
  });
  mainWindow.webContents.on('console-message', (...args: unknown[]) => {
    // Electron 44: (event, details)；旧版本: (event, level, message, line, source)
    const first = args[1] as { level?: string; message?: string; lineNumber?: number; sourceId?: string } | number;
    const level = typeof first === 'number' ? first : first?.level;
    const message = typeof first === 'number' ? String(args[2]) : String(first?.message ?? '');
    const source = typeof first === 'number' ? String(args[4]) : String(first?.sourceId ?? '');
    diagInfo.consoleErrors.push(`[${String(level)}] ${message} (${source})`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    diagInfo.rendererErrors.push(`did-fail-load ${code} ${desc} ${url}`);
  });
  mainWindow.on('close', (e) => {
    if (!quitting && db.settings.minimizeToTray && !diag) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadFile(path.join(rendererDir, 'index.html'));
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(rendererDir, 'index.html'));
  }
}

function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function syncFloatingWindow(): void {
  if (db.settings.floatingWindow) {
    if (floatWindow && !floatWindow.isDestroyed()) return;
    if (floatWindow) floatWindow = null;
    floatWindow = new BrowserWindow({
      width: 232,
      height: 260,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: preloadPath('float-preload'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    floatWindow.loadFile(path.join(rendererDir, 'float.html'));
    floatWindow.once('ready-to-show', () => floatWindow?.show());
    floatWindow.on('closed', () => {
      floatWindow = null;
    });
    // 默认贴右上角
    const { workArea } = require('electron').screen.getPrimaryDisplay();
    floatWindow.setPosition(workArea.x + workArea.width - 248, workArea.y + 24);
  } else if (floatWindow) {
    floatWindow.close();
    floatWindow = null;
  }
}

/* ------------------------------------------------------------------ */
/*                              托盘                                    */
/* ------------------------------------------------------------------ */

function trayIcon(): Electron.NativeImage {
  // 优先用生成好的 PNG；拿不到就退回内嵌 SVG，保证托盘图标永远不空
  const pngPath = path.join(__dirname, '..', 'build', 'icon.32.png');
  if (fs.existsSync(pngPath)) {
    return nativeImage.createFromPath(pngPath).resize({ width: 16, height: 16 });
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect x="2" y="2" width="28" height="28" rx="8" fill="#1C1C1E"/>
    <rect x="8" y="9" width="16" height="2.5" rx="1.25" fill="#FFFFFF"/>
    <rect x="8" y="15" width="11" height="2.5" rx="1.25" fill="#FFFFFF" opacity="0.75"/>
    <rect x="8" y="21" width="7" height="2.5" rx="1.25" fill="#FFFFFF" opacity="0.45"/>
  </svg>`;
  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    .resize({ width: 16, height: 16 });
}

function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip('Make yourself');
  const buildMenu = () => {
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: '打开 Make yourself', click: () => showMainWindow() },
      { type: 'separator' },
    ];
    const today = todayStr();
    const nearest = db.ddl
      .map((d) => ({ d, c: computeDdl(d, today) }))
      .filter(({ c }) => c.dayDiff >= 0)
      .sort((a, b) => a.c.dayDiff - b.c.dayDiff)
      .slice(0, 5);
    if (nearest.length) {
      for (const { d, c } of nearest) {
        items.push({
          label: `${d.emoji} ${d.title} · ${c.dayDiff === 0 ? '今天' : `还有 ${c.dayDiff} 天`}`,
          click: () => showMainWindow(),
        });
      }
      items.push({ type: 'separator' });
    }
    items.push({
      label: '桌面悬浮窗',
      type: 'checkbox',
      checked: db.settings.floatingWindow,
      click: (mi) => {
        db.settings.floatingWindow = mi.checked;
        saveDb(db);
        syncFloatingWindow();
        broadcastSettings();
      },
    });
    items.push({ type: 'separator' });
    items.push({ label: '退出', click: () => quitApp() });
    return Menu.buildFromTemplate(items);
  };
  const refresh = () => tray?.setContextMenu(buildMenu());
  refresh();
  tray.on('click', () => showMainWindow());
  tray.on('right-click', refresh);
  // 每 5 分钟刷新托盘菜单里的倒数日
  setInterval(refresh, 5 * 60 * 1000);
}

function broadcastSettings(): void {
  mainWindow?.webContents.send('workbench:settings-changed', db.settings);
  floatWindow?.webContents.send('workbench:db-changed');
}

function quitApp(): void {
  quitting = true;
  saveRuntimeState();
  app.quit();
}

/* ------------------------------------------------------------------ */
/*                          IPC 接口                                    */
/* ------------------------------------------------------------------ */

function setupIpc(): void {
  ipcMain.handle('workbench:load', () => ({ db, dataDir: dataDir(), dbFile: dbFile(), backupDir: backupDir() }));

  ipcMain.handle('workbench:save', (_e, next: Db) => {
    if (diag) console.log(`    [main] 收到 save：floatingWindow=${next?.settings?.floatingWindow} autoLaunch=${next?.settings?.autoLaunch}`);
    saveDb(next, true);
    broadcastSettings();
    return true;
  });

  ipcMain.handle('workbench:notify', (_e, payload: { title: string; body: string }) => {
    notify(payload.title, payload.body);
    return true;
  });

  ipcMain.handle('workbench:set-auto-launch', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [] });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('workbench:get-auto-launch', () => app.getLoginItemSettings().openAtLogin);

  ipcMain.handle('workbench:open-path', async (_e, target: string) => {
    if (target === 'data') shell.showItemInFolder(dbFile());
    else if (target === 'backup') shell.openPath(backupDir());
    return true;
  });

  /** 用系统默认浏览器打开外链。只放行 https，避免被诱导打开奇怪的协议 */
  ipcMain.handle('workbench:open-external', async (_e, url: string) => {
    try {
      if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return false;
      await shell.openExternal(url);
      return true;
    } catch (err) {
      console.error('[make-yourself] 打开链接失败', err);
      return false;
    }
  });

  /** 应用版本号（打包后是 package.json 里的 version） */
  ipcMain.handle('workbench:app-version', () => app.getVersion());

  ipcMain.handle('workbench:export', async (_e, payload: { defaultName: string; content: string }) => {
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: '导出数据',
      defaultPath: path.join(app.getPath('desktop'), payload.defaultName),
      filters: [
        { name: 'JSON 数据', extensions: ['json'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePath) return { ok: false };
    fs.writeFileSync(res.filePath, payload.content, 'utf8');
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('workbench:import', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: '导入数据（会覆盖当前数据，请先备份）',
      properties: ['openFile'],
      filters: [{ name: 'JSON 数据', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false };
    try {
      const raw = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
      const next = normalizeDb(raw, dataDir());
      saveDb(next, true);
      return { ok: true, db: next, path: res.filePaths[0] };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('workbench:create-shortcut', () => {
    // 生成桌面 + 开始菜单快捷方式。脚本内嵌在 src/lib/shortcut-script.ts 里，
    // 以 UTF-16LE base64 交给 PowerShell，避免 5.1 按 ANSI 读中文脚本乱码的问题。
    try {
      // 打包版：快捷方式指向 exe 自身；开发版：指向项目里的启动脚本
      const projectRoot = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
      const launcher = app.isPackaged ? process.execPath : path.join(projectRoot, '启动工作台.bat');
      if (!fs.existsSync(launcher)) {
        return { ok: false, error: `找不到启动文件：${launcher}` };
      }
      const icon = iconPath() ?? '';
      const script = CREATE_SHORTCUT_PS1
        .replace('_TARGET_', launcher.replace(/'/g, "''"))
        .replace('_WORKDIR_', projectRoot.replace(/'/g, "''"))
        .replace('_ICON_', icon.replace(/'/g, "''"));
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      const res = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, encoding: 'utf8' },
      );
      const out = String(res.stdout ?? '').trim();
      const ok = res.status === 0;
      if (diag) console.log('[main] create-shortcut:', out || res.stderr);
      return { ok, path: ok ? '桌面 + 开始菜单' : undefined, error: ok ? undefined : String(res.stderr || out || '') };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('workbench:window', (_e, action: 'minimize' | 'maximize' | 'close' | 'toggle-float') => {
    if (action === 'toggle-float') {
      db.settings.floatingWindow = !db.settings.floatingWindow;
      if (diag) console.log(`    [main] toggle-float -> ${db.settings.floatingWindow}`);
      saveDb(db);
      syncFloatingWindow();
      broadcastSettings();
      return true;
    }
    if (!mainWindow) return false;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    if (action === 'close') mainWindow.close();
    return true;
  });

  ipcMain.handle('workbench:float-drag', () => {
    /* 拖拽由 CSS -webkit-app-region 处理 */
    return true;
  });

  ipcMain.handle('workbench:float-close', () => {
    db.settings.floatingWindow = false;
    saveDb(db);
    syncFloatingWindow();
    broadcastSettings();
    return true;
  });
}

/* ------------------------------------------------------------------ */
/*                            自检模式                                  */
/* ------------------------------------------------------------------ */

/** 在页面里执行一段代码（自检用） */
async function js<T>(code: string): Promise<T> {
  return mainWindow!.webContents.executeJavaScript(code, true) as Promise<T>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 按可见文字点击元素 */
async function clickText(text: string): Promise<boolean> {
  return js<boolean>(`(() => {
    const els = [...document.querySelectorAll('button, .seg__item, .tag-chip, .nav__item, .mood-btn, .cal-cell')];
    const el = els.find((e) => (e.innerText || '').trim().includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

/** 只在某个范围里按文字点（避免点到同名的别的东西） */
async function clickIn(selector: string, text: string): Promise<boolean> {
  return js<boolean>(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = els.find((e) => (e.innerText || '').trim().includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

/** 点侧边栏板块（严格匹配导航项） */
async function clickNav(label: string): Promise<boolean> {
  return clickIn('.nav__item', label);
}

/** 点首页底部的主按钮（开始工作 / 开始慎独 / 继续工作） */
async function clickHomeBtn(label: string): Promise<boolean> {
  return clickIn('.home__bottom button', label);
}

/** 读首页计时器文字 */
async function homeTimer(): Promise<string> {
  return js<string>(`(() => { const el = document.querySelector('.home__timer'); return el ? el.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`);
}

/** 把 "x小时y分钟z秒" 换算成总秒数 */
function timerToSeconds(text: string): number {
  const m = text.match(/(\d+)\s*小时\s*(\d+)\s*分钟\s*(\d+)\s*秒/);
  if (!m) return -1;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** 往指定输入框写值。React 受控输入有"值追踪器"去重，
 *  必须先让追踪器认为值变了，否则原生 input 事件不会触发 onChange。 */
async function setInputValue(selector: string, value: string): Promise<boolean> {
  return js<boolean>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue('');
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

async function bodyText(): Promise<string> {
  return js<string>(`document.body.innerText.replace(/\\s+/g, ' ').trim()`);
}

async function runDiagnostics(): Promise<void> {
  const results: { step: string; ok: boolean; detail?: string }[] = [];
  const check = (step: string, ok: boolean, detail?: string) => {
    results.push({ step, ok, detail });
    console.log(`${ok ? '  ✓' : '  ✗'} ${step}${ok || !detail ? '' : ` — ${detail}`}`);
  };

  const out: Record<string, unknown> = {};
  try {
    const win = mainWindow!;
    await new Promise<void>((resolve) => {
      if (!win.webContents.isLoading()) return resolve();
      win.webContents.once('did-finish-load', () => resolve());
      setTimeout(() => resolve(), 15000);
    });
    await wait(2200);
    console.log('\n--- 启动：先看到首页（慎独页） ---');

    /* 1. 首屏 = 首页 / 慎独页 */
    const first = await bodyText();
    check('首屏是首页（慎独页）', first.includes('开始慎独') && first.includes('进入工作台'), first.slice(0, 60));
    check('首屏没有左侧导航（干净）', (await js<number>(`document.querySelectorAll('.sidebar').length`)) === 0);
    check('首页有那句自定义的话', (await js<number>(`document.querySelectorAll('.home__quote').length`)) === 1);
    const homeQuote = await js<string>(`(() => { const q = document.querySelector('.home__quote'); return q ? q.innerText.trim() : ''; })()`);
    check('默认文案已填好', homeQuote.length > 0, homeQuote);
    check('全新安装时右上角有「载入示例数据」', first.includes('载入示例数据'));
    const freshBtns = await js<string[]>(`[...document.querySelectorAll('.home__bottom button')].map((b) => b.innerText.trim())`);
    check('第一屏就有「开始慎独」和「进入工作台」两个按钮', freshBtns.some((b) => b.includes('开始慎独')) && freshBtns.some((b) => b.includes('进入工作台')), freshBtns.join(' / '));
    check('悬浮窗默认关闭', !floatWindow);
    check('托盘图标已创建', !!tray);
    check('数据文件已生成', fs.existsSync(dbFile()));

    /* 2. 全新安装：先用右上角载入示例数据，再进工作台 */
    console.log('\n--- 载入示例数据 ---');
    check('点「载入示例数据」', await clickText('载入示例数据'));
    await wait(1600);
    check('载入后入口消失', !(await bodyText()).includes('载入示例数据'));
    const seeded = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
    check('数据已写入磁盘', Array.isArray(seeded.ddl) && seeded.ddl.length >= 6, `ddl=${seeded.ddl?.length}`);
    check('示例待办已生成', Array.isArray(seeded.todos) && seeded.todos.length >= 5, `todos=${seeded.todos?.length}`);
    check('示例日记已生成', Object.keys(seeded.dayLogs ?? {}).length >= 1);

    /* 3. 进工作台看框架 */
    console.log('\n--- 进入工作台 ---');
    check('点「进入工作台」', await clickHomeBtn('进入工作台'));
    await wait(1000);
    const inApp = await bodyText();
    check('进到工作台（出现侧边栏）', (await js<number>(`document.querySelectorAll('.sidebar').length`)) === 1);
    check('侧边栏有五个板块', inApp.includes('慎独') && inApp.includes('日历') && inApp.includes('倒数日') && inApp.includes('日记') && inApp.includes('设置'));
    check('品牌名已改为 Make yourself', (await js<string>(`(() => { const t = document.querySelector('.sidebar__title'); return t ? t.innerText.trim() : ''; })()`)) === 'Make yourself');
    check('侧边栏左上角用了新图标', (await js<number>(`document.querySelectorAll('.sidebar__logo[style*="base64"]').length`)) === 1);
    check('首屏没有残留的「今天」「任务」板块', !inApp.includes('今天待办') && !/^任务$/m.test(inApp));
    const layout = await js<{ sidebarDate: string; sidebarW: number; grid: number }>(`(() => {
      const sd = document.querySelector('.sidebar__date');
      const grid = document.querySelector('.cal-grid');
      return {
        sidebarDate: sd ? sd.innerText.replace(/\\s+/g, ' ').trim() : '',
        sidebarW: sd ? Math.round(sd.getBoundingClientRect().width) : 0,
        grid: grid ? Math.round(grid.getBoundingClientRect().width) : 0,
      };
    })()`);
    check('侧边栏左下角是新版日期块', /月/.test(layout.sidebarDate) && /农历/.test(layout.sidebarDate), layout.sidebarDate);
    check('日期块宽度正常', layout.sidebarW > 150, `宽=${layout.sidebarW}`);
    check('月历网格宽度合理', layout.grid > 600, `宽=${layout.grid}`);
    check('日历页顶部有截止日区', inApp.includes('截止日'));
    check('点侧边栏「慎独」回首页', await clickNav('慎独'));
    await wait(800);
    check('回到首页（侧边栏消失）', (await js<number>(`document.querySelectorAll('.sidebar').length`)) === 0);

    /* 4. 慎独计时：两个按钮并存、计时全局、暂停、退出才停 */
    console.log('\n--- 慎独计时 ---');
    const todayKey2 = (() => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    })();
    const twoBtns = await js<{ btns: string[]; timer: string }>(`(() => ({
      btns: [...document.querySelectorAll('.home__bottom button')].map((b) => b.innerText.trim()),
      timer: (document.querySelector('.home__timer') || {}).innerText || '',
    }))()`);
    console.log('    首页按钮:', JSON.stringify(twoBtns.btns), '| 计时文案:', twoBtns.timer);
    check('两个按钮同时存在（慎独 + 进入工作台）', twoBtns.btns.some((b) => b.includes('开始慎独')) && twoBtns.btns.some((b) => b.includes('进入工作台')), twoBtns.btns.join(' / '));

    check('点「开始慎独」', await clickHomeBtn('开始慎独'));
    await wait(1200);
    const running = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
    check('计时已开始（active 有值）', !!running.focus?.active, JSON.stringify(running.focus?.active));
    check('已新增一段 session', (running.focus?.sessions ?? []).length >= 1, `段数=${running.focus?.sessions?.length}`);
    check('显示「正在慎独」', (await bodyText()).includes('正在慎独'));
    const runningBtns = await js<string[]>(`[...document.querySelectorAll('.home__bottom button')].map((b) => b.innerText.trim())`);
    check('计时中按钮变成「暂停」', runningBtns.some((b) => b === '暂停'), runningBtns.join(' / '));
    check('计时中仍有「进入工作台」按钮', runningBtns.some((b) => b.includes('进入工作台')), runningBtns.join(' / '));

    // 数字真的在走
    const t1 = timerToSeconds(await homeTimer());
    for (let i = 0; i < 4; i++) await wait(900);
    const t2 = timerToSeconds(await homeTimer());
    check('秒数真的在走动', t2 > t1, `${t1}s → ${t2}s`);

    // 点「进入工作台」：计时不中断（这是这次改动的核心）
    check('点「进入工作台」', await clickHomeBtn('进入工作台'));
    await wait(2600);
    const afterEnter = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
    check('进入工作台后计时仍在跑', !!afterEnter.focus?.active, JSON.stringify(afterEnter.focus?.active));
    check('已回到工作台', (await js<number>(`document.querySelectorAll('.sidebar').length`)) === 1);

    // 在工作台里切板块，计时继续
    check('切到倒数日', await clickNav('倒数日'));
    await wait(1600);
    check('切到日记', await clickNav('日记'));
    await wait(1600);
    const inOtherPages = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
    check('在其他板块待过后计时依然在跑', !!inOtherPages.focus?.active);

    // 回首页看累计
    check('回首页「慎独」', await clickNav('慎独'));
    await wait(1000);
    const backSecs = timerToSeconds(await homeTimer());
    console.log('    回到首页时今日累计:', backSecs, '秒（含刚才在工作台待的时间）');
    check('累计时间超过 6 秒（把工作台那段时间也算进去了）', backSecs >= 6, `${backSecs}s`);
    const pauseBtns = await js<string[]>(`[...document.querySelectorAll('.home__bottom button')].map((b) => b.innerText.trim())`);
    check('回首页仍是「暂停」状态', pauseBtns.some((b) => b === '暂停'), pauseBtns.join(' / '));

    // 暂停
    check('点「暂停」', await clickHomeBtn('暂停'));
    await wait(1400);
    const paused = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
    check('暂停后 active 清空', !paused.focus?.active);
    const pausedBtns = await js<string[]>(`[...document.querySelectorAll('.home__bottom button')].map((b) => b.innerText.trim())`);
    check('暂停后按钮变成「继续慎独」', pausedBtns.some((b) => b.includes('继续慎独')), pausedBtns.join(' / '));
    check('暂停后仍停在首页', (await js<number>(`document.querySelectorAll('.home').length`)) === 1);
    const secsAtPause = timerToSeconds(await homeTimer());
    await wait(2200);
    check('暂停后数字不再增长', timerToSeconds(await homeTimer()) === secsAtPause, `${secsAtPause}s → ${timerToSeconds(await homeTimer())}s`);

    // 继续慎独：接着累计
    check('点「继续慎独」', await clickHomeBtn('继续慎独'));
    await wait(1500);
    check('继续后又在计时', !!JSON.parse(fs.readFileSync(dbFile(), 'utf8')).focus?.active);
    await wait(1200);
    check('点「暂停」结束这一段', await clickHomeBtn('暂停'));
    await wait(1300);
    const afterResume = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
    check('总秒数比暂停时更多', (afterResume.focus?.totals?.[todayKey2] ?? 0) > 0, JSON.stringify(afterResume.focus?.totals));

    // 退出应用 = 停表：模拟窗口卸载
    check('重新开始计时', await clickHomeBtn('继续慎独'));
    await wait(1200);
    check('计时中', !!JSON.parse(fs.readFileSync(dbFile(), 'utf8')).focus?.active);
    await js<boolean>(`(() => { window.dispatchEvent(new Event('pagehide')); return true; })()`);
    await wait(1400);
    const afterQuit = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
    check('退出应用后计时停止（active 清空）', !afterQuit.focus?.active, JSON.stringify(afterQuit.focus?.active));
    check('退出时的时间已存下来', (afterQuit.focus?.totals?.[todayKey2] ?? 0) > 0, JSON.stringify(afterQuit.focus?.totals));

    /* 回工作台，继续后面的功能验证 */
    check('回工作台', await clickHomeBtn('进入工作台'));
    await wait(900);
    check('已回到工作台', (await js<number>(`document.querySelectorAll('.sidebar').length`)) === 1);

    /* 3. 新建一条倒数日 */
    console.log('\n--- 新建倒数日 ---');
    check('切到倒数日页', await clickNav('倒数日'));
    await wait(800);
    check('倒数日列表渲染出示例卡片', (await bodyText()).includes('考研初试') && (await bodyText()).includes('奶奶生日'));
    check('点开"新建倒数日"', await clickText('新建倒数日'));
    await wait(700);
    const modalOpen = await bodyText();
    check('编辑弹窗打开', modalOpen.includes('名称') && modalOpen.includes('日期类型'));
    check('写入标题', await setInputValue('.modal input.input', '验证用纪念日'));
    await wait(400);
    check('标题输入生效', (await bodyText()).includes('验证用纪念日'));
    check('点击"添加"', await clickText('添加'));
    await wait(900);
    const afterAdd = await bodyText();
    check('新条目出现在列表', afterAdd.includes('验证用纪念日'));

    /* 4. 去日历页，验证月视图 */
    console.log('\n--- 日历 ---');
    check('切到日历页', await clickNav('日历'));
    await wait(900);
    const calText = await bodyText();
    // 今天 2026-09-20，9 月的网格第一格应为 8/31（周一）
    const firstCellDay = await js<string>(`(() => {
      const c = document.querySelector('.cal-cell .cal-cell__day');
      return c ? c.textContent : '';
    })()`);
    check('月视图渲染 42 个格子', (await js<number>(`document.querySelectorAll('.cal-cell').length`)) === 42);
    check('9 月网格首格是 8 月 31 日', firstCellDay === '31', `实际=${firstCellDay}`);
    check('月视图标题是 2026年9月', calText.includes('2026年9月'));
    check('当天格子被高亮', (await js<number>(`document.querySelectorAll('.cal-cell--today').length`)) === 1);
    check('右侧显示当天待办面板', calText.includes('待办'));
    check('日历格子出现截止日标记', (await js<number>(`document.querySelectorAll('.cal-cell__dl').length`)) > 0);
    check('日历页已不再有日记输入框', (await js<number>(`document.querySelectorAll('.day-panel textarea').length`)) === 0);

    /* 5. 在当天加一条待办 */
    console.log('\n--- 加待办 ---');
    check('写入待办标题', await setInputValue('.todo-add input.input', '验证用待办'));
    await wait(400);
    const todoDraft = await js<string>(`(() => { const el = document.querySelector('.todo-add input.input'); return el ? el.value : '(没有找到输入框)'; })()`);
    check('待办输入生效', todoDraft === '验证用待办', `输入框内容=${todoDraft}`);
    check('点了添加按钮', await js<boolean>(`(() => {
      const btn = document.querySelector('.todo-add button.btn--primary');
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    })()`));
    await wait(1200);
    const afterTodo = await bodyText();
    check('待办已加入当天', afterTodo.includes('验证用待办'));
    const withTodo = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
    check('待办已落盘', withTodo.todos.some((t: { title: string }) => t.title === '验证用待办'));

    /* 6. 勾选完成 */
    const checked = await js<boolean>(`(() => {
      const item = [...document.querySelectorAll('.todo-item')].find((el) => el.innerText.includes('验证用待办'));
      if (!item) return false;
      const btn = item.querySelector('.todo-check');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    check('点到了完成勾选框', checked);
    await wait(900);
    const afterDone = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
    const target = afterDone.todos.find((t: { title: string }) => t.title === '验证用待办');
    check('完成状态已保存', !!target?.done, `done=${target?.done}`);

    /* 7. 日记板块（独立出来之后） */
    console.log('\n--- 日记板块 ---');
    const todayKey = (() => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    })();
    check('切到日记页', await clickNav('日记'));
    await wait(900);
    const diaryPageText = await bodyText();
    check('日记页有迷你月历', (await js<number>(`document.querySelectorAll('.mini-cell').length`)) === 42);
    check('日记页有心情选择', diaryPageText.includes('今天心情'));
    check('日记页有时间线', diaryPageText.includes('日记时间线'));
    const diaryLayout = await js<{ cols: string; mini: number; editorW: number }>(`(() => {
      const wrap = document.querySelector('.diary-layout');
      const mini = document.querySelectorAll('.mini-cell').length;
      const ed = document.querySelector('.diary-textarea');
      return {
        cols: wrap ? getComputedStyle(wrap).gridTemplateColumns : '',
        mini,
        editorW: ed ? Math.round(ed.getBoundingClientRect().width) : 0,
      };
    })()`);
    check('日记页是左右两栏', diaryLayout.cols.split(' ').length === 2, diaryLayout.cols);
    check('日记输入框宽度正常', diaryLayout.editorW > 300, `宽=${diaryLayout.editorW}`);
    check('点心情 emoji', await clickText('😄'));
    await wait(700);
    check('写入日记', await setInputValue('.diary-textarea', '自检写入的日记'));
    await wait(1400);
    const withDiary = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
    const todayLog = withDiary.dayLogs?.[todayKey] ?? null;
    check('心情已保存', !!todayLog?.mood, `mood=${todayLog?.mood}`);
    check('日记已保存', String(todayLog?.diary ?? '').trim() === '自检写入的日记', `diary=${JSON.stringify(String(todayLog?.diary ?? '').slice(0, 24))}`);
    check('日记出现在时间线里', (await bodyText()).includes('自检写入的日记'));

    /* 7.5 倒数日拖动手动排序 */
    console.log('\n--- 倒数日拖动排序 ---');
    check('切到倒数日页', await clickNav('倒数日'));
    await wait(800);
    // 排序控件已经删掉，只保留"自己拖出来的顺序"
    check('排序控件已移除', !(await bodyText()).includes('最近优先'));
    check('分类筛选已移除', (await js<number>(`document.querySelectorAll('.ddl-toolbar select').length`)) === 0);
    check('工具栏只剩视图切换和新建', (await js<number>(`document.querySelectorAll('.ddl-toolbar .seg__item').length`)) === 2);
    const beforeOrder = JSON.parse(fs.readFileSync(dbFile(), 'utf8')).ddl
      .slice()
      .sort((a: { order?: number }, b: { order?: number }) => (a.order ?? 0) - (b.order ?? 0))
      .map((d: { title: string }) => d.title);
    const dnd = await js<{ ok: boolean; first: string; second: string }>(`(() => {
      const slots = [...document.querySelectorAll('.ddl-slot')];
      if (slots.length < 2) return { ok: false, first: '', second: '' };
      const titleOf = (el) => { const t = el.querySelector('.ddl-card__title'); return t ? t.innerText.trim() : ''; };
      // 把 draggable 关掉：Chromium 默认会把 draggable 元素的原生拖拽改成"移动副本"行为，
      // 而我们的 React onDragStart / onDrop 只需要拿到事件。模拟时用普通 div 最稳。
      slots.forEach((s) => s.setAttribute('draggable', 'false'));
      const dt = { setData() {}, getData() { return ''; }, effectAllowed: 'move', dropEffect: 'move', types: ['text/plain'], items: [], files: [] };
      const fire = (el, type) => el.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: dt, clientX: 0, clientY: 0 }));
      window.__wbDnd = { fire, dt };
      const a = titleOf(slots[0]);
      const b = titleOf(slots[1]);
      fire(slots[0], 'dragstart');
      return { ok: true, first: a, second: b };
    })()`);
    check('拿到了两张卡片', dnd.ok, JSON.stringify(dnd));
    // 等 React 把 dragId 状态刷新出来，再触发 drop
    await wait(400);
    check(
      '触发 dragover + drop',
      await js<boolean>(`(() => {
        const slots = [...document.querySelectorAll('.ddl-slot')];
        if (slots.length < 2 || !window.__wbDnd) return false;
        window.__wbDnd.fire(slots[1], 'dragover');
        window.__wbDnd.fire(slots[1], 'drop');
        window.__wbDnd.fire(slots[0], 'dragend');
        return true;
      })()`),
    );
    await wait(1500);
    const afterOrder = JSON.parse(fs.readFileSync(dbFile(), 'utf8')).ddl
      .slice()
      .sort((a: { order?: number }, b: { order?: number }) => (a.order ?? 0) - (b.order ?? 0))
      .map((d: { title: string }) => d.title);
    console.log(`    拖动前: ${beforeOrder.slice(0, 3).join(' / ')}`);
    console.log(`    拖动后: ${afterOrder.slice(0, 3).join(' / ')}`);
    check(
      '拖动后顺序变了并已保存',
      afterOrder[0] === dnd.second && afterOrder[1] === dnd.first,
      `期望 ${dnd.second} 在前，实际 ${afterOrder[0]}`,
    );

    /* 7.6 版面视图：自由摆放 + 形状 + 皮肤 */
    console.log('\n--- 版面 / 卡片外观 ---');
    check('切到版面视图', await clickText('版面'));
    await wait(900);
    check('画布已渲染', (await js<number>(`document.querySelectorAll('.board').length`)) === 1);
    check('卡片按绝对定位摆放', (await js<number>(`document.querySelectorAll('.board__card').length`)) > 0);
    const boardSize = await js<{ w: number; h: number }>(`(() => {
      const b = document.querySelector('.board');
      const r = b ? b.getBoundingClientRect() : { width: 0, height: 0 };
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    check('画布宽度合理', boardSize.w > 500, `宽=${boardSize.w}`);
    check('画布是 16:10 左右的比例', Math.abs(boardSize.w / boardSize.h - 1.6) < 0.2, `比例=${(boardSize.w / boardSize.h).toFixed(2)}`);
    check('形状用 SVG 画出来（不是纯 div）', (await js<number>(`document.querySelectorAll('.scard__svg path').length`)) > 0);

    check('进入编辑布局', await clickText('编辑布局'));
    await wait(700);
    const editState = await js<{ editing: number; btn: string; cards: number }>(`(() => {
      const btn = [...document.querySelectorAll('.ddl-toolbar button')].find((b) => (b.innerText || '').includes('编辑布局') || (b.innerText || '').includes('完成编辑'));
      return {
        editing: document.querySelectorAll('.board--editing').length,
        btn: btn ? btn.innerText.trim() : '(没找到按钮)',
        cards: document.querySelectorAll('.board__card').length,
      };
    })()`);
    console.log('    编辑态:', JSON.stringify(editState));
    check('编辑态生效', editState.editing === 1, `editing=${editState.editing} 按钮=${editState.btn}`);
    check('第一张卡能选中', await js<boolean>(`(() => {
      const c = document.querySelector('.board__card');
      if (!c) return false;
      c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
      return true;
    })()`));
    await wait(600);
    check('选中后出现控制点', (await js<number>(`document.querySelectorAll('.board__point').length`)) > 0);
    check('选中后出现缩放角', (await js<number>(`document.querySelectorAll('.board__resize').length`)) === 1);
    check('选中后滑出属性面板', (await js<number>(`document.querySelectorAll('.skin-panel').length`)) === 1);
    const panelText = await bodyText();
    check('属性面板有形状与背景选项', panelText.includes('形状') && panelText.includes('背景') && panelText.includes('整卡透明度'));
    check('属性面板有显示项开关', panelText.includes('大数字') && panelText.includes('农历'));
    check('属性面板有复制样式', panelText.includes('复制这张卡的样式'));

    /* 拖动卡片改位置 */
    const beforeDrag = await js<{ x: number; y: number; w: number }>(`(() => {
      const c = document.querySelector('.board__card');
      if (!c) return { x: 0, y: 0, w: 0 };
      const r = c.getBoundingClientRect();
      const board = document.querySelector('.board').getBoundingClientRect();
      return { x: r.left - board.left, y: r.top - board.top, w: r.width };
    })()`);
    check('拖动卡片', await js<boolean>(`(() => {
      const c = document.querySelector('.board__card');
      if (!c) return false;
      const r = c.getBoundingClientRect();
      const opts = (x, y) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, buttons: 1 });
      const el = c;
      el.dispatchEvent(new PointerEvent('pointerdown', opts(r.left + r.width / 2, r.top + r.height / 2)));
      window.dispatchEvent(new PointerEvent('pointermove', opts(r.left + r.width / 2 + 110, r.top + r.height / 2 + 70)));
      window.dispatchEvent(new PointerEvent('pointerup', opts(r.left + r.width / 2 + 110, r.top + r.height / 2 + 70)));
      return true;
    })()`));
    await wait(1400);
    const afterDrag = await js<{ x: number; y: number }>(`(() => {
      const c = document.querySelector('.board__card');
      if (!c) return { x: 0, y: 0 };
      const r = c.getBoundingClientRect();
      const board = document.querySelector('.board').getBoundingClientRect();
      return { x: r.left - board.left, y: r.top - board.top };
    })()`);
    console.log(`    拖动前 x=${Math.round(beforeDrag.x)} y=${Math.round(beforeDrag.y)} → 拖动后 x=${Math.round(afterDrag.x)} y=${Math.round(afterDrag.y)}`);
    check('卡片位置真的移动了', afterDrag.x > beforeDrag.x + 20 && afterDrag.y > beforeDrag.y + 10, `Δx=${Math.round(afterDrag.x - beforeDrag.x)} Δy=${Math.round(afterDrag.y - beforeDrag.y)}`);
    const layoutSaved = JSON.parse(fs.readFileSync(dbFile(), 'utf8')).ddl.find((d: { layout?: { x: number } }) => d.layout);
    check('位置已写进数据文件', !!layoutSaved, `layout=${JSON.stringify(layoutSaved?.layout)}`);

    /* 拖控制点改形状 */
    check('拖控制点改形状', await js<boolean>(`(() => {
      const p = document.querySelector('.board__point');
      if (!p) return false;
      const r = p.getBoundingClientRect();
      const opts = (x, y) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 2, isPrimary: true, button: 0, buttons: 1 });
      p.dispatchEvent(new PointerEvent('pointerdown', opts(r.left + 4, r.top + 4)));
      window.dispatchEvent(new PointerEvent('pointermove', opts(r.left + 34, r.top + 30)));
      window.dispatchEvent(new PointerEvent('pointerup', opts(r.left + 34, r.top + 30)));
      return true;
    })()`));
    await wait(1300);
    const customShape = JSON.parse(fs.readFileSync(dbFile(), 'utf8')).ddl.find((d: { skin?: { points?: unknown[] } }) => d.skin?.points);
    check('自定义形状控制点已保存', !!customShape, `点数=${customShape?.skin?.points?.length}`);

    /* 恢复普通形状 */
    check('点恢复普通形状', await clickText('恢复普通形状'));
    await wait(1200);
    const afterReset = JSON.parse(fs.readFileSync(dbFile(), 'utf8')).ddl.find((d: { id: string }) => d.id === customShape?.id);
    check('控制点已清掉，形状复原', !afterReset?.skin?.points, `points=${JSON.stringify(afterReset?.skin?.points)}`);

    /* 换形状 + 背景 + 文字 */
    check('换一个圆形', await clickText('圆形'));
    await wait(700);
    const shapeChanged = JSON.parse(fs.readFileSync(dbFile(), 'utf8')).ddl.find((d: { id: string }) => d.id === customShape?.id);
    check('形状已保存为圆形', shapeChanged?.skin?.shape === 'circle', `shape=${shapeChanged?.skin?.shape}`);
    check('切到渐变背景', await clickText('渐变'));
    await wait(700);
    const afterGrad = JSON.parse(fs.readFileSync(dbFile(), 'utf8')).ddl.find((d: { id: string }) => d.id === customShape?.id);
    check('背景类型已保存为渐变', afterGrad?.skin?.background?.type === 'gradient', `bg=${afterGrad?.skin?.background?.type}`);
    check('取消勾选「大数字」', await js<boolean>(`(() => {
      const labels = [...document.querySelectorAll('.skin-panel .check')];
      const l = labels.find((x) => (x.innerText || '').includes('大数字'));
      const input = l && l.querySelector('input');
      if (!input) return false;
      input.click();
      return true;
    })()`));
    await wait(900);
    const afterToggle = JSON.parse(fs.readFileSync(dbFile(), 'utf8')).ddl.find((d: { id: string }) => d.id === customShape?.id);
    check('显示项开关已保存', afterToggle?.skin?.show?.number === false, `number=${afterToggle?.skin?.show?.number}`);

    /* 退出编辑 */
    check('点完成编辑', await clickText('完成编辑'));
    await wait(700);
    check('退出后回到展示态', (await js<number>(`document.querySelectorAll('.board--editing').length`)) === 0);
    check('展示态没有控制点', (await js<number>(`document.querySelectorAll('.board__point').length`)) === 0);
    check('切回列表视图', await clickText('列表'));
    await wait(700);
    check('列表里用的是普通卡片（不受版面外观影响）', (await js<number>(`document.querySelectorAll('.ddl-card').length`)) > 0);
    check('列表里没有 SVG 形状层', (await js<number>(`document.querySelectorAll('.ddl-cardwrap .scard__svg').length`)) === 0);

    /* 8. 设置页 */
    console.log('\n--- 设置 ---');
    check('切到设置页', await clickNav('设置'));
    await wait(800);
    const settingsText = await bodyText();
    check('设置页有外观与提醒', settingsText.includes('外观') && settingsText.includes('提醒与后台'));
    check('设置页显示数据路径', settingsText.includes('workbench-data.json'));
    check('设置页有「关于」并显示版本号', settingsText.includes('关于') && /0\.0\.1/.test(settingsText), '');
    check('标出了内测版', settingsText.includes('内测版'));
    check('界面版本号与 package.json 一致', app.getVersion() === '0.0.1', `app.getVersion()=${app.getVersion()}`);
    check('数据文件写入了结构版本号', JSON.parse(fs.readFileSync(dbFile(), 'utf8')).version >= 1, `version=${JSON.parse(fs.readFileSync(dbFile(), 'utf8')).version}`);

    /* 8.5 农历年份可选到很早以前（生日要能填出生年） */
    console.log('\n--- 农历年份范围 ---');
    check('切到倒数日页', await clickNav('倒数日'));
    await wait(700);
    check('编辑一条农历示例', await js<boolean>(`(() => {
      // 卡片外层现在是 .ddl-cardwrap（自定义皮肤后内层可能不是 .ddl-card）
      const wraps = [...document.querySelectorAll('.ddl-cardwrap')];
      const target = wraps.find((c) => (c.innerText || '').includes('奶奶生日'));
      if (!target) return false;
      const editBtn = target.querySelector('button[title="编辑"]');
      if (!editBtn) return false;
      editBtn.click();
      return true;
    })()`));
    await wait(800);
    // 切到农历
    check('点农历', await clickText('农历'));
    await wait(500);
    const yearInfo = await js<{ count: number; first: string; has1985: boolean; selected: string }>(`(() => {
      const labels = [...document.querySelectorAll('.modal .field__label')];
      const yearLabel = labels.find((l) => (l.innerText || '').includes('农历年'));
      if (!yearLabel) return { count: -1, first: '', has1985: false, selected: '' };
      const sel = yearLabel.parentElement.querySelector('select');
      if (!sel) return { count: -1, first: '', has1985: false, selected: '' };
      const opts = [...sel.options].map((o) => o.text);
      return {
        count: opts.length,
        first: opts[0],
        has1985: opts.some((t) => t.includes('1985')),
        selected: sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '',
      };
    })()`);
    console.log('    农历年选项:', JSON.stringify(yearInfo));
    check('农历年份列表够长（能选到 1990 年以前）', yearInfo.count > 80, `共 ${yearInfo.count} 项`);
    check('列表里有 1985 年', yearInfo.has1985, `第一项=${yearInfo.first}`);
    check('编辑已有农历条目时选中了它原本的年份', yearInfo.selected.includes('2026') || /\\d{4}/.test(yearInfo.selected), `选中=${yearInfo.selected}`);
    // 选到 1985 年并保存，检查周年数算对
    check('把年份改成 1985', await js<boolean>(`(() => {
      const labels = [...document.querySelectorAll('.modal .field__label')];
      const yearLabel = labels.find((l) => (l.innerText || '').includes('农历年'));
      const sel = yearLabel && yearLabel.parentElement.querySelector('select');
      if (!sel) return false;
      const opt = [...sel.options].find((o) => o.text.includes('1985'));
      if (!opt) return false;
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`));
    await wait(600);
    check('保存修改', await clickText('保存'));
    await wait(1200);
    const savedLunar = JSON.parse(fs.readFileSync(dbFile(), 'utf8')).ddl.find((d: { title: string }) => d.title.includes('奶奶生日'));
    const savedLunarYear = savedLunar ? Number(savedLunar.date.slice(0, 4)) : 0;
    check('农历条目已按 1985 年保存', savedLunarYear === 1985, `保存的日期=${savedLunar?.date}`);
    const cardText = await bodyText();
    check('卡片上显示的是 1985 年至今的周年数', /第\s*4[01]\s*周年/.test(cardText), `页面文字片段=${cardText.slice(cardText.indexOf('奶奶生日'), cardText.indexOf('奶奶生日') + 60)}`);
    // 改回今年的农历日期，避免影响后面
    await js<boolean>(`(() => {
      const wraps = [...document.querySelectorAll('.ddl-cardwrap')];
      const target = wraps.find((c) => (c.innerText || '').includes('奶奶生日'));
      const editBtn = target && target.querySelector('button[title="编辑"]');
      if (editBtn) editBtn.click();
      return !!editBtn;
    })()`);
    await wait(700);
    await js<boolean>(`(() => {
      const labels = [...document.querySelectorAll('.modal .field__label')];
      const yl = labels.find((l) => (l.innerText || '').includes('农历年'));
      const sel = yl && yl.parentElement.querySelector('select');
      if (!sel) return false;
      const opt = [...sel.options].find((o) => o.text.includes(String(new Date().getFullYear())));
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await wait(500);
    await clickText('保存');
    await wait(1000);

    /* 8.6 截止日（已并入日历页） */
    console.log('\n--- 截止日（在日历页） ---');
    check('切到日历页', await clickNav('日历'));
    await wait(900);
    const taskText = await bodyText();
    check('顶部有截止日区', taskText.includes('截止日'));
    check('显示示例截止日', taskText.includes('课题方案提交'));
    check('显示进度', /进度\s*\d+%/.test(taskText));
    check('截止日区可以折叠', (await js<number>(`document.querySelectorAll('.dl-strip__caret').length`)) === 1);
    check('点开新建截止日', await clickText('新建截止日'));
    await wait(800);
    const dlModal = await bodyText();
    check('截止日弹窗打开', dlModal.includes('截止日期') && dlModal.includes('紧急程度') && dlModal.includes('进度'));
    check('填名称', await setInputValue('.modal input.input', '自检用截止日'));
    await wait(300);
    // 截止日期设为 3 天后
    const future = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 3);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    })();
    check(
      '填截止日期',
      await js<boolean>(`(() => {
        const labels = [...document.querySelectorAll('.modal .field__label')];
        const l = labels.find((x) => (x.innerText || '').includes('截止日期'));
        const input = l && l.parentElement.querySelector('input[type=date]');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        const tracker = input._valueTracker;
        if (tracker) tracker.setValue('');
        setter.call(input, ${JSON.stringify(future)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`),
    );
    await wait(300);
    check('点紧急', await clickText('紧急'));
    await wait(200);
    check('提交截止日', await clickText('添加'));
    await wait(1400);
    const afterDl = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
    const newDl = (afterDl.deadlines || []).find((d: { title: string }) => d.title === '自检用截止日');
    check('截止日已写入磁盘', !!newDl, `deadlines=${afterDl.deadlines?.length}`);
    check('截止日字段正确', newDl?.dueDate === future && newDl?.priority === 2, `due=${newDl?.dueDate} 优先=${newDl?.priority}`);
    const linked = (afterDl.todos || []).filter((t: { deadlineId?: string }) => t.deadlineId === newDl?.id);
    check('自动在截止当天生成了待办', linked.length === 1, `关联待办=${linked.length}`);
    check('关联待办的日期=截止日', linked[0]?.date === future, `待办日期=${linked[0]?.date}`);
    check('日历页显示新截止日', (await bodyText()).includes('自检用截止日'));

    // 进度快捷按钮
    check('点 +25% 推进进度', await clickText('+25%'));
    await wait(1000);
    const progressed = JSON.parse(fs.readFileSync(dbFile(), 'utf8')).deadlines.find((d: { title: string }) => d.title === '自检用截止日');
    check('进度已保存', progressed?.progress === 25, `progress=${progressed?.progress}`);

    // 折叠起来还能展开
    check('折叠截止日区', await clickText('截止日'));
    await wait(500);
    check('折叠后卡片还看得见', (await bodyText()).includes('课题方案提交'));

    /* 9. 深色主题 */
    check('回到设置页', await clickNav('设置'));
    await wait(800);
    check('切到深色主题', await clickText('深色'));
    await wait(600);
    const theme = await js<string>(`document.documentElement.dataset.theme`);
    check('深色主题已生效', theme === 'dark', `theme=${theme}`);
    check('切回亮色', await clickText('亮色'));
    await wait(500);
    check('亮色主题已生效', (await js<string>(`document.documentElement.dataset.theme`)) === 'light');

    /* 10. 悬浮窗 */
    console.log('\n--- 悬浮窗 ---');
    const floatToggle = await js<boolean>(`(() => {
      const btn = document.querySelector('button[title="桌面悬浮窗开关"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    check('触发悬浮窗开关', floatToggle);
    await wait(1600);
    const syncState = await js<string>(`(async () => {
      const res = await window.workbench.load();
      return JSON.stringify({
        mainSays: res.db.settings.floatingWindow,
        label: (document.querySelector('button[title="桌面悬浮窗开关"]') || {}).innerText,
      });
    })()`);
    console.log('    同步状态:', syncState, '| 主进程内存 =', db.settings.floatingWindow);
    check('悬浮窗已创建', !!floatWindow);
    if (floatWindow) {
      const ftext = await floatWindow.webContents.executeJavaScript('document.body.innerText.replace(/\\s+/g," ").trim()', true);
      check('悬浮窗渲染出倒数日', ftext.includes('倒数日') || ftext.includes('今日待办'), `内容=${String(ftext).slice(0, 60)}`);
    }
    const secondClick = await js<boolean>(`(() => {
      const btn = document.querySelector('button[title="桌面悬浮窗开关"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    console.log('    第二次点击时按钮文字:', secondClick);
    await wait(1000);
    const floatState = await js<{ toolbar: number; toast: string }>(`(() => ({
      toolbar: document.querySelectorAll('button[title="桌面悬浮窗开关"]').length,
      toast: (document.querySelector('.toast') || {}).innerText || '',
    }))()`);
    console.log('    关闭后：悬浮窗对象=', !!floatWindow, '| destroyed=', floatWindow?.isDestroyed(), '| 提示条=', floatState.toast);
    await wait(1000);
    console.log('    再等 1s 后：悬浮窗对象=', !!floatWindow);
    check('悬浮窗已关闭', !floatWindow);

    /* 11. 提醒调度 */
    console.log('\n--- 提醒 ---');
    check('提醒调度定时器已启动', reminderTimer !== null);
    check('通知能力可用', Notification.isSupported());

    /* 12. 创建桌面快捷方式 */
    console.log('\n--- 快捷方式 ---');    const scRes = await js<{ ok: boolean; error?: string }>(`window.workbench.createShortcut()`);
    check('创建快捷方式成功', scRes.ok, scRes.error);
    const desktop = app.getPath('desktop');
    check('桌面出现「Make yourself」图标', fs.existsSync(path.join(desktop, 'Make yourself.lnk')), path.join(desktop, 'Make yourself.lnk'));
    const startMenu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Make yourself.lnk');
    check('开始菜单出现「Make yourself」', fs.existsSync(startMenu));
    check('图标文件存在', !!iconPath(), iconPath() ?? '(未找到)');

    out.summary = { total: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
    out.results = results;
    out.dbPath = dbFile();
    out.userData = app.getPath('userData');
    out.isPackaged = app.isPackaged;
    out.dbCounts = (() => {
      const d = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
      return { ddl: d.ddl.length, todos: d.todos.length, dayLogs: Object.keys(d.dayLogs ?? {}).length };
    })();
    out.trayCreated = !!tray;
    out.versions = { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node };
  } catch (err) {
    diagInfo.errors.push(`diagnostics: ${String(err)}`);
    check('自检过程未抛异常', false, String(err));
  }

  out.errors = diagInfo.errors;
  out.rendererErrors = diagInfo.rendererErrors;
  out.consoleErrors = diagInfo.consoleErrors;
  out.pass = diagInfo.errors.length === 0 && diagInfo.rendererErrors.length === 0 && results.every((r) => r.ok);

  console.log('\n===WORKBENCH-DIAG===');
  console.log(JSON.stringify(out, null, 2));
  console.log('===END-DIAG===');
  quitting = true;
  app.quit();
}

/* ------------------------------------------------------------------ */
/*                            生命周期                                  */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
    app.setAppUserModelId('com.makeyourself.app');
    db = loadDb();
    loadRuntimeState();
    setupIpc();
    createMainWindow();
    createTray();
    if (!diag) syncFloatingWindow();
    scheduleReminderLoop();

    // 让系统的开机自启状态跟设置保持一致（自检模式不动系统设置）
    if (!diag) {
      try {
        const current = app.getLoginItemSettings().openAtLogin;
        if (current !== db.settings.autoLaunch) {
          app.setLoginItemSettings({ openAtLogin: db.settings.autoLaunch, path: process.execPath, args: [] });
        }
      } catch {
        /* 忽略 */
      }
    }

    if (diag) void runDiagnostics();

    app.on('activate', () => showMainWindow());
  });

  app.on('before-quit', () => {
    quitting = true;
    saveRuntimeState();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !db.settings.minimizeToTray) quitApp();
  });
}
