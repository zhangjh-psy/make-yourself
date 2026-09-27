/**
 * 任务相关的可复用组件：截止日卡片、当天截止日、待办一行、快速加待办、截止日编辑器。
 * 这些原来都放在「任务」板块里，现在「任务」合并进「日历」，于是抽出来单独放。
 */
import { useEffect, useState } from 'react';
import { useWorkbench } from '../store';
import type { Deadline, DeadlineView, Todo, TodoRepeat } from '../types';
import { DEADLINE_TAGS, PRIORITY_LABEL, TODO_COLORS } from '../types';
import { addDays, diffDays, todayStr } from '../lib/date';
import { Field, Modal, Seg, useDebouncedCallback } from '../components/Modal';
import { IconCheck, IconClock, IconEdit, IconPlus, IconRepeat, IconTrash } from '../components/Icons';
import { useToast } from '../components/Toast';

export const REPEAT_LABEL: Record<TodoRepeat, string> = {
  none: '不重复',
  daily: '每天',
  weekdays: '工作日',
  weekly: '每周',
  monthly: '每月',
};

/** 按状态给颜色：过期红、今天橙、一周内黄、其余用中性色 */
export function urgencyColor(v: DeadlineView): string {
  switch (v.urgency) {
    case 'overdue':
      return 'var(--danger)';
    case 'today':
      return '#E8873B';
    case 'soon':
      return '#D9A020';
    case 'done':
      return 'var(--ok)';
    default:
      return 'var(--text-3)';
  }
}

/* ------------------------------------------------------------------ */
/*                          截止日卡片                                  */
/* ------------------------------------------------------------------ */

