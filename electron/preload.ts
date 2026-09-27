/**
 * 预加载脚本：界面与系统之间**唯一**的通道。
 *
 * 安全模型：界面运行在沙箱里（contextIsolation: true、nodeIntegration: false），
 * 它没有 fs、没有 path、碰不到磁盘。想做任何"系统级"的事，
 * 只能调用这里用 contextBridge 明确暴露出去的那几个方法，
 * 而且每个方法背后在主进程都有对应的校验。
 *
 * 所以想给界面加新能力时，正确做法是：preload 加一个方法 → main.ts 加一个
 * ipcMain.handle 实现。**不要**为了省事去打开 nodeIntegration。
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { Db, Settings } from '../src/types';

export interface LoadResult {
  db: Db;
  dataDir: string;
  dbFile: string;
  backupDir: string;
}

const api = {
  load: (): Promise<LoadResult> => ipcRenderer.invoke('workbench:load'),
  save: (db: Db): Promise<boolean> => ipcRenderer.invoke('workbench:save', db),
  notify: (title: string, body: string): Promise<boolean> => ipcRenderer.invoke('workbench:notify', { title, body }),
  getAutoLaunch: (): Promise<boolean> => ipcRenderer.invoke('workbench:get-auto-launch'),
  setAutoLaunch: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('workbench:set-auto-launch', enabled),
  openPath: (target: 'data' | 'backup'): Promise<boolean> => ipcRenderer.invoke('workbench:open-path', target),
  exportFile: (defaultName: string, content: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('workbench:export', { defaultName, content }),
  importFile: (): Promise<{ ok: boolean; db?: Db; path?: string; error?: string }> => ipcRenderer.invoke('workbench:import'),
  createShortcut: (): Promise<{ ok: boolean; path?: string; error?: string }> => ipcRenderer.invoke('workbench:create-shortcut'),
  /** 用系统浏览器打开外部链接（比如 GitHub 的 Release 页）；只允许 https */
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('workbench:open-external', url),
  /** 应用版本号（打包时写进 exe 的，跟 package.json 一致） */
  appVersion: (): Promise<string> => ipcRenderer.invoke('workbench:app-version'),
  windowAction: (action: 'minimize' | 'maximize' | 'close' | 'toggle-float'): Promise<boolean> =>
    ipcRenderer.invoke('workbench:window', action),
  onSettingsChanged: (cb: (settings: Settings) => void): (() => void) => {
    const listener = (_e: unknown, settings: Settings) => cb(settings);
    ipcRenderer.on('workbench:settings-changed', listener);
    return () => ipcRenderer.removeListener('workbench:settings-changed', listener);
  },
};

contextBridge.exposeInMainWorld('workbench', api);

export type WorkbenchApi = typeof api;
