/**
 * 便携版冒烟测试：启动打包好的 exe，确认窗口真的出来了，然后关掉。
 * 用法： node scripts/smoke-portable.mjs
 *
 * 注意：
 *  1. 便携版会先把自己解压到临时目录再启动，进程名不一定是文件名，所以靠"窗口标题"识别。
 *  2. 直接 spawn 出来的进程在部分受限环境下起不来，这里用 cmd start 让它独立启动。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const exe = fs
  .readdirSync(releaseDir)
  .filter((f) => f.endsWith('.exe') && f.includes('便携版'))
  .map((f) => path.join(releaseDir, f))[0];

if (!exe) {
  console.error('release 目录里没找到便携版 exe，先执行 npm run pack');
  process.exit(1);
}
console.log('测试目标:', exe, `(${(fs.statSync(exe).size / 1048576).toFixed(1)} MB)`);

const ps = (command) =>
  String(
    spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true }).stdout || '',
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const before = ps("Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.MainWindowTitle }");

// 用 start 启动（见文件头说明）
const launched = spawnSync('cmd.exe', ['/c', 'start', '', exe], { windowsHide: true });
if (launched.status !== 0) {
  console.error('启动失败，退出码:', launched.status, String(launched.stderr || ''));
  process.exit(1);
}

let found = false;
let title = '';
for (let i = 1; i <= 30; i++) {
  await sleep(2000);
  const titles = ps("Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.MainWindowTitle }")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hit = titles.find((t) => t.includes('工作台') && !before.includes(t));
  if (hit) {
    found = true;
    title = hit;
    console.log(`第 ${i * 2} 秒：窗口已出现「${title}」`);
    break;
  }
}

// 清理
ps("Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*工作台-便携版*' -or $_.MainWindowTitle -eq '工作台' } | Stop-Process -Force -ErrorAction SilentlyContinue");

if (found) {
  console.log('便携版冒烟测试通过：窗口正常打开。');
  process.exit(0);
}
console.error('便携版没有在 60 秒内出现窗口。');
process.exit(1);