export function DeadlineCard({
  view,
  onEdit,
  onDelete,
  onProgress,
  onToggleDone,
  onAddTodo,
  onToggleTodo,
  onRemoveTodo,
}: {
  view: DeadlineView;
  onEdit: () => void;
  onDelete: () => void;
  onProgress: (p: number) => void;
  onToggleDone: () => void;
  onAddTodo: (title: string) => void;
  onToggleTodo: (t: Todo) => void;
  onRemoveTodo: (id: string) => void;
}) {
  const { d, todos, statusText, daysLeft, urgency } = view;
  const [showTodos, setShowTodos] = useState(false);
  const [newTodo, setNewTodo] = useState('');
  const color = urgencyColor(view);

  return (
    <div className={`dl-card dl-card--${urgency}`} style={{ borderLeftColor: d.color }}>
      <div className="dl-card__top">
        <button className={`todo-check ${d.done ? 'todo-check--on' : ''}`} onClick={onToggleDone} title="标记完成">
          {d.done && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
              <path d="M4.5 12.5l5 5 10-11" />
            </svg>
          )}
        </button>
        <span className={`dl-card__title ${d.done ? 'dl-card__title--done' : ''}`}>{d.title}</span>
        <span className="dl-card__actions">
          <button className="ddl-icon-btn" title="编辑" onClick={onEdit}>
            <IconEdit />
          </button>
          <button className="ddl-icon-btn" title="删除" onClick={onDelete}>
            <IconTrash />
          </button>
        </span>
      </div>

      <div className="dl-card__status">
        <span className="dl-badge" style={{ color, borderColor: color }}>
          {statusText}
        </span>
        {d.priority > 0 && (
          <span
            className="dl-badge dl-badge--p"
            style={{ color: d.priority === 2 ? 'var(--danger)' : '#E8873B', borderColor: 'currentColor' }}
          >
            {PRIORITY_LABEL[d.priority]}
          </span>
        )}
        {d.dueTime && (
          <span className="dl-card__time">
            <IconClock size={11} /> {d.dueTime}
          </span>
        )}
        <span className="dl-card__due">{d.dueDate}</span>
      </div>

      <div className="dl-progress">
        <div className="dl-progress__bar" style={{ width: `${d.progress}%`, background: d.done ? 'var(--ok)' : d.color }} />
      </div>
      <div className="dl-card__row">
        <span className="mini-note">进度 {d.progress}%</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {[25, 50, -25].map((delta) => (
            <button
              key={delta}
              className="btn btn--sm btn--ghost"
              onClick={() => onProgress(Math.max(0, Math.min(100, d.progress + delta)))}
            >
              {delta > 0 ? `+${delta}%` : `${delta}%`}
            </button>
          ))}
          <button className="btn btn--sm btn--ghost" onClick={() => onProgress(100)}>
            完成
          </button>
        </span>
      </div>

      {d.tags.length > 0 && (
        <div className="tag-row" style={{ marginTop: 8 }}>
          {d.tags.map((t) => (
            <span key={t} className="tag-chip tag-chip--static">
              {t}
            </span>
          ))}
        </div>
      )}

      {d.note && <div className="dl-card__note">{d.note}</div>}

      <div className="dl-card__row" style={{ marginTop: 9 }}>
        <button className="btn btn--sm btn--ghost" onClick={() => setShowTodos((v) => !v)}>
          {showTodos ? '收起子待办' : `子待办 ${todos.length ? `(${todos.filter((t) => t.done).length}/${todos.length})` : ''}`}
        </button>
        {daysLeft >= 0 && !d.done && (
          <span className="mini-note" style={{ marginLeft: 'auto' }}>
            还剩 {daysLeft} 天
          </span>
        )}
      </div>

      {showTodos && (
        <div className="dl-card__todos">
          {todos.map((t) => (
            <div className="dl-subtodo" key={t.id}>
              <button className={`todo-check ${t.done ? 'todo-check--on' : ''}`} onClick={() => onToggleTodo(t)}>
                {t.done && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
                    <path d="M4.5 12.5l5 5 10-11" />
                  </svg>
                )}
              </button>
              <span className={t.done ? 'dl-subtodo__done' : ''}>{t.title}</span>
              <button className="ddl-icon-btn" title="删除" onClick={() => onRemoveTodo(t.id)}>
                <IconTrash size={12} />
              </button>
            </div>
          ))}
          <div className="todo-add" style={{ marginTop: 6 }}>
            <input
              className="input"
              style={{ fontSize: 12.5, padding: '5px 9px' }}
              placeholder="给这个截止日加一步，回车确认"
              value={newTodo}
              onChange={(e) => setNewTodo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTodo.trim()) {
                  onAddTodo(newTodo.trim());
                  setNewTodo('');
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                        当天相关的截止日                              */
/* ------------------------------------------------------------------ */

export function DeadlineChips({ date }: { date: string }) {
  const { deadlinesOn } = useWorkbench();
  const list = deadlinesOn(date);
  if (!list.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {list.map((v) => (
        <div key={v.d.id} className="dl-chip" style={{ borderColor: `${v.d.color}55`, background: `${v.d.color}12` }}>
          <span style={{ fontSize: 12 }}>📌</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>
            {v.d.title}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: urgencyColor(v), whiteSpace: 'nowrap' }}>{v.statusText}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                            待办一行                                  */
/* ------------------------------------------------------------------ */

export function TodoRow({
  todo,
  done,
  overdue,
  showDate,
  deadlineName,
  onToggle,
  onDelete,
  onNote,
  onPushDay,
}: {
  todo: Todo;
  done: boolean;
  overdue: boolean;
  showDate?: string;
  deadlineName?: string;
  onToggle: () => void;
  onDelete: () => void;
  onNote: (note: string) => void;
  /** 推迟一天（可选） */
  onPushDay?: () => void;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(todo.note ?? '');
  const saveNote = useDebouncedCallback((v: string) => onNote(v), 500);

  return (
    <div className={`todo-item ${done ? 'todo-item--done' : ''} ${overdue ? 'todo-item--overdue' : ''}`}>
      <button className={`todo-check ${done ? 'todo-check--on' : ''}`} onClick={onToggle} title="完成/取消">
        {done && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
            <path d="M4.5 12.5l5 5 10-11" />
          </svg>
        )}
      </button>
      <div className="todo-item__body">
        <div className="todo-item__title">{todo.title}</div>
        <div className="todo-item__meta">
          {showDate && <span className="todo-item__badge">{showDate}</span>}
          {todo.dueTime && (
            <span className={`todo-item__badge ${overdue ? 'todo-item__badge--danger' : ''}`}>
              <IconClock size={10} /> {todo.dueTime}
            </span>
          )}
          {todo.repeat !== 'none' && (
            <span className="todo-item__badge">
              <IconRepeat size={10} /> {REPEAT_LABEL[todo.repeat]}
            </span>
          )}
          {todo.priority === 1 && <span className="todo-item__badge todo-item__badge--accent">重要</span>}
          {deadlineName && <span className="todo-item__badge todo-item__badge--dl">📌 {deadlineName}</span>}
          {overdue && <span className="todo-item__badge todo-item__badge--danger">已过期</span>}
        </div>
        {editingNote ? (
          <textarea
            className="textarea"
            style={{ minHeight: 50, marginTop: 6, fontSize: 12.5 }}
            autoFocus
            value={note}
            placeholder="备注…"
            onChange={(e) => {
              setNote(e.target.value);
              saveNote(e.target.value);
            }}
            onBlur={() => setEditingNote(false)}
          />
        ) : (
          todo.note && <div className="todo-item__note">{todo.note}</div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {onPushDay && (
          <button className="ddl-icon-btn" title="推迟一天" onClick={onPushDay} style={{ fontSize: 10, fontWeight: 700 }}>
            +1
          </button>
        )}
        <button className="ddl-icon-btn" title="备注" onClick={() => setEditingNote((v) => !v)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
        </button>
        <button className="ddl-icon-btn" title="删除" onClick={onDelete}>
          <IconTrash size={13} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                          快速加待办                                  */
/* ------------------------------------------------------------------ */

export function QuickAdd({
  date,
  onAdd,
}: {
  date: string;
  onAdd: (payload: { title: string; dueTime?: string; repeat: TodoRepeat; priority: 0 | 1 }) => void;
}) {
  const [title, setTitle] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [repeat, setRepeat] = useState<TodoRepeat>('none');
  const [priority, setPriority] = useState<0 | 1>(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setTitle('');
  }, [date]);

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onAdd({ title: t, dueTime: dueTime || undefined, repeat, priority });
    setTitle('');
    setDueTime('');
    setRepeat('none');
    setPriority(0);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="todo-add">
        <input
          className="input"
          placeholder="加一件事，回车确认"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button className="btn btn--primary btn--icon" onClick={submit} disabled={!title.trim()} title="添加">
          <IconPlus />
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '选项'}
        </button>
      </div>
      {open && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input type="time" className="input" style={{ width: 112 }} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          <select className="select" style={{ width: 112 }} value={repeat} onChange={(e) => setRepeat(e.target.value as TodoRepeat)}>
            {(Object.keys(REPEAT_LABEL) as TodoRepeat[]).map((k) => (
              <option key={k} value={k}>
                {REPEAT_LABEL[k]}
              </option>
            ))}
          </select>
          <button className={`tag-chip ${priority === 1 ? 'tag-chip--active' : ''}`} onClick={() => setPriority(priority === 1 ? 0 : 1)}>
            重要
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                          截止日编辑器                                */
/* ------------------------------------------------------------------ */

export function DeadlineEditor({ item, onClose }: { item: Deadline | null; onClose: () => void }) {
  const { addDeadline, updateDeadline } = useWorkbench();
  const toast = useToast();
  const today = todayStr();

  const [title, setTitle] = useState(item?.title ?? '');
  const [dueDate, setDueDate] = useState(item?.dueDate ?? addDays(today, 7));
  const [dueTime, setDueTime] = useState(item?.dueTime ?? '');
  const [priority, setPriority] = useState<0 | 1 | 2>(item?.priority ?? 1);
  const [progress, setProgress] = useState(item?.progress ?? 0);
  const [done, setDone] = useState(item?.done ?? false);
  const [color, setColor] = useState(item?.color ?? '#E0574F');
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [note, setNote] = useState(item?.note ?? '');

  const valid = title.trim().length > 0 && !!dueDate;
  const daysLeft = diffDays(dueDate, today);

  const save = () => {
    if (!valid) return;
    const payload: Partial<Deadline> & { title: string; dueDate: string } = {
      title: title.trim(),
      dueDate,
      dueTime: dueTime || undefined,
      priority,
      progress: done ? 100 : progress,
      done,
      doneAt: done ? (item?.doneAt ?? Date.now()) : undefined,
      color,
      tags,
      note: note.trim(),
    };
    if (item) updateDeadline(item.id, payload);
    else addDeadline(payload);
    toast(item ? '已保存' : '已添加（同时在截止当天生成了一条待办）');
    onClose();
  };

  return (
    <Modal
      wide
      title={item ? '编辑截止日' : '新建截止日'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn--primary" onClick={save} disabled={!valid}>
            {item ? '保存' : '添加'}
          </button>
        </>
      }
    >
      <div className="dl-preview" style={{ borderLeftColor: color }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 620, fontSize: 13.5 }}>{title || '（还没填名字）'}</div>
          <div className="mini-note">
            {dueDate} · {daysLeft < 0 ? `已过期 ${-daysLeft} 天` : daysLeft === 0 ? '今天到期' : `还有 ${daysLeft} 天`}
            {dueTime ? ` · ${dueTime} 截止` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            {done ? '完成' : `${progress}%`}
          </div>
          <div className="mini-note">进度</div>
        </div>
      </div>

      <Field label="名称">
        <input
          className="input"
          autoFocus
          placeholder="例如：课题方案提交、奖学金材料、论文初稿"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) save();
          }}
        />
      </Field>

      <div className="grid-2">
        <Field label="截止日期">
          <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="截止时刻（可空）" hint="留空表示当天结束前交掉">
          <input type="time" className="input" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </Field>
      </div>

      <Field label="紧急程度">
        <Seg<'0' | '1' | '2'>
          value={String(priority) as '0' | '1' | '2'}
          onChange={(v) => setPriority(Number(v) as 0 | 1 | 2)}
          options={[
            { value: '0', label: '普通' },
            { value: '1', label: '重要' },
            { value: '2', label: '紧急' },
          ]}
        />
      </Field>

      <Field label="进度" hint="拖到 100% 会自动标记完成；勾上「已完成」也会把进度拉满。">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={done ? 100 : progress}
            disabled={done}
            onChange={(e) => setProgress(Number(e.target.value))}
            style={{ flex: 1, accentColor: color }}
          />
          <span style={{ width: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            {done ? 100 : progress}%
          </span>
          <label className="check">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
            <span className="check__box">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
                <path d="M4.5 12.5l5 5 10-11" />
              </svg>
            </span>
            <span className="check__label">已完成</span>
          </label>
        </div>
      </Field>

      <Field label="标签">
        <div className="tag-row">
          {DEADLINE_TAGS.map((t) => {
            const on = tags.includes(t);
            return (
              <button
                key={t}
                className={`tag-chip ${on ? 'tag-chip--active' : ''}`}
                onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
              >
                {t}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="颜色">
        <div className="picker-grid">
          {TODO_COLORS.concat(['#E8873B', '#D9A020', '#4A4F57']).map((c) => (
            <button
              key={c}
              className={`picker-swatch ${color === c ? 'picker-swatch--active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </Field>

      <Field label="备注">
        <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="要交什么、找谁、注意事项…" />
      </Field>

      <div className="mini-note" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <IconCheck size={13} />
        <span>
          保存后会自动在 <b>{dueDate}</b> 那天生成一条待办（标题相同），日历上就能看到；
          在这个截止日里加的子待办也会挂到那一天。
        </span>
      </div>
    </Modal>
  );
}
