/**
 * 通用表单零件：弹窗、开关、勾选框、分段选择、字段包装、二次确认。
 *
 * 全应用只在这里定义一次，各页面直接用，保证所有弹窗/开关长得一样、行为一样：
 *   Modal        弹窗（Esc 关闭、点遮罩关闭）
 *   Switch       开关（设置项用）
 *   Check        勾选框（带自己的打勾图标，不用系统原生样式）
 *   Seg          分段选择（月/周、亮色/深色 这类二三个选项）
 *   Field        表单字段（标签 + 内容 + 说明文字）
 *   ConfirmModal 危险操作二次确认
 *   useDebouncedCallback  输入防抖（日记这类边打字边保存的地方用）
 *
 * 注意：这里是纯 UI，不碰数据。数据读写一律通过 store。
 */
import React, { useEffect } from 'react';
import { IconClose } from './Icons';

interface Props {
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  closeOnMask?: boolean;
}

export function Modal({ title, children, footer, onClose, wide, closeOnMask = true }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (closeOnMask && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${wide ? 'modal--wide' : ''}`}>
        <div className="modal__head">
          <div className="modal__title">{title}</div>
          <button className="modal__close" onClick={onClose} title="关闭">
            <IconClose />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Switch({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      className={`switch ${on ? 'switch--on' : ''}`}
      onClick={() => onChange(!on)}
      aria-pressed={on}
    >
      <span className="switch__knob" />
    </button>
  );
}

export function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check__box">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 12.5l5 5 10-11" />
        </svg>
      </span>
      <span className="check__label">{label}</span>
    </label>
  );
}

export function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          className={`seg__item ${value === o.value ? 'seg__item--active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <div className="field__label">{label}</div>
      {children}
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}

/** 需要二次确认的操作 */
export function ConfirmModal({
  title,
  message,
  confirmText = '确定',
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.75 }}>{message}</div>
    </Modal>
  );
}

/** 简单的防抖回调（日记等长文本自动保存用） */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delay = 500) {
  const ref = React.useRef<number | null>(null);
  const latest = React.useRef(fn);
  latest.current = fn;
  return React.useCallback(
    (...args: A) => {
      if (ref.current) window.clearTimeout(ref.current);
      ref.current = window.setTimeout(() => latest.current(...args), delay);
    },
    [delay],
  );
}
