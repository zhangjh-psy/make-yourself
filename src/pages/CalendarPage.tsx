/**
 * 日历页 —— 整个应用的主力页面，从上到下三块：
 *
 *   ① 截止日区（可折叠）  横向排列的截止日卡片，管项目/论文/报名这类 deadline
 *   ② 月历 / 周视图      每个格子显示：日期、农历、节日、待办进度、心情、📌 截止日
 *   ③ 右侧当天详情      当天的截止日、待办清单、快速加待办
 *
 * 两个交互要点：
 *   - **拖拽改期**：把待办从右侧拖到日历格子上 = 换日期。
 *     没用 HTML5 原生拖拽的那套 dataTransfer，而是自己用模块级变量 dragPayload
 *     记录"正在拖哪一条"，因为在 Electron 里原生拖拽会触发文件拖放语义，很麻烦。
 *   - **每日数据索引**：月历一次要渲染 42 个格子，每个格子都要算待办/心情/农历/假期。
 *     全部塞进一个 Map（dayIndex）一次算完，避免每格重复计算导致卡顿。
 *
 * 注：日记和心情的编辑**不在这一页**（已独立成「日记」板块），
 * 但格子上仍然显示心情 emoji 和小圆点，方便一眼看出这个月的状态。
 */
import { useEffect, useMemo, useState } from 'react';
import { useWorkbench } from '../store';
import type { Deadline, DeadlineView, DayLog, Todo, TodoRepeat } from '../types';
import {
  addDays,
  addMonths,
  computeDdl,
  daysFrom,
  diffDays,
  festivalOf,
  inMonth,
  isWeekend,
  lunarDayName,
  monthGrid,
  monthLabel,
  parse,
  prettyDate,
  solarToLunar,
  startOfWeek,
  todayStr,
  weekGrid,
  WEEKDAY_SHORT,
} from '../lib/date';
import { Seg, ConfirmModal } from '../components/Modal';
import { IconChevronLeft, IconChevronRight, IconChevronDown, IconPlus } from '../components/Icons';
import { useToast } from '../components/Toast';
import { DeadlineCard, DeadlineChips, DeadlineEditor, QuickAdd, TodoRow } from '../components/TaskBits';

type View = 'month' | 'week';

/* 拖拽用：不依赖 HTML5 dnd，行为更可控 */
let dragPayload: { id: string } | null = null;

