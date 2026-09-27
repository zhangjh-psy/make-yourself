/**
 * 底部提示条（"已保存""已删除"这类一闪而过的反馈）。
 *
 * 用方式：任何组件里 `const toast = useToast()` 然后 `toast('文案')`。
 * 之所以做成全局的：提示要显示在屏幕底部居中、浮在所有内容之上，
 * 每个页面各自实现会有层级和定位的各种麻烦。
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext<(msg: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);

  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, msg }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 2600);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div className="toast" key={t.id}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
