/**
 * 数据层 —— 整个应用唯一读写数据的地方，界面组件一律通过 useWorkbench() 拿。
 *
 * 提供三类东西：
 *   1. 数据本身       db（整份数据）、dataDir / dbFile（文件在哪）
 *   2. 增删改方法     addTodo / updateDdl / addDeadline / setDayLog …
 *   3. 派生计算       todosOn(某天)、deadlineViews()、focusSeconds(某天) …
 *
 * 存盘策略（这是本文件最重要的设计）：
 *   改动先只更新内存（React state），**600ms 防抖后**才写盘，避免连续输入时频繁写文件。
 *   写盘由主进程负责用"原子写"（先写 .tmp 再改名），断电/崩溃不会写出半个文件。
 *
 * 两个踩过的坑，改动这里时务必注意：
 *
 *  ① **派生值必须是函数，不能是预先算好的数字**。
 *     写 `focusToday: 123` 这种字段，它会在 Provider 渲染那一刻被定死；
 *     本页每秒重渲染时拿到的还是旧值，表现为"计时数字卡住不动"。
 *     正确写法是 `focusSeconds: (date) => 实时算`。
 *
 *  ② **慎独的开始/结束必须是引用稳定的函数**（用 useCallback 且依赖为空）。
 *     因为首页用 useEffect 的清理函数来"退出时停表"，
 *     如果函数每次渲染都变，effect 会被反复清理+重建，刚开的计时会被自己停掉。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DayLog, Db, DdlItem, Deadline, DeadlineView, FocusState, HomeDisplay, Settings, Todo } from './types';
import { DEFAULT_SETTINGS } from './types';
import { emptyDb, normalizeDb, uid } from './lib/seed';
import { completionKey, computeDeadline, sortDeadlines, todoOccursOn, todayStr } from './lib/date';

export interface SaveResult {
  ok: boolean;
  count?: number;
  path?: string;
  sidecar?: string;
  error?: string;
}

interface Ctx {
  ready: boolean;
  db: Db;
  dataDir: string;
  dbFile: string;
  saveError: string | null;
  /** 手动保存（返回保存路径等信息，供"保存到文件"用） */
  save: () => Promise<SaveResult>;
  updateSettings: (patch: Partial<Settings>) => void;
  addDdl: (item: Partial<DdlItem> & { title: string; date: string }) => DdlItem;
  updateDdl: (id: string, patch: Partial<DdlItem>) => void;
  removeDdl: (id: string) => void;
  addTodo: (item: Partial<Todo> & { title: string; date: string }) => Todo;
  updateTodo: (id: string, patch: Partial<Todo>) => void;
  removeTodo: (id: string) => void;
  toggleTodo: (todo: Todo, date: string) => void;
  moveTodo: (id: string, date: string) => void;
  setDayLog: (date: string, patch: Partial<DayLog>) => void;
  todosOn: (date: string) => Todo[];
  isDone: (todo: Todo, date: string) => boolean;
  /* ---- 截止日 ---- */
  addDeadline: (item: Partial<Deadline> & { title: string; dueDate: string }) => Deadline;
  updateDeadline: (id: string, patch: Partial<Deadline>) => void;
  removeDeadline: (id: string) => void;
  /** 算好状态的截止日列表（默认全部） */
  deadlineViews: () => DeadlineView[];
  /** 某一天相关的截止日（截止当天，以及过期未完成的） */
  deadlinesOn: (date: string) => DeadlineView[];
  /** 把此刻应该存在的 deadline 关联待办补齐（打开软件时自动跑一次） */
  syncDeadlineTodos: () => void;
  /** 保存倒数日的手动排序（按传入的 id 顺序写 order 字段） */
  setDdlOrder: (ids: string[]) => void;
  /* ---- 慎独 ---- */
  /**
   * 某一天慎独了多少秒（含正在进行的那一段）。
   * 注意：这里必须是「函数」而不是预先算好的数字 ——
   * 预先算的值是在 Provider 渲染那一刻定死的，本页每秒重渲染时读到的会是旧值。
   */
  focusSeconds: (date: string) => number;
  /** 此刻是否正在计时 */
  focusRunning: boolean;
  /** 进入慎独页：开始计时（已在计时就什么都不做） */
  startFocus: () => void;
  /** 离开慎独页：结束这一段并累计 */
  stopFocus: () => void;
  /** 改首页/慎独页的外观 */
  updateHome: (patch: Partial<HomeDisplay>) => void;
  /** 记"今天已经进来过"（按钮文案从"开始工作"变成"开始慎独"） */
  markStarted: () => void;
  /** 慎独页面当前这一段的已计时秒数 */
  focusLastSession: (date: string) => number;
  replaceDb: (next: Db) => void;
  resetToDemo: () => void;
}