export function CalendarPage() {
  const {
    db,
    todosOn,
    isDone,
    toggleTodo,
    moveTodo,
    addTodo,
    removeTodo,
    updateTodo,
    updateDeadline,
    removeDeadline,
    deadlineViews,
    deadlinesOn,
    syncDeadlineTodos,
  } = useWorkbench();
  const toast = useToast();
  const today = todayStr();

  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(today); // 当前显示的月/周里的一天
  const [selected, setSelected] = useState(today);
  const [dragOver, setDragOver] = useState<string | null>(null);

  /* 截止日区 */
  const [ddlOpen, setDdlOpen] = useState(true);
  const [showDoneDl, setShowDoneDl] = useState(false);
  const [editingDl, setEditingDl] = useState<Deadline | null>(null);
  const [creatingDl, setCreatingDl] = useState(false);
  const [deletingDl, setDeletingDl] = useState<Deadline | null>(null);

  // 补齐缺失的关联待办（导入旧数据、或那条待办被单独删过）
  useEffect(() => {
    syncDeadlineTodos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dlViews = deadlineViews();
  const dlActive = dlViews.filter((v) => !v.d.done);
  const dlOverdue = dlActive.filter((v) => v.urgency === 'overdue');
  const dlList = showDoneDl ? dlViews : dlActive;

  const cursorDate = parse(cursor);
  const year = cursorDate.getFullYear();
  const month = cursorDate.getMonth() + 1;

  const cells = useMemo(() => {
    if (view === 'month') return monthGrid(year, month, db.settings.weekStartsOn);
    return weekGrid(cursor, db.settings.weekStartsOn);
  }, [view, year, month, cursor, db.settings.weekStartsOn]);

  const weekdays = useMemo(() => {
    const start = startOfWeek(today, db.settings.weekStartsOn);
    return daysFrom(start, 7).map((d) => WEEKDAY_SHORT[parse(d).getDay()]);
  }, [today, db.settings.weekStartsOn]);

  /* 每天的数据摘要：待办 + 心情 + 倒数日 + 截止日 */
  const dayIndex = useMemo(() => {
    const map = new Map<
      string,
      {
        todos: Todo[];
        undone: number;
        mood?: string;
        log?: DayLog;
        ddls: { title: string; emoji: string; color: string; dayDiff: number }[];
        deadlines: DeadlineView[];
      }
    >();
    const need = new Set(cells);
    for (const d of need) {
      const todos = todosOn(d);
      const undone = todos.filter((t) => !isDone(t, d)).length;
      const log = db.dayLogs[d];
      const ddls = db.ddl
        .map((item) => ({ item, c: computeDdl(item, d) }))
        .filter(({ c }) => c.occurrence === d)
        .map(({ item, c }) => ({ title: item.title, emoji: item.emoji, color: item.color, dayDiff: c.dayDiff }));
      map.set(d, { todos, undone, mood: log?.mood, log, ddls, deadlines: deadlinesOn(d) });
    }
    return map;
    // deadlinesOn 每次渲染都是新函数，依赖里放 db 就够了
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, db, todosOn, isDone]);

  const shift = (dir: number) => {
    if (view === 'month') setCursor(addMonths(cursor, dir));
    else setCursor(addDays(cursor, dir * 7));
  };

  const handleDrop = (date: string) => {
    setDragOver(null);
    if (!dragPayload) return;
    const todo = db.todos.find((t) => t.id === dragPayload!.id);
    dragPayload = null;
    if (!todo || todo.date === date) return;
    moveTodo(todo.id, date);
    setSelected(date);
    toast(`已移动到 ${prettyDate(date)}`);
  };

  const dayTodos = todosOn(selected);

  return (
    <>
      {/* 截止日区：可折叠，不占太多地方 */}
      <div className={`dl-strip ${ddlOpen ? '' : 'dl-strip--collapsed'}`}>
        <div className="dl-strip__head">
          <button className="dl-strip__toggle" onClick={() => setDdlOpen((v) => !v)}>
            <IconChevronDown
              size={15}
              className={`dl-strip__caret ${ddlOpen ? '' : 'dl-strip__caret--closed'}`}
            />
            <span className="dl-strip__title">截止日</span>
            <span className="dl-strip__count">{dlActive.length}</span>
            {dlOverdue.length > 0 && (
              <span className="todo-item__badge todo-item__badge--danger" style={{ marginLeft: 4 }}>
                {dlOverdue.length} 个已过期
              </span>
            )}
          </button>
          {ddlOpen && (
            <div className="dl-strip__actions">
              <label className="check">
                <input type="checkbox" checked={showDoneDl} onChange={(e) => setShowDoneDl(e.target.checked)} />
                <span className="check__box">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
                    <path d="M4.5 12.5l5 5 10-11" />
                  </svg>
                </span>
                <span className="check__label">显示已完成</span>
              </label>
              <button className="btn btn--primary btn--sm" onClick={() => setCreatingDl(true)}>
                <IconPlus /> 新建截止日
              </button>
            </div>
          )}
        </div>

        {ddlOpen && (
          <div className="dl-strip__body">
            {dlList.length === 0 ? (
              <div className="mini-note" style={{ padding: '2px 2px 6px' }}>
                还没有截止日。点「新建截止日」把项目、报告、报名的交付日期记下来 ——
                它会自动在截止那天生成一条待办，日历上也看得到。
              </div>
            ) : (
              <div className="dl-strip__row">
                {dlList.map((v) => (
                  <div className="dl-strip__item" key={v.d.id}>
                    <DeadlineCard
                      view={v}
                      onEdit={() => setEditingDl(v.d)}
                      onDelete={() => setDeletingDl(v.d)}
                      onProgress={(p) => updateDeadline(v.d.id, { progress: p, done: p >= 100 ? true : v.d.done })}
                      onToggleDone={() =>
                        updateDeadline(v.d.id, {
                          done: !v.d.done,
                          progress: v.d.done ? 0 : 100,
                          doneAt: !v.d.done ? Date.now() : undefined,
                        })
                      }
                      onAddTodo={(title) => {
                        addTodo({ title, date: v.d.dueDate, deadlineId: v.d.id, color: v.d.color, priority: v.d.priority > 0 ? 1 : 0 });
                        toast('已加到截止日当天');
                      }}
                      onToggleTodo={(t) => toggleTodo(t, v.d.dueDate)}
                      onRemoveTodo={(id) => removeTodo(id)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="cal-layout">
        <div>
          <div className="cal-head">
            <button className="btn btn--icon" onClick={() => shift(-1)} title="上一页">
              <IconChevronLeft />
            </button>
            <button className="btn btn--icon" onClick={() => shift(1)} title="下一页">
              <IconChevronRight />
            </button>
            <div className="cal-title">{view === 'month' ? monthLabel(year, month) : `${month}月 · 本周`}</div>
            <button
              className="btn btn--sm"
              onClick={() => {
                setCursor(today);
                setSelected(today);
              }}
            >
              回到今天
            </button>
            <div style={{ marginLeft: 'auto' }}>
              <Seg<View>
                value={view}
                onChange={setView}
                options={[
                  { value: 'month', label: '月' },
                  { value: 'week', label: '周' },
                ]}
              />
            </div>
          </div>

          <div className="cal-weekdays">
            {weekdays.map((w, i) => (
              <div key={`${w}-${i}`} className={`cal-weekday ${isWeekend(cells[i] ?? today) ? 'cal-weekday--weekend' : ''}`}>
                {w}
              </div>
            ))}
          </div>

          {view === 'month' ? (
            <div className="cal-grid">
              {cells.map((d) => {
                const info = dayIndex.get(d);
                return (
                  <MonthCell
                    key={d}
                    date={d}
                    out={!inMonth(d, year, month)}
                    today={d === today}
                    selected={d === selected}
                    dragOver={dragOver === d}
                    info={info}
                    onSelect={() => setSelected(d)}
                    onDrop={() => handleDrop(d)}
                    onDragEnter={() => setDragOver(d)}
                    onDragLeave={() => setDragOver((cur) => (cur === d ? null : cur))}
                  />
                );
              })}
            </div>
          ) : (
            <div className="cal-week">
              {cells.map((d) => {
                const info = dayIndex.get(d);
                return (
                  <div
                    key={d}
                    className={`week-col ${d === today ? 'week-col--today' : ''} ${dragOver === d ? 'week-col--drop' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(d);
                    }}
                    onDragLeave={() => setDragOver((cur) => (cur === d ? null : cur))}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(d);
                    }}
                    onClick={() => setSelected(d)}
                  >
                    <div className="week-col__head">
                      <span className="week-col__wd">{WEEKDAY_SHORT[parse(d).getDay()]}</span>
                      <span className="week-col__day">{parse(d).getDate()}</span>
                      {info?.mood && <span style={{ marginLeft: 'auto', fontSize: 12 }}>{info.mood}</span>}
                    </div>
                    <div className="week-col__body">
                      {info?.deadlines.map((v) => (
                        <div
                          key={v.d.id}
                          className="week-item"
                          style={{ background: `${v.d.color}14`, border: `1px solid ${v.d.color}33` }}
                          title={v.statusText}
                        >
                          <span className="week-item__dot" style={{ background: v.d.color }} />
                          <span style={{ flex: 1, minWidth: 0 }}>📌 {v.d.title}</span>
                        </div>
                      ))}
                      {info?.todos.map((t) => {
                        const done = isDone(t, d);
                        return (
                          <div
                            key={t.id}
                            className={`week-item ${done ? 'week-item--done' : ''}`}
                            draggable
                            onDragStart={() => {
                              dragPayload = { id: t.id };
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTodo(t, d);
                            }}
                          >
                            <span className="week-item__dot" style={{ background: done ? 'var(--text-3)' : t.color || 'var(--accent)' }} />
                            <span style={{ flex: 1, minWidth: 0 }}>
                              {t.dueTime && <b style={{ fontVariantNumeric: 'tabular-nums' }}>{t.dueTime} </b>}
                              {t.title}
                            </span>
                          </div>
                        );
                      })}
                      {!info?.todos.length && !info?.deadlines.length && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '8px 4px', textAlign: 'center' }}>—</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <Legend />
        </div>

        <DayPanel
          date={selected}
          todos={dayTodos}
          onDelete={(id) => {
            removeTodo(id);
            toast('已删除');
          }}
          onAddTodo={(payload) => {
            addTodo({ ...payload, date: selected });
            toast('已添加');
          }}
          onToggle={(t) => toggleTodo(t, selected)}
          onMove={(id, date) => {
            moveTodo(id, date);
            toast(`已推迟到 ${date}`);
          }}
          onNote={(id, note) => updateTodo(id, { note })}
        />
      </div>

      {(creatingDl || editingDl) && (
        <DeadlineEditor
          item={editingDl}
          onClose={() => {
            setCreatingDl(false);
            setEditingDl(null);
          }}
        />
      )}

      {deletingDl && (
        <ConfirmModal
          title="删除这个截止日？"
          danger
          confirmText="删除"
          message={
            <>
              将删除「<b>{deletingDl.title}</b>」。
              <br />
              它自动生成的那条待办会保留（只是不再关联），你可以手动删掉。
            </>
          }
          onConfirm={() => {
            removeDeadline(deletingDl.id);
            toast('已删除');
          }}
          onClose={() => setDeletingDl(null)}
        />
      )}
    </>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 11, color: 'var(--text-3)', flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span className="cal-dot" style={{ background: 'var(--accent)' }} /> 未完成
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span className="cal-dot" style={{ background: 'var(--text-3)' }} /> 已完成
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span className="cal-dot" style={{ background: 'var(--danger)' }} /> 已过期
      </span>
      <span>· 表格里可以直接拖动待办改日期</span>
      <span>· 想写日记去「日记」板块</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                            月历格子                                  */
/* ------------------------------------------------------------------ */

function MonthCell({
  date,
  out,
  today,
  selected,
  dragOver,
  info,
  onSelect,
  onDrop,
  onDragEnter,
  onDragLeave,
}: {
  date: string;
  out: boolean;
  today: boolean;
  selected: boolean;
  dragOver: boolean;
  info?: {
    todos: Todo[];
    undone: number;
    mood?: string;
    log?: DayLog;
    ddls: { title: string; emoji: string; color: string; dayDiff: number }[];
    deadlines: DeadlineView[];
  };
  onSelect: () => void;
  onDrop: () => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
}) {
  const lunar = solarToLunar(date);
  const festival = festivalOf(date);
  const isFirstOfLunarMonth = lunar.day === 1;
  const overdue = info ? info.todos.some((t) => !t.done && !!t.dueTime && diffDays(date, todayStr()) < 0) : false;
  const dl = info?.deadlines ?? [];
  const dlOverdue = dl.some((v) => v.urgency === 'overdue');
  const dlDue = dl.filter((v) => v.urgency === 'today' || v.d.dueDate === date);

  return (
    <div
      className={`cal-cell ${out ? 'cal-cell--out' : ''} ${today ? 'cal-cell--today' : ''} ${
        selected ? 'cal-cell--selected' : ''
      } ${dragOver ? 'cal-cell--drop' : ''} ${dlOverdue ? 'cal-cell--overdue' : ''}`}
      onClick={onSelect}
      onDragOver={(e) => {
        e.preventDefault();
        onDragEnter();
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      {dlDue.length > 0 && (
        <span className="cal-cell__dl" title={dlDue.map((v) => v.d.title).join('、')}>
          📌
        </span>
      )}
      <div className="cal-cell__top">
        <span className="cal-cell__day">{parse(date).getDate()}</span>
        {info?.mood && <span className="cal-cell__mood">{info.mood}</span>}
        <span className="cal-cell__badges">
          {info?.log?.color && <span className="cal-dot" style={{ background: info.log.color, width: 7, height: 7 }} />}
          {info && info.todos.length > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
              {info.todos.length - info.undone}/{info.todos.length}
            </span>
          )}
        </span>
      </div>

      <div className={`cal-cell__lunar ${festival ? 'cal-cell__festival' : ''}`}>
        {festival || (isFirstOfLunarMonth ? lunar.text : lunarDayName(lunar.day))}
      </div>

      <div className="cal-cell__items">
        {info?.ddls.slice(0, 1).map((x, i) => (
          <div className="cal-chip" key={`d-${i}`} style={{ background: `${x.color}1A`, color: x.color, fontWeight: 600 }}>
            {x.emoji} {x.title}
          </div>
        ))}
        {info?.todos.slice(0, 2).map((t) => (
          <div className={`cal-chip ${t.done ? 'cal-chip--done' : ''}`} key={t.id}>
            <span className="cal-chip__mark" style={{ background: t.color || (t.priority ? 'var(--danger)' : 'var(--accent)') }} />
            {t.dueTime && <b style={{ fontVariantNumeric: 'tabular-nums' }}>{t.dueTime}</b>}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
          </div>
        ))}
        {info && info.todos.length > 2 && <div className="cal-chip cal-chip--more">还有 {info.todos.length - 2} 项…</div>}
      </div>

      {overdue && (
        <span style={{ position: 'absolute', right: 6, bottom: 5, fontSize: 9, color: 'var(--danger)', fontWeight: 700 }}>过期</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                          当天详情面板                                */
/* ------------------------------------------------------------------ */

function DayPanel({
  date,
  todos,
  onDelete,
  onAddTodo,
  onMove,
  onToggle,
  onNote,
}: {
  date: string;
  todos: Todo[];
  onDelete: (id: string) => void;
  onAddTodo: (payload: { title: string; dueTime?: string; repeat: TodoRepeat; priority: 0 | 1; color?: string; note?: string }) => void;
  onMove: (id: string, date: string) => void;
  onToggle: (todo: Todo) => void;
  onNote: (id: string, note: string) => void;
}) {
  const { isDone, db } = useWorkbench();
  const today = todayStr();
  const lunar = solarToLunar(date);
  const festival = festivalOf(date);
  const ddlsHere = db.ddl
    .map((item) => ({ item, c: computeDdl(item, date) }))
    .filter(({ c }) => c.occurrence === date);

  const [dragId, setDragId] = useState<string | null>(null);

  const undone = todos.filter((t) => !isDone(t, date)).length;

  return (
    <div className="day-panel">
      <div className="card">
        <div className="card__body" style={{ paddingBottom: 12 }}>
          <div className="day-panel__date">{prettyDate(date)}</div>
          <div className="day-panel__sub">
            {date} · 农历{lunar.text}
            {festival ? ` · ${festival}` : ''} · {lunar.ganzhi}
            {lunar.zodiac}年
          </div>

          <div style={{ marginTop: 10 }}>
            <DeadlineChips date={date} />
          </div>

          {ddlsHere.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {ddlsHere.map(({ item, c }) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 9px',
                    borderRadius: 'var(--radius-sm)',
                    background: `${item.color}14`,
                    border: `1px solid ${item.color}33`,
                    fontSize: 12.5,
                  }}
                >
                  <span>{item.emoji}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </span>
                  <b style={{ color: item.color, fontVariantNumeric: 'tabular-nums' }}>
                    {c.dayDiff === 0 ? '今天' : c.label + Math.abs(c.bigNumber) + c.unit}
                  </b>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div className="progress">
              <div
                className="progress__bar"
                style={{ width: `${todos.length ? ((todos.length - undone) / todos.length) * 100 : 0}%` }}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 5 }}>
              {todos.length === 0 ? '这天还没有待办' : `共 ${todos.length} 项，已完成 ${todos.length - undone} 项`}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <div className="card__title">待办</div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>可拖到日历上换日期</div>
        </div>
        <div className="card__body" style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="todo-list">
            {todos.length === 0 && <div className="empty" style={{ padding: '16px 0' }}>这天还没有待办</div>}
            {todos.map((t) => {
              const done = isDone(t, date);
              const isOverdue = !done && diffDays(date, today) < 0;
              return (
                <div
                  key={t.id}
                  draggable
                  onDragStart={() => {
                    dragPayload = { id: t.id };
                    setDragId(t.id);
                  }}
                  onDragEnd={() => setDragId(null)}
                  className={dragId === t.id ? 'todo-item--dragging' : ''}
                >
                  <TodoRow
                    todo={t}
                    done={done}
                    overdue={isOverdue}
                    deadlineName={t.deadlineId ? db.deadlines.find((x) => x.id === t.deadlineId)?.title : undefined}
                    onToggle={() => onToggle(t)}
                    onDelete={() => onDelete(t.id)}
                    onNote={(note) => onNote(t.id, note)}
                    onPushDay={() => onMove(t.id, addDays(date, 1))}
                  />
                </div>
              );
            })}
          </div>

          <QuickAdd date={date} onAdd={(payload) => onAddTodo(payload)} />
        </div>
      </div>
    </div>
  );
}
