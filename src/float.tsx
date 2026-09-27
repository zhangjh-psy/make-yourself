/**
 * 桌面悬浮窗的界面（对应 float.html，是独立的第二个页面）。
 *
 * 和主界面共用数据文件，但**不共用数据层**：它太轻了（只读、不写），
 * 所以自己直接通过 float-preload 拿一份数据，每 60 秒刷新一次，
 * 主进程改动数据时会主动通知它重读，避免两边不一致。
 *
 * 显示内容由设置里的「悬浮窗内容」决定：只显示置顶 / 最近 4 条 / 今日待办。
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Db } from './types';
import { computeDdl, todayStr } from './lib/date';
import './styles.css';

interface FloatApi {
  load: () => Promise<{ db: Db }>;
  close: () => Promise<boolean>;
  onChanged: (cb: () => void) => () => void;
}

declare global {
  interface Window {
    floatApi: FloatApi;
  }
}

function FloatApp() {
  const [db, setDb] = useState<Db | null>(null);

  const refresh = async () => {
    try {
      const res = await window.floatApi.load();
      setDb(res.db);
    } catch {
      /* 忽略 */
    }
  };

  useEffect(() => {
    void refresh();
    const off = window.floatApi.onChanged(() => void refresh());
    const timer = window.setInterval(() => void refresh(), 60000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (db) {
      document.documentElement.dataset.theme = db.settings.theme;
      document.documentElement.style.setProperty('--accent', db.settings.accent);
    }
  }, [db]);

  if (!db) return <div className="float-root" />;

  const today = todayStr();
  const show = db.settings.floatingShow;

  let items: { key: string; emoji: string; title: string; value: string; color: string; sub?: string }[] = [];

  if (show === 'today') {
    const todos = db.todos.filter((t) => t.repeat !== 'none' || t.date === today);
    items = todos.slice(0, 6).map((t) => {
      const done =
        t.repeat === 'none' ? t.done : !!db.completions[`${t.id}|${today}`];
      return {
        key: t.id,
        emoji: done ? '✅' : t.dueTime ? '🕐' : '·',
        title: t.title,
        value: t.dueTime ?? '',
        color: t.color || db.settings.accent,
        sub: done ? '已完成' : undefined,
      };
    });
  } else {
    const list = db.ddl
      .filter((d) => (show === 'pinned' ? d.pinned : true))
      .map((d) => ({ d, c: computeDdl(d, today) }))
      .filter(({ c }) => c.dayDiff >= 0)
      .sort((a, b) => a.c.dayDiff - b.c.dayDiff)
      .slice(0, show === 'pinned' ? 6 : 4);

    const source = list.length ? list : db.ddl.map((d) => ({ d, c: computeDdl(d, today) })).sort((a, b) => a.c.dayDiff - b.c.dayDiff).slice(0, 4);

    items = source.map(({ d, c }) => ({
      key: d.id,
      emoji: d.emoji,
      title: d.title,
      value: c.dayDiff === 0 ? '今天' : String(c.dayDiff),
      color: d.color,
      sub: c.dayDiff === 0 ? undefined : '天',
    }));
  }

  return (
    <div className="float-root">
      <div className="float-head">
        <span className="float-title">
          {show === 'today' ? '今日待办' : '倒数日'}
        </span>
        <button className="float-close" onClick={() => void window.floatApi.close()} title="关闭悬浮窗">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="float-list">
        {items.length === 0 && <div className="float-empty">还没有数据</div>}
        {items.map((it) => (
          <div className="float-item" key={it.key} title={it.title}>
            <span className="float-item__emoji" style={{ color: it.color }}>
              {it.emoji}
            </span>
            <span className="float-item__title">{it.title}</span>
            <span className="float-item__num" style={{ color: it.color }}>
              {it.value}
              {it.sub && <span style={{ fontSize: 10, fontWeight: 500, marginLeft: 1, color: 'var(--text-3)' }}>{it.sub}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const container = document.getElementById('float-root');
if (container) createRoot(container).render(<FloatApp />);