const WorkbenchContext = createContext<Ctx | null>(null);

export function useWorkbench(): Ctx {
  const ctx = useContext(WorkbenchContext);
  if (!ctx) throw new Error('useWorkbench 必须在 WorkbenchProvider 内使用');
  return ctx;
}

export function WorkbenchProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Db>(() => emptyDb());
  const [dataDir, setDataDir] = useState('');
  const [dbFile, setDbFile] = useState('');
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const timer = useRef<number | null>(null);
  const pending = useRef<Db | null>(null);
  const bootstrapped = useRef(false);
  const memoRunsRef = useRef(0);
  void memoRunsRef;

  /* 首次加载：从主进程拿数据 */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await window.workbench.load();
        if (!alive) return;
        setDataDir(res.dataDir);
        setDbFile(res.dbFile);
        let next = normalizeDb(res.db as unknown as Partial<Db>, res.dataDir);
        if (!next.seeded && next.ddl.length === 0 && next.todos.length === 0) {
          // 给一个干净的初始设置（示例数据由用户在设置页/首启时决定）
          next = { ...next, settings: { ...DEFAULT_SETTINGS, ...next.settings, dataDir: res.dataDir } };
        }
        setDb(next);
        bootstrapped.current = true;
        setReady(true);
      } catch (err) {
        setSaveError(`加载数据失败：${String(err)}`);
        setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const flush = useCallback(async (next: Db) => {
    try {
      await window.workbench.save(next);
      setSaveError(null);
    } catch (err) {
      setSaveError(`保存失败：${String(err)}`);
    }
  }, []);

  /** 自动保存：改动后 600ms 落盘一次，避免频繁写文件 */
  const scheduleSave = useCallback(
    (next: Db) => {
      pending.current = next;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (pending.current) void flush(pending.current);
      }, 600);
    },
    [flush],
  );

  const commit = useCallback(
    (updater: (prev: Db) => Db) => {
      setDb((prev) => {
        const next = updater(prev);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  /**
   * 慎独的开始/结束必须是「引用稳定」的函数。
   * 原因：慎独页用 useEffect 的清理函数来"离开就暂停"，
   * 如果函数每次渲染都是新的，effect 会被反复清理+重建，
   * 结果是刚开始计时就被自己停掉。
   */
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const startFocus = useCallback(() => {
    commitRef.current((prev) => {
      if (prev.focus.active) return prev; // 已经在计时，别重复开一段
      const date = todayStr();
      const start = Date.now();
      return {
        ...prev,
        focus: {
          ...prev.focus,
          active: { date, start },
          sessions: [...prev.focus.sessions, { date, start }],
        },
      };
    });
  }, []);

  const stopFocus = useCallback(() => {
    commitRef.current((prev) => {
      const active = prev.focus.active;
      if (!active) return prev;
      const closed = closeActiveSession(prev.focus, active, Date.now());
      return { ...prev, focus: { ...closed, active: undefined } };
    });
  }, []);

  // 退出前把没写完的数据补上
  useEffect(() => {
    const handler = () => {
      if (pending.current) void window.workbench.save(pending.current);
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // 主进程改了设置（比如从托盘勾选悬浮窗，或点击顶部悬浮窗按钮），同步过来。
  // 关键：如果此刻还有排队等着落盘的快照，也要一起把设置改掉，
  // 否则 600ms 后那份旧快照会把主进程刚改好的设置覆盖回去。
  useEffect(() => {
    const off = window.workbench.onSettingsChanged((settings) => {
      if (pending.current) {
        pending.current = { ...pending.current, settings: { ...pending.current.settings, ...settings } };
      }
      setDb((prev) => {
        const next = { ...prev, settings: { ...prev.settings, ...settings } };
        pending.current = pending.current ?? next;
        return next;
      });
    });
    return off;
  }, []);

  const api: Ctx = useMemo(() => {
    const now = () => Date.now();

    return {
      ready,
      db,
      dataDir,
      dbFile,
      saveError,

      save: async () => {
        const current = pending.current ?? db;
        const res = await window.workbench.exportFile(
          `工作台数据-${todayStr()}.json`,
          JSON.stringify(current, null, 2),
        );
        if (!res.ok) return { ok: false };
        return { ok: true, path: res.path, count: current.ddl.length + current.todos.length };
      },

      updateSettings: (patch) =>
        commit((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } })),

      addDdl: (item) => {
        const created: DdlItem = {
          id: uid('d'),
          title: item.title,
          date: item.date,
          calendar: item.calendar ?? 'solar',
          lunar: item.lunar,
          recurrence: item.recurrence ?? 'none',
          note: item.note ?? '',
          color: item.color ?? db.settings.accent,
          emoji: item.emoji ?? '⭐️',
          pinned: item.pinned ?? false,
          precise: item.precise ?? false,
          remindDaysBefore: item.remindDaysBefore ?? db.settings.defaultRemindDaysBefore,
          remindEnabled: item.remindEnabled ?? true,
          category: item.category ?? '其他',
          anniversaryStyle: item.anniversaryStyle ?? false,
          order: item.order ?? db.ddl.length,
          createdAt: now(),
          updatedAt: now(),
        };
        commit((prev) => ({ ...prev, ddl: [...prev.ddl, created] }));
        return created;
      },

      updateDdl: (id, patch) =>
        commit((prev) => ({
          ...prev,
          ddl: prev.ddl.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: now() } : d)),
        })),

      removeDdl: (id) => commit((prev) => ({ ...prev, ddl: prev.ddl.filter((d) => d.id !== id) })),

      /* ------------------------- 截止日 ------------------------- */

      addDeadline: (item) => {
        const created: Deadline = {
          id: uid('dl'),
          title: item.title,
          dueDate: item.dueDate,
          dueTime: item.dueTime,
          note: item.note ?? '',
          priority: item.priority ?? 1,
          progress: item.progress ?? 0,
          done: item.done ?? false,
          color: item.color ?? '#E0574F',
          tags: item.tags ?? [],
          createdAt: now(),
          updatedAt: now(),
        };
        commit((prev) => ({
          ...prev,
          deadlines: [...prev.deadlines, created],
          // 关键：同时在截止日当天挂一条待办，这样"每天要做什么"不会漏掉它
          todos: [...prev.todos, deadlineTodo(created, prev.todos)],
        }));
        return created;
      },

      updateDeadline: (id, patch) =>
        commit((prev) => {
          const old = prev.deadlines.find((d) => d.id === id);
          const deadlines = prev.deadlines.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: now() } : d));
          const next = deadlines.find((d) => d.id === id);
          if (!old || !next) return { ...prev, deadlines };
          return { ...prev, deadlines, todos: syncTodosForDeadline(prev.todos, old, next) };
        }),

      removeDeadline: (id) =>
        commit((prev) => ({
          ...prev,
          deadlines: prev.deadlines.filter((d) => d.id !== id),
          // 关联的待办保留，只是解除关联，避免用户觉得"我的事被删了"
          todos: prev.todos.map((t) => (t.deadlineId === id ? { ...t, deadlineId: undefined } : t)),
        })),

      deadlineViews: () => {
        const today = todayStr();
        return sortDeadlines(db.deadlines.map((d) => computeDeadline(d, db.todos, today)));
      },

      deadlinesOn: (date) => {
        const today = todayStr();
        return sortDeadlines(
          db.deadlines
            .filter((d) => {
              if (d.dueDate === date) return true;
              // 已过期未完成：一直挂在"今天"和过去的日子上，催着处理
              if (!d.done && diffDaysSafe(d.dueDate, today) < 0 && diffDaysSafe(date, today) <= 0) return true;
              return false;
            })
            .map((d) => computeDeadline(d, db.todos, today)),
        );
      },

      /** 补齐缺失的关联待办（比如导入旧数据、或者截止日已存在但待办被删了） */
      syncDeadlineTodos: () => {
        commit((prev) => {
          const existing = new Set(prev.todos.map((t) => t.deadlineId).filter(Boolean) as string[]);
          const missing = prev.deadlines.filter((d) => !existing.has(d.id));
          if (!missing.length) return prev;
          const added = missing.map((d) => deadlineTodo(d, prev.todos));
          return { ...prev, todos: [...prev.todos, ...added] };
        });
      },

      /** 手动排序：按传入顺序写 order */
      setDdlOrder: (ids) =>
        commit((prev) => {
          const indexOf = new Map(ids.map((id, i) => [id, i]));
          return {
            ...prev,
            ddl: prev.ddl.map((d) => {
              const next = indexOf.get(d.id);
              return next === undefined ? d : d.order === next ? d : { ...d, order: next };
            }),
          };
        }),

      addTodo: (item) => {
        const created: Todo = {
          id: uid('t'),
          title: item.title,
          date: item.date,
          note: item.note ?? '',
          dueTime: item.dueTime,
          repeat: item.repeat ?? 'none',
          baseDate: item.baseDate ?? item.date,
          done: false,
          priority: item.priority ?? 0,
          color: item.color,
          order: item.order ?? prevOrder(db.todos, item.date),
          createdAt: now(),
          updatedAt: now(),
        };
        commit((prev) => ({ ...prev, todos: [...prev.todos, created] }));
        return created;
      },

      updateTodo: (id, patch) =>
        commit((prev) => ({
          ...prev,
          todos: prev.todos.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now() } : t)),
        })),

      removeTodo: (id) =>
        commit((prev) => {
          const completions = Object.fromEntries(
            Object.entries(prev.completions).filter(([k]) => !k.startsWith(`${id}|`)),
          );
          return { ...prev, todos: prev.todos.filter((t) => t.id !== id), completions };
        }),

      toggleTodo: (todo, date) =>
        commit((prev) => {
          const key = completionKey(todo.id, date);
          const completions = { ...prev.completions };
          const currentlyDone = !!completions[key];
          if (currentlyDone) delete completions[key];
          else completions[key] = { doneAt: now() };

          // 不重复的待办保留一个跟自身绑定的完成标记，方便"今日"以外的视图判断
          const todos =
            todo.repeat === 'none'
              ? prev.todos.map((t) =>
                  t.id === todo.id ? { ...t, done: !currentlyDone, doneAt: currentlyDone ? undefined : now(), updatedAt: now() } : t,
                )
              : prev.todos;

          return { ...prev, todos, completions };
        }),

      moveTodo: (id, date) =>
        commit((prev) => ({
          ...prev,
          todos: prev.todos.map((t) =>
            t.id === id
              ? t.repeat === 'none'
                ? { ...t, date, baseDate: t.baseDate || date, updatedAt: now() }
                : { ...t, date, baseDate: date, updatedAt: now() }
              : t,
          ),
        })),

      setDayLog: (date, patch) =>
        commit((prev) => {
          const existing: DayLog = prev.dayLogs[date] ?? { date, updatedAt: 0 };
          const merged: DayLog = { ...existing, ...patch, date, updatedAt: now() };
          const isEmpty =
            !merged.mood && !merged.diary?.trim() && !(merged.tags && merged.tags.length) && !merged.color;
          const dayLogs = { ...prev.dayLogs };
          if (isEmpty) delete dayLogs[date];
          else dayLogs[date] = merged;
          return { ...prev, dayLogs };
        }),

      todosOn: (date) => {
        const list = db.todos.filter((t) => todoOccursOn(t, date));
        return list.sort((a, b) => {
          if (a.priority !== b.priority) return b.priority - a.priority;
          const ta = a.dueTime || '99:99';
          const tb = b.dueTime || '99:99';
          if (ta !== tb) return ta < tb ? -1 : 1;
          return a.order - b.order;
        });
      },

      isDone: (todo, date) => {
        if (todo.repeat === 'none') {
          return todo.done || !!db.completions[completionKey(todo.id, date)];
        }
        return !!db.completions[completionKey(todo.id, date)];
      },

      /* ------------------------- 慎独 ------------------------- */

      startFocus,
      stopFocus,

      /* ------------------------- 慎独 ------------------------- */
      focusSeconds: (date) => resolvedFocus(db.focus, date).total,
      focusLastSession: (date) => resolvedFocus(db.focus, date).lastSession,
      focusRunning: !!db.focus.active,

      updateHome: (patch) => commit((prev) => ({ ...prev, home: { ...prev.home, ...patch } })),

      markStarted: () =>
        commit((prev) => (prev.ui?.started ? prev : { ...prev, ui: { ...prev.ui, started: true } })),

      replaceDb: (next) => {
        setDb(next);
        pending.current = next;
        void flush(next);
      },

      resetToDemo: () => {
        /* 由调用方传入生成的示例数据 */
      },
    };
  }, [db, ready, dataDir, dbFile, saveError, commit, flush]);

  return <WorkbenchContext.Provider value={api}>{children}</WorkbenchContext.Provider>;
}

