/**
 * 应用外壳：决定「显示哪一屏」以及侧边栏导航。
 *
 * 结构上只有两种形态，互相切换：
 *   1. 首页 / 慎独页 —— 整屏展示，**不带左侧导航**（要的就是干净）
 *   2. 工作台 —— 左侧导航 + 顶部标题栏 + 右侧内容区
 *
 * 几个放在这一层（而不是各页面里）的原因：
 *   - 主题和强调色要写进 CSS 变量，全局生效
 *   - 开机自启是系统级设置，跟设置页表单无关，得整体同步
 *   - 「慎独计时」是全局的：开始之后去任何板块都继续算，
 *     所以"退出应用时停表"这个兜底放在这里，而不是慎独页里
 */
import React, { useEffect, useState } from 'react';
import { useWorkbench } from './store';
import { ToastProvider, useToast } from './components/Toast';
import { DdlPage } from './pages/DdlPage';
import { CalendarPage } from './pages/CalendarPage';
import { DiaryPage } from './pages/DiaryPage';
import { SettingsPage } from './pages/SettingsPage';
import { HomePage } from './pages/HomePage';
import { IconCalendar, IconDiary, IconHourglass, IconLeaf, IconSettings } from './components/Icons';
import { computeDdl, diffDays, parse, solarToLunar, todayStr, WEEKDAY_FULL } from './lib/date';
import { buildSeed } from './lib/seed';
import { ICON_PNG_BASE64 } from './icon-data';

/** 'home' 是首页/慎独页，它不显示左侧导航 */
export type PageKey = 'home' | 'calendar' | 'ddl' | 'diary' | 'settings';

