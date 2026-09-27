/**
 * 渲染进程入口（对应 index.html 里的 #root）。
 *
 * 这里只做三件事：挂数据 Provider、渲染 App、引入全局样式。
 * 注意 StrictMode：开发模式下 effect 会被故意调用两次，所以任何 effect 都必须可重复执行
 * （比如"开始计时"必须自带幂等判断，不能一执行就多开一个计时段）。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { WorkbenchProvider } from './store';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <WorkbenchProvider>
        <App />
      </WorkbenchProvider>
    </React.StrictMode>,
  );
}