/** 新待办排到当天已有待办之后 */
function prevOrder(todos: Todo[], date: string): number {
  const sameDay = todos.filter((t) => t.date === date);
  if (!sameDay.length) return 0;
  return Math.max(...sameDay.map((t) => t.order)) + 1;
}

/* ------------------------------------------------------------------ */
/*                            慎独 计算                                 */
/* ------------------------------------------------------------------ */

const DAY_MS = 86400000;

function dateOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 把 totals 完全按 sessions 重算（这样反复进出、跨天都不会丢或重复算） */
function recomputeTotals(sessions: FocusState['sessions']): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const s of sessions) {
    const end = s.end ?? s.start;
    const secs = Math.max(0, Math.round((end - s.start) / 1000));
    if (secs === 0) continue;
    totals[s.date] = (totals[s.date] ?? 0) + secs;
  }
  return totals;
}

/** 结束正在进行的那一段；如果跨过零点就切成两段分别记到两天 */
function closeActiveSession(focus: FocusState, active: { date: string; start: number }, now: number): FocusState {
  const sessions = focus.sessions.map((s) =>
    s.start === active.start && s.end === undefined ? { ...s, end: now } : s,
  );
  const startDay = dateOf(active.start);
  const endDay = dateOf(now);
  if (startDay !== endDay) {
    // 跨天了：把原来那段改到 23:59:59.999 结束，再补一段从 00:00 开始
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const midnightMs = midnight.getTime();
    const idx = sessions.findIndex((s) => s.start === active.start);
    if (idx >= 0) {
      sessions[idx] = { ...sessions[idx], end: midnightMs, split: true };
      sessions.push({ date: endDay, start: midnightMs, end: now, split: true });
    }
  }
  return { sessions, totals: recomputeTotals(sessions) };
}