const PAGES: { key: PageKey; label: string; icon: React.ReactNode; title: string }[] = [
  { key: 'home', label: '慎独', icon: <IconLeaf />, title: '慎独' },
  { key: 'calendar', label: '日历', icon: <IconCalendar />, title: '日历' },
  { key: 'ddl', label: '倒数日', icon: <IconHourglass />, title: '倒数日' },
  { key: 'diary', label: '日记', icon: <IconDiary />, title: '日记' },
  { key: 'settings', label: '设置', icon: <IconSettings />, title: '设置' },
];

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const { ready, db, replaceDb, markStarted, stopFocus } = useWorkbench();
  const toast = useToast();
  /* 打开 app 先看到首页（慎独页） */
  const [page, setPage] = useState<PageKey>('home');

  const today = todayStr();

  /**
   * 慎独计时是全局的：开始之后去哪个板块都继续算。
   * 所以"停表"只发生在两处：手动点暂停，或者应用要退出时（窗口即将关闭）。
   */
  const stopFocusRef = React.useRef(stopFocus);
  stopFocusRef.current = stopFocus;
  useEffect(() => {
    const onQuit = () => stopFocusRef.current();
    window.addEventListener('beforeunload', onQuit);
    window.addEventListener('pagehide', onQuit);
    return () => {
      window.removeEventListener('beforeunload', onQuit);
      window.removeEventListener('pagehide', onQuit);
    };
  }, []);

  /* 主题 + 强调色：写到 CSS 变量上 */
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = db.settings.theme;
    root.style.setProperty('--accent', db.settings.accent);
  }, [db.settings.theme, db.settings.accent]);

  /* 开机自启跟系统保持一致 */
  useEffect(() => {
    if (!ready) return;
    void window.workbench.setAutoLaunch(db.settings.autoLaunch);
  }, [ready, db.settings.autoLaunch]);

  /* 首次使用的引导交给首页（右上角「载入示例数据」），这里不再弹窗打断 */
  const loadDemo = () => {
    const seed = buildSeed();
    replaceDb({
      ...seed,
      settings: { ...db.settings, ...seed.settings, accent: db.settings.accent, theme: db.settings.theme, dataDir: db.settings.dataDir },
    });
    toast('示例数据已就位，随便改随便删');
  };

  const activePage = PAGES.find((p) => p.key === page) ?? PAGES[0];

  /* 截止日：过期数量 / 进行中，用于日历角标 */
  const activeDeadlines = db.deadlines.filter((d) => !d.done);
  const overdueDeadlines = activeDeadlines.filter((d) => diffDays(d.dueDate, today) < 0).length;
  const taskBadge = overdueDeadlines || activeDeadlines.length;

  /* 今天写日记了没，用于日记角标 */
  const todayDiary = !!(db.dayLogs[today]?.diary ?? '').trim();

  /* 最近的一个倒数日 */
  const nearest = db.ddl
    .map((d) => ({ d, c: computeDdl(d, today) }))
    .filter(({ c }) => c.dayDiff >= 0)
    .sort((a, b) => a.c.dayDiff - b.c.dayDiff)[0];

  const dateObj = parse(today);
  const lunar = solarToLunar(today);

  /* 首页 / 慎独页：不带左侧导航，整屏就一句话和背景 */
  if (ready && page === 'home') {
    const isFresh = db.ddl.length === 0 && db.todos.length === 0 && db.deadlines.length === 0 && !db.seeded;
    return (
      <HomePage
        started={!!db.ui?.started || !isFresh}
        onFirstStart={markStarted}
        onEnterApp={() => setPage('calendar')}
        firstRun={isFresh}
        onLoadDemo={() => {
          loadDemo();
        }}
      />
    );
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <button className="sidebar__brand" onClick={() => setPage('home')} title="回到慎独页">
          <span className="sidebar__logo" style={{ backgroundImage: `url(data:image/png;base64,${ICON_PNG_BASE64})` }} />
          <div className="sidebar__title">Make yourself</div>
        </button>

        <nav className="nav">
          {PAGES.map((p) => (
            <button
              key={p.key}
              className={`nav__item ${page === p.key ? 'nav__item--active' : ''}`}
              onClick={() => setPage(p.key)}
            >
              <span className="nav__icon">{p.icon}</span>
              <span>{p.label}</span>
              {p.key === 'calendar' && taskBadge > 0 && (
                <span className={`nav__badge ${overdueDeadlines ? 'nav__badge--danger' : 'nav__badge--accent'}`}>{taskBadge}</span>
              )}
              {p.key === 'ddl' && db.ddl.length > 0 && <span className="nav__badge">{db.ddl.length}</span>}
              {p.key === 'diary' && !todayDiary && <span className="nav__badge">·</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar__spacer" />

        <div className="sidebar__date">
          <div className="sidebar__date-main">
            {dateObj.getMonth() + 1} 月 {dateObj.getDate()} 日
          </div>
          <div className="sidebar__date-sub">
            {WEEKDAY_FULL[dateObj.getDay()]} · 农历{lunar.text}
            {lunar.festival ? ` · ${lunar.festival}` : ''}
          </div>
          <div className="sidebar__date-sub">
            {lunar.ganzhi}
            {lunar.zodiac}年
          </div>
        </div>

        {nearest && (
          <div className="sidebar__today" style={{ borderLeft: `3px solid ${nearest.d.color}` }}>
            <div className="sidebar__today-meta" style={{ marginTop: 0 }}>
              最近的日子
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {nearest.d.emoji} {nearest.d.title}
            </div>
            <div className="sidebar__today-meta">
              {nearest.c.dayDiff === 0 ? '就是今天' : `还有 ${nearest.c.dayDiff} 天`}
            </div>
          </div>
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar__title">{activePage.title}</div>          {page === 'ddl' && (
            <div className="topbar__sub">
              {WEEKDAY_FULL[dateObj.getDay()]} · 农历{lunar.text}
            </div>
          )}
          <div className="topbar__actions">
            <button
              className="btn btn--ghost btn--sm"
              title="桌面悬浮窗开关"
              onClick={async () => {
                // 先算出切换后的状态，再让主进程去改（不要读渲染层的旧快照）
                const next = !db.settings.floatingWindow;
                await window.workbench.windowAction('toggle-float');
                toast(next ? '悬浮窗已打开' : '悬浮窗已关闭');
              }}
            >
              {db.settings.floatingWindow ? '关闭悬浮窗' : '打开悬浮窗'}
            </button>
          </div>
        </header>

        <div className="page">
          <div className="page__inner">
            {!ready ? (
              <div className="empty">正在读取数据…</div>
            ) : page === 'ddl' ? (
              <DdlPage />
            ) : page === 'diary' ? (
              <DiaryPage />
            ) : page === 'calendar' ? (
              <CalendarPage />
            ) : (
              <SettingsPage onLoadDemo={loadDemo} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
