/**
 * 桌面悬浮窗的预加载脚本（比主界面的更小）。
 *
 * 悬浮窗是个独立的小窗口（见 main.ts 的 syncFloatingWindow），只需要四件事：
 *   load       读一份数据（只读，不写）
 *   close      关掉自己
 *   openMain   点一下切回主窗口
 *   onChanged  主进程数据变了就重读，保证和主界面显示一致
 *
 * 之所以单独写一个而不是复用主 preload：悬浮窗拿到的能力越少越安全，
 * 也避免它误改数据。
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { Db } from '../src/types';

contextBridge.exposeInMainWorld('floatApi', {
  load: (): Promise<{ db: Db }> => ipcRenderer.invoke('workbench:load'),
  close: (): Promise<boolean> => ipcRenderer.invoke('workbench:float-close'),
  openMain: (): Promise<boolean> => ipcRenderer.invoke('workbench:window', 'maximize'),
  onChanged: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on('workbench:db-changed', listener);
    return () => ipcRenderer.removeListener('workbench:db-changed', listener);
  },
});