/** 某一天的慎独秒数：历史累计 + 正在进行的那一段 */
function resolvedFocus(focus: FocusState, date: string): { total: number; lastSession: number } {
  const base = focus.totals[date] ?? 0;
  const active = focus.active;
  if (!active) return { total: base, lastSession: 0 };
  const now = Date.now();
  const startDay = dateOf(active.start);
  const today = dateOf(now);
  let add = 0;
  if (startDay === date) {
    // 这一段是今天开始的：算到今天头上（跨零点时会切分，这里只取到零点之前那部分）
    const end = today === date ? now : new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
    add = Math.max(0, Math.round((end - active.start) / 1000));
  } else if (today === date && startDay !== date) {
    // 昨天开始的、现在还在跑：今天只算零点之后的部分
    const midnight = new Date(now).setHours(0, 0, 0, 0);
    add = Math.max(0, Math.round((now - midnight) / 1000));
  }
  const lastSession = startDay === date && today === date ? Math.max(0, Math.round((now - active.start) / 1000)) : add;
  return { total: base + add, lastSession };
}

/** 秒 → "1小时03分钟20秒" 这种文案 */
export function formatFocus(seconds: number, withSeconds = true): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (withSeconds) return `${h}小时${String(m).padStart(2, '0')}分钟${String(sec).padStart(2, '0')}秒`;
  return h > 0 ? `${h}小时${String(m).padStart(2, '0')}分钟` : `${m}分钟`;
}

