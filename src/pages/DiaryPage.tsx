/**
 * 日记页：每天的心情、标签、日记正文。
 *
 * 从日历里独立出来的板块（日历格子上仍然显示心情，只是编辑不在这里）。
 * 左右两栏：
 *   左  迷你月历（有内容的日子显示心情 emoji 或圆点）+ 搜索框
 *   右  当天编辑区（心情/标签/正文/标记色）+ 日记时间线（点任意一条跳过去改）
 *
 * 自动保存的做法：正文改动后防抖 600ms 再写库，所以不需要"保存"按钮。
 * 注意一个坑：**不要监听 log?.diary 去回填输入框** —— 自动保存会回写数据，
 * 一回写就触发重渲染，光标会跳到末尾、正在敲的字被冲掉。只在切换日期时同步。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkbench } from '../store';
import type { DayLog } from '../types';
import {
  daysFrom,
  inMonth,
  monthGrid,
  monthLabel,
  parse,
  prettyDate,
  startOfWeek,
  solarToLunar,
  todayStr,
  WEEKDAY_SHORT,
} from '../lib/date';
import { useDebouncedCallback } from '../components/Modal';
import { IconChevronLeft, IconChevronRight } from '../components/Icons';

const MOODS = ['😄', '🙂', '😐', '😔', '😣', '😴', '🔥', '🥳', '😌', '🤔'];
const TAGS = ['充实', '平静', '焦虑', '疲惫', '开心', '忙碌', '摆烂', '专注'];
const MARK_COLORS = ['#4F6BED', '#3FA46A', '#E8873B', '#E0574F', '#7A5AE0', '#C7499B'];

export function DiaryPage() {
  const { db, setDayLog } = useWorkbench();
  const today = todayStr();

  const [selected, setSelected] = useState(today);
  const cursorDate = parse(selected);
  const [year, setYear] = useState(cursorDate.getFullYear());
  const [month, setMonth] = useState(cursorDate.getMonth() + 1);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(today);

  const log = db.dayLogs[selected];

  /** 月份前后翻页（跨年自动处理） */
  const shiftMonth = (dir: number) => {
    let m = month + dir;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  };

  /* 有内容的日记，按日期倒序 */
  const entries = useMemo(() => {
    const list = Object.values(db.dayLogs)
      .filter((l) => (l.diary && l.diary.trim()) || l.mood || (l.tags && l.tags.length))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const q = query.trim();
    if (!q) return list;
    return list.filter(
      (l) => (l.diary ?? '').includes(q) || (l.tags ?? []).some((t) => t.includes(q)) || l.date.includes(q),
    );
  }, [db.dayLogs, query]);

  const cells = useMemo(() => monthGrid(year, month, db.settings.weekStartsOn), [year, month, db.settings.weekStartsOn]);
  const weekdays = useMemo(() => {
    const start = startOfWeek(today, db.settings.weekStartsOn);
    return daysFrom(start, 7).map((d) => WEEKDAY_SHORT[parse(d).getDay()]);
  }, [today, db.settings.weekStartsOn]);

  const stats = useMemo(() => {
    const all = Object.values(db.dayLogs);
    const days = all.filter((l) => (l.diary ?? '').trim().length > 0).length;
    const moods = all.filter((l) => l.mood).length;
    const words = all.reduce((sum, l) => sum + (l.diary ?? '').replace(/\s/g, '').length, 0);
    return { days, moods, words };
  }, [db.dayLogs]);

  const pick = (date: string) => {
    setSelected(date);
    setEditing(date);
    const d = parse(date);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  return (
    <>
      <div className="diary-stats">
        <span>
          写过 <b>{stats.days}</b> 天
        </span>
        <span>
          标过心情 <b>{stats.moods}</b> 天
        </span>
        <span>
          累计 <b>{stats.words}</b> 字
        </span>
      </div>

      <div className="diary-layout">
        {/* 左栏：迷你月历 + 筛选 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <div className="card__head">
              <button className="btn btn--icon btn--sm" onClick={() => shiftMonth(-1)}>
                <IconChevronLeft size={14} />
              </button>
              <div className="card__title" style={{ minWidth: 84, textAlign: 'center' }}>
                {monthLabel(year, month)}
              </div>
              <button className="btn btn--icon btn--sm" onClick={() => shiftMonth(1)}>
                <IconChevronRight size={14} />
              </button>
              <button
                className="btn btn--sm btn--ghost"
                style={{ marginLeft: 'auto' }}
                onClick={() => pick(today)}
              >
                今天
              </button>
            </div>
            <div className="card__body" style={{ paddingTop: 10 }}>
              <div className="mini-grid">
                {weekdays.map((w, i) => (
                  <div key={`${w}-${i}`} className="mini-grid__wd">
                    {w}
                  </div>
                ))}
                {cells.map((d) => {
                  const l = db.dayLogs[d];
                  const hasDiary = !!(l?.diary ?? '').trim();
                  return (
                    <button
                      key={d}
                      className={`mini-cell ${inMonth(d, year, month) ? '' : 'mini-cell--out'} ${
                        d === today ? 'mini-cell--today' : ''
                      } ${d === selected ? 'mini-cell--sel' : ''}`}
                      onClick={() => pick(d)}
                      title={`${d}${l?.mood ? ` ${l.mood}` : ''}`}
                    >
                      <span className="mini-cell__day">{parse(d).getDate()}</span>
                      <span className="mini-cell__mark">
                        {l?.mood ? (
                          <span style={{ fontSize: 10, lineHeight: 1 }}>{l.mood}</span>
                        ) : l?.color ? (
                          <span className="cal-dot" style={{ background: l.color, width: 5, height: 5 }} />
                        ) : hasDiary ? (
                          <span className="cal-dot" style={{ background: 'var(--accent)', width: 5, height: 5, opacity: 0.6 }} />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mini-note" style={{ marginTop: 8 }}>
                格子里的小图标 = 那天的内容：emoji 是心情，圆点是有日记或标记色
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="todo-add">
                <input
                  className="input"
                  placeholder="搜索日记内容 / 标签 / 日期"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ fontSize: 12.5 }}
                />
              </div>
              <div className="mini-note">
                {entries.length ? `共 ${entries.length} 篇` : '没有匹配的日记'}
              </div>
            </div>
          </div>
        </div>

        {/* 右栏：当天编辑 + 时间线 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <DiaryEditor key={editing} date={selected} log={log} onSave={(patch) => setDayLog(selected, patch)} />

          <div className="card">
            <div className="card__head">
              <div className="card__title">日记时间线</div>
              <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>点任意一条可以跳过去编辑</div>
            </div>
            <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 420, overflowY: 'auto' }}>
              {entries.length === 0 && (
                <div className="empty" style={{ padding: '18px 0' }}>
                  {query ? '没有找到匹配的日记' : '还没有写过日记'}
                </div>
              )}
              {entries.map((e) => (
                <button
                  key={e.date}
                  className={`diary-entry ${e.date === selected ? 'diary-entry--sel' : ''}`}
                  onClick={() => pick(e.date)}
                >
                  <div className="diary-entry__head">
                    <span className="diary-entry__date">{e.date}</span>
                    <span className="diary-entry__wd">{WEEKDAY_SHORT[parse(e.date).getDay()]}</span>
                    {e.mood && <span style={{ fontSize: 14 }}>{e.mood}</span>}
                    {(e.tags ?? []).map((t) => (
                      <span key={t} className="tag-chip tag-chip--static" style={{ fontSize: 10.5 }}>
                        {t}
                      </span>
                    ))}
                  </div>
                  {e.diary && <div className="diary-entry__text">{e.diary}</div>}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*                          当天编辑区                                  */
/* ------------------------------------------------------------------ */

function DiaryEditor({
  date,
  log,
  onSave,
}: {
  date: string;
  log?: DayLog;
  onSave: (patch: Partial<DayLog>) => void;
}) {
  const [diary, setDiary] = useState(log?.diary ?? '');
  const save = useDebouncedCallback((v: string) => onSave({ diary: v }), 600);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const lunar = solarToLunar(date);

  // 只在切换日期时同步外部内容，避免自动保存回写把正在输入的字冲掉
  useEffect(() => {
    setDiary(log?.diary ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const words = diary.replace(/\s/g, '').length;

  return (
    <div className="card">
      <div className="card__head">
        <div className="card__title">{prettyDate(date)}</div>
        <div className="diary-head-meta">
          {date} · 农历{lunar.text}
          {lunar.festival ? ` · ${lunar.festival}` : ''}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{words} 字 · 自动保存</div>
      </div>
      <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <div className="field__label">今天心情</div>
          <div className="mood-row">
            {MOODS.map((m) => (
              <button
                key={m}
                className={`mood-btn ${log?.mood === m ? 'mood-btn--active' : ''}`}
                onClick={() => onSave({ mood: log?.mood === m ? undefined : m })}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <div className="field__label">标签</div>
          <div className="tag-row">
            {TAGS.map((t) => {
              const active = log?.tags?.includes(t) ?? false;
              return (
                <button
                  key={t}
                  className={`tag-chip ${active ? 'tag-chip--active' : ''}`}
                  onClick={() => {
                    const cur = log?.tags ?? [];
                    onSave({ tags: active ? cur.filter((x) => x !== t) : [...cur, t] });
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <div className="field__label">日记</div>
          <textarea
            ref={textRef}
            className="textarea diary-textarea"
            placeholder="今天发生了什么？随手写几句，自动保存。"
            value={diary}
            onChange={(e) => {
              setDiary(e.target.value);
              save(e.target.value);
            }}
          />
        </div>

        <div className="field">
          <div className="field__label">这条日记在月历上的标记色</div>
          <div className="row">
            <div className="picker-grid">
              {MARK_COLORS.map((c) => (
                <button
                  key={c}
                  className={`picker-swatch ${log?.color === c ? 'picker-swatch--active' : ''}`}
                  style={{ background: c, width: 22, height: 22 }}
                  onClick={() => onSave({ color: log?.color === c ? undefined : c })}
                  title="用作月历上的小色点"
                />
              ))}
            </div>
            {log?.color && (
              <button className="btn btn--sm btn--ghost" onClick={() => onSave({ color: undefined })}>
                清除标记色
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
