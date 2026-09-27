/**
 * 全局类型声明：让界面代码里的 window.workbench 有类型提示。
 * 具体暴露了哪些方法见 electron/preload.ts —— 那是界面唯一的"系统能力入口"，
 * 界面本身没有权限直接读写磁盘。
 */
import type { WorkbenchApi } from '../electron/preload';

declare global {
  interface Window {
    workbench: WorkbenchApi;
  }
}

export {};