export { DAY_MS };

function diffDaysSafe(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime()) / 86400000);
}

/** 截止日对应的那条"待办"（自动生成并挂在截止日当天） */
function deadlineTodo(d: Deadline, todos: Todo[]): Todo {
  const now = Date.now();
  return {
    id: uid('t'),
    title: d.title,
    date: d.dueDate,
    note: '',
    dueTime: d.dueTime,
    repeat: 'none',
    baseDate: d.dueDate,
    done: d.done,
    doneAt: d.done ? now : undefined,
    priority: d.priority > 0 ? 1 : 0,
    color: d.color,
    order: prevOrder(todos, d.dueDate),
    deadlineId: d.id,
    createdAt: now,
    updatedAt: now,
  };
}

/** 截止日改了标题/日期/优先级之后，同步它那条待办 */
function syncTodosForDeadline(todos: Todo[], oldD: Deadline, next: Deadline): Todo[] {
  return todos.map((t) => {
    if (t.deadlineId !== next.id) return t;
    return {
      ...t,
      title: next.title,
      // 待办没被独立改过期的话，就跟着截止日走
      date: t.date === oldD.dueDate ? next.dueDate : t.date,
      baseDate: next.dueDate,
      dueTime: next.dueTime,
      priority: next.priority > 0 ? 1 : 0,
      color: next.color,
      done: next.done,
      doneAt: next.done ? (t.doneAt ?? Date.now()) : undefined,
      updatedAt: Date.now(),
    };
  });
}
