/**
 * 倒数日页：纪念日 / 生日 / 考试倒计时。
 *
 * 两种**互相独立**的视图，右上角切换：
 *   列表  快速看"还剩多少天"，按住卡片可拖动排序；**不套用自定义外观**，保证信息清爽
 *   版面  当设计版面用：自由摆放位置、改大小、拉控制点做形状、配背景和文字
 *         外观相关的东西（形状/背景/文字/显示项）全都只在这一种视图里生效
 *
 * 页面内还包含三个弹窗：新建·编辑（DdlEditor）、详情（DdlDetail）、删除确认。
 * 编辑器最麻烦的部分是**农历录入**：农历年/月/日、闰月判断、实时换算成公历、以及
 * 周年数（所以「农历年」必须填出生那一年，否则周年数会算成 1）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkbench } from '../store';
import {
  CATEGORIES,
  DDL_COLORS,
  DDL_EMOJIS,
  type CalendarMode,
  type CardSkin,
  type DdlItem,
  type Recurrence,
} from '../types';
import {
  computeDdl,
  festivalOf,
  lunarDayName,
  lunarMonthDays,
  lunarMonthName,
  lunarMonthsOfYear,
  lunarToSolar,
  parse,
  prettyDate,
  preciseRemain,
  solarToLunar,
  todayStr,
} from '../lib/date';
import { Check, ConfirmModal, Field, Modal, Seg, Switch } from '../components/Modal';
import {
  IconBell,
  IconCheck,
  IconClock,
  IconDragHandle,
  IconEdit,
  IconPin,
  IconPlus,
  IconRepeat,
  IconTrash,
} from '../components/Icons';
import { useToast } from '../components/Toast';
import { DdlBoard, autoLayout } from '../components/DdlBoard';
import { SkinPanel } from '../components/SkinPanel';
import { resolveSkin } from '../components/StyledCard';

const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: '不重复',
  'yearly-solar': '每年（公历）',
  'yearly-lunar': '每年（农历）',
  monthly: '每月',
  weekly: '每周',
};

const YEAR_RANGE = 5;

export function DdlPage() {
  const { db, updateDdl, removeDdl, setDdlOrder } = useWorkbench();
  const toast = useToast();
  const [editing, setEditing] = useState<DdlItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<DdlItem | null>(null);
  const [deleting, setDeleting] = useState<DdlItem | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /* 视图：列表（原样，按自己拖的顺序）｜版面（自己摆形状和位置） */
  const [view, setView] = useState<'list' | 'board'>('list');
  const [boardEditing, setBoardEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGuides, setShowGuides] = useState(true);
  const today = todayStr();

  /* 顺序完全由你自己拖出来（order 字段），不再有自动排序 */
  const list = useMemo(
    () =>
      db.ddl
        .map((d) => ({ d, c: computeDdl(d, today) }))
        .sort((a, b) => {
          const ao = a.d.order ?? 0;
          const bo = b.d.order ?? 0;
          if (ao !== bo) return ao - bo;
          return a.d.createdAt - b.d.createdAt;
        }),
    [db.ddl, today],
  );

  /** 把正在拖的卡片放到目标位置，然后保存顺序 */
  const dropOn = (targetId: string) => {
    const sourceId = dragId;
    setDragId(null);
    setOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = list.map(({ d }) => d.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    setDdlOrder(ids);
    toast('顺序已保存');
  };

  /* ---------------- 版面视图相关 ---------------- */

  /** 取某张卡在画布上的位置：没设过就按顺序算一个整齐的初始布局 */
  const layoutOf = useCallback(
    (item: DdlItem) => {
      if (item.layout) return item.layout;
      const index = Math.max(0, list.findIndex(({ d }) => d.id === item.id));
      return autoLayout(index, Math.max(1, list.length));
    },
    [list],
  );

  const selectedItem = view === 'board' ? list.find(({ d }) => d.id === selectedId)?.d ?? null : null;
  const boardItems = list.map(({ d }) => d);

  const patchSkin = (id: string, p: Partial<CardSkin>) => {
    const cur = db.ddl.find((d) => d.id === id);
    if (!cur) return;
    updateDdl(id, { skin: { ...resolveSkin(cur.skin), ...p } });
  };

  return (
    <>
      <div className="ddl-toolbar">
        <Seg<'list' | 'board'>
          value={view}
          onChange={(v) => {
            setView(v);
            if (v === 'list') {
              setBoardEditing(false);
              setSelectedId(null);
            }
          }}
          options={[
            { value: 'list', label: '列表' },
            { value: 'board', label: '版面' },
          ]}
        />

        {view === 'list' ? (
          <span className="mini-note">按住卡片拖动可以调整顺序</span>
        ) : (
          <>
            <button
              className={`btn ${boardEditing ? 'btn--primary' : ''}`}
              onClick={() => {
                setBoardEditing((v) => !v);
                if (boardEditing) setSelectedId(null);
              }}
            >
              {boardEditing ? '完成编辑' : '编辑布局'}
            </button>
            {boardEditing && (
              <>
                <span className="mini-note">拖动卡片改位置 · 拖右下角改大小 · 选中后拖圆点改形状</span>
                <label className="check">
                  <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
                  <span className="check__box">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
                      <path d="M4.5 12.5l5 5 10-11" />
                    </svg>
                  </span>
                  <span className="check__label">对齐辅助线</span>
                </label>
              </>
            )}
          </>
        )}

        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <IconPlus /> 新建倒数日
          </button>
        </div>
      </div>

      {view === 'board' ? (
        <div className={`ddl-board-layout ${selectedItem && boardEditing ? 'ddl-board-layout--panel' : ''}`}>
          <DdlBoard
            items={boardItems}
            layoutOf={layoutOf}
            editing={boardEditing}
            selectedId={selectedId}
            showGuides={showGuides}
            shapeEditing={boardEditing}
            onSelect={setSelectedId}
            onOpenCard={(item) => setDetail(item)}
            onMove={(id, l) => updateDdl(id, { layout: { ...layoutOf(db.ddl.find((d) => d.id === id)!), ...l } })}
            onResize={(id, l) => updateDdl(id, { layout: l })}
            onShapePoints={(id, points) => patchSkin(id, { points })}
          />
          {boardEditing && selectedItem && (
            <SkinPanel
              item={selectedItem}
              patch={(p) => patchSkin(selectedItem.id, p)}
              onDelete={() => setDeleting(selectedItem)}
              onCopyStyle={(ids) => {
                const src = resolveSkin(selectedItem.skin);
                ids.forEach((id) => updateDdl(id, { skin: { ...src, points: src.points ? src.points.map((p) => ({ ...p })) : undefined } }));
                toast('样式已复制');
              }}
              targets={db.ddl.filter((d) => d.id !== selectedItem.id)}
            />
          )}
        </div>
      ) : list.length === 0 ? (
        <div className="card">
          <div className="empty">
            <span className="empty__emoji">⏳</span>
            还没有倒数日
            <br />
            点右上角「新建倒数日」，把生日、考试、纪念日记下来
          </div>
        </div>
      ) : (
        <div className="ddl-grid">
          {list.map(({ d }) => (
            <div
              key={d.id}
              className={`ddl-slot ddl-slot--manual ${dragId === d.id ? 'ddl-slot--dragging' : ''} ${
                overId === d.id && dragId !== d.id ? 'ddl-slot--over' : ''
              }`}
              draggable
              onDragStart={() => setDragId(d.id)}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(d.id);
              }}
              onDragLeave={() => setOverId((cur) => (cur === d.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(d.id);
              }}
            >
              <ListCard
                item={d}
                onOpen={() => setDetail(d)}
                onPin={() => updateDdl(d.id, { pinned: !d.pinned })}
                onEdit={() => setEditing(d)}
                onDelete={() => setDeleting(d)}
              />
              <span className="ddl-slot__handle" title="拖动排序">
                <IconDragHandle />
              </span>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <DdlEditor
          item={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {detail && <DdlDetail item={detail} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null); }} />}

      {deleting && (
        <ConfirmModal
          title="删除这个倒数日？"
          danger
          confirmText="删除"
          message={
            <>
              将删除「<b>{deleting.title}</b>」，此操作不可撤销。
            </>
          }
          onConfirm={() => {
            removeDdl(deleting.id);
            toast('已删除');
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*                          列表视图的卡片                              */
/* ------------------------------------------------------------------ */

/** 列表里的卡片：量出自己的宽度后交给 StyledCard 渲染，这样自定义背景在小尺寸下也好看 */
function ListCard({
  item,
  onOpen,
  onPin,
  onEdit,
  onDelete,
}: {
  item: DdlItem;
  onOpen: () => void;
  onPin: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const today = todayStr();
  const c = computeDdl(item, today);
  const stop = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation();
    fn();
  };

  /* 列表视图保持原样：不受"版面"里设的形状/背景影响，只展示信息，方便快速扫一眼 */
  return (
    <div className="ddl-cardwrap" onClick={onOpen}>
      <div className="ddl-card">
          <div className="ddl-card__stripe" style={{ background: item.color }} />
          <div className="ddl-card__top">
            <div className="ddl-card__emoji" style={{ background: `${item.color}1F`, color: item.color }}>
              {item.emoji}
            </div>
            <div className="ddl-card__title" title={item.title}>
              {item.title}
            </div>
            {item.pinned && (
              <span className="ddl-card__pin ddl-card__pin--on" title="已置顶">
                <IconPin />
              </span>
            )}
          </div>

          <div className="ddl-card__main">
            <span className="ddl-card__label">{c.label}</span>
            <span className="ddl-card__num" style={{ color: c.dayDiff === 0 ? item.color : undefined }}>
              {c.bigNumber}
            </span>
            <span className="ddl-card__unit">{c.unit}</span>
          </div>

          {item.anniversaryStyle && <div className="ddl-card__sub">第 {c.anniversaryNth} 周年</div>}

          {item.precise && c.targetMs !== undefined && <PreciseLine targetMs={c.targetMs} color={item.color} />}

          <div className="ddl-card__foot">
            <span>
              {c.occurrence} ·{' '}
              {prettyDate(c.occurrence).replace(`${parse(c.occurrence).getMonth() + 1}月${parse(c.occurrence).getDate()}日 `, '')}
            </span>
            {item.calendar === 'lunar' && <span className="ddl-card__tag">农历 {solarToLunar(c.occurrence).text}</span>}
            {item.recurrence !== 'none' && (
              <span className="ddl-card__tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <IconRepeat /> {RECURRENCE_LABEL[item.recurrence]}
              </span>
            )}
          </div>
      </div>

      <div className="ddl-card__actions">
        <button className="ddl-icon-btn" title={item.pinned ? '取消置顶' : '置顶'} onClick={(e) => stop(e, onPin)}>
          <IconPin />
        </button>
        <button className="ddl-icon-btn" title="编辑" onClick={(e) => stop(e, onEdit)}>
          <IconEdit />
        </button>
        <button className="ddl-icon-btn" title="删除" onClick={(e) => stop(e, onDelete)}>
          <IconTrash />
        </button>
      </div>
    </div>
  );
}

/** 精确倒计时：每秒刷新 */
function PreciseLine({ targetMs, color }: { targetMs: number; color: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const r = preciseRemain(targetMs);
  void now;
  if (r.negative) {
    const total = Math.floor((Date.now() - targetMs) / 1000);
    const d = Math.floor(total / 86400);
    return (
      <div className="ddl-card__precise">
        已过去 <b>{d}</b> 天 <b>{String(Math.floor((total % 86400) / 3600)).padStart(2, '0')}</b>:
        <b>{String(Math.floor((total % 3600) / 60)).padStart(2, '0')}</b>:
        <b>{String(total % 60).padStart(2, '0')}</b>
      </div>
    );
  }
  return (
    <div className="ddl-card__precise" style={{ color: undefined }}>
      距离目标还有 <b style={{ color }}>{r.d}</b> 天 <b style={{ color }}>{String(r.h).padStart(2, '0')}</b>:
      <b style={{ color }}>{String(r.m).padStart(2, '0')}</b>:<b style={{ color }}>{String(r.s).padStart(2, '0')}</b>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                            详情弹窗                                  */
/* ------------------------------------------------------------------ */

function DdlDetail({ item, onClose, onEdit }: { item: DdlItem; onClose: () => void; onEdit: () => void }) {
  const today = todayStr();
  const c = computeDdl(item, today);
  const lunar = solarToLunar(c.occurrence);
  const rows: [string, React.ReactNode][] = [
    ['目标日期', `${c.occurrence}${item.calendar === 'lunar' ? `（农历 ${lunar.text}）` : ''}`],
    ['星期', prettyDate(c.occurrence).split(' ')[1] ?? ''],
    ['节日', festivalOf(c.occurrence) || '—'],
    ['重复', item.recurrence === 'none' ? '不重复' : RECURRENCE_LABEL[item.recurrence]],
    ['分类', item.category || '—'],
    ['提醒', item.remindEnabled ? item.remindDaysBefore.map((d) => (d === 0 ? '当天' : `提前${d}天`)).join('、') || '未设置' : '已关闭'],
  ];

  return (
    <Modal
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span>{item.emoji}</span>
          {item.title}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          <button className="btn btn--primary" onClick={onEdit}>
            <IconEdit /> 编辑
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{c.label}</span>
        <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -2, color: item.color, fontVariantNumeric: 'tabular-nums' }}>
          {c.bigNumber}
        </span>
        <span style={{ color: 'var(--text-2)' }}>{c.unit}</span>
      </div>

      {item.anniversaryStyle && c.anniversaryNth && (
        <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>🎂 第 {c.anniversaryNth} 周年</div>
      )}

      {item.precise && c.targetMs !== undefined && <PreciseLine targetMs={c.targetMs} color={item.color} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {rows.map(([k, v]) => (
          <div className="setting-row" key={k}>
            <div className="setting-row__main">
              <div className="setting-row__desc">{k}</div>
              <div className="setting-row__title" style={{ fontWeight: 500 }}>
                {v}
              </div>
            </div>
          </div>
        ))}
      </div>

      {item.note && <div className="path-box" style={{ fontFamily: 'var(--font)', fontSize: 12.5 }}>{item.note}</div>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*                            新建 / 编辑                               */
/* ------------------------------------------------------------------ */

function DdlEditor({ item, onClose }: { item: DdlItem | null; onClose: () => void }) {
  const { db, addDdl, updateDdl } = useWorkbench();
  const toast = useToast();
  const today = todayStr();
  const baseYear = parse(today).getFullYear();

  const [title, setTitle] = useState(item?.title ?? '');
  const [calendar, setCalendar] = useState<CalendarMode>(item?.calendar ?? 'solar');
  const [solarDate, setSolarDate] = useState(item?.date ?? today);
  // 农历年份：新建时默认今年；编辑旧条目时用它原本的年份（这样生日才显示得出正确的周年数）
  const [lunarYear, setLunarYear] = useState(
    item?.calendar === 'lunar' && item?.date ? parse(item.date).getFullYear() : baseYear,
  );
  const [lunarMonth, setLunarMonth] = useState(item?.lunar?.month ?? 1);
  const [lunarLeap, setLunarLeap] = useState(!!item?.lunar?.leap);
  const [lunarDay, setLunarDay] = useState(item?.lunar?.day ?? 1);
  const [recurrence, setRecurrence] = useState<Recurrence>(item?.recurrence ?? 'none');
  const [category, setCategory] = useState(item?.category ?? '纪念日');
  const [emoji, setEmoji] = useState(item?.emoji ?? '⭐️');
  const [color, setColor] = useState(item?.color ?? db.settings.accent);
  const [pinned, setPinned] = useState(item?.pinned ?? false);
  const [precise, setPrecise] = useState(item?.precise ?? false);
  const [anniversaryStyle, setAnniversaryStyle] = useState(item?.anniversaryStyle ?? false);
  const [note, setNote] = useState(item?.note ?? '');
  const [remindEnabled, setRemindEnabled] = useState(item?.remindEnabled ?? true);
  const [remindDays, setRemindDays] = useState<number[]>(item?.remindDaysBefore ?? db.settings.defaultRemindDaysBefore);

  /* 农历年份候选：覆盖到很早的年份（生日/出生年份需要），往后多给几年 */
  const lunarYears = useMemo(() => {
    const out: number[] = [];
    const start = Math.min(1930, baseYear - 100);
    for (let y = start; y <= baseYear + YEAR_RANGE; y++) out.push(y);
    return out;
  }, [baseYear]);

  const monthOptions = useMemo(() => {
    const months = lunarMonthsOfYear(lunarYear);
    return months.map((m) => ({
      value: m,
      label: lunarMonthName(Math.abs(m), m < 0),
    }));
  }, [lunarYear]);

  /* 当前农历月天数（闰月也算） */
  const dayCount = useMemo(() => lunarMonthDays(lunarYear, lunarMonth, lunarLeap), [lunarYear, lunarMonth, lunarLeap]);

  useEffect(() => {
    // 换月/换年后，如果原来的日在当前月不存在就退回最后一天
    if (lunarDay > dayCount) setLunarDay(dayCount);
  }, [dayCount, lunarDay]);

  /* 农历 -> 公历换算结果，用于保存和预览 */
  const lunarConverted = useMemo(() => {
    if (calendar !== 'lunar') return null;
    if (lunarLeap && !lunarMonthsOfYear(lunarYear).includes(-lunarMonth)) return null;
    return lunarToSolar(lunarYear, lunarMonth, lunarDay, lunarLeap);
  }, [calendar, lunarYear, lunarMonth, lunarDay, lunarLeap]);

  const finalDate = calendar === 'lunar' ? lunarConverted?.date ?? '' : solarDate;
  const valid = title.trim().length > 0 && !!finalDate;

  /* 实时预览 */
  const preview: DdlItem = useMemo(
    () => ({
      id: item?.id ?? 'preview',
      title: title || '（未命名）',
      date: finalDate || today,
      calendar,
      lunar: calendar === 'lunar' ? { month: lunarMonth, day: lunarDay, leap: lunarLeap } : undefined,
      recurrence,
      color,
      emoji,
      pinned,
      precise,
      remindDaysBefore: remindDays,
      remindEnabled,
      category,
      anniversaryStyle,
      createdAt: item?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }),
    [item, title, finalDate, today, calendar, lunarMonth, lunarDay, lunarLeap, recurrence, color, emoji, pinned, precise, remindDays, remindEnabled, category, anniversaryStyle],
  );
  const pc = computeDdl(preview, today);

  const save = () => {
    if (!valid) return;
    const payload: Partial<DdlItem> & { title: string; date: string } = {
      title: title.trim(),
      date: finalDate,
      calendar,
      lunar: calendar === 'lunar' ? { month: lunarMonth, day: lunarDay, leap: lunarLeap } : undefined,
      recurrence,
      category,
      emoji,
      color,
      pinned,
      precise,
      anniversaryStyle,
      note: note.trim(),
      remindEnabled,
      remindDaysBefore: remindDays.length ? remindDays : [0],
    };
    if (item) updateDdl(item.id, payload);
    else addDdl(payload);
    toast(item ? '已保存' : '已添加');
    onClose();
  };

  const toggleRemindDay = (d: number) => {
    setRemindDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => b - a)));
  };

  return (
    <Modal
      wide
      title={item ? '编辑倒数日' : '新建倒数日'}
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
      {/* 预览 */}
      <div
        style={{
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          background: 'var(--bg-sunken)',
          padding: '12px 15px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 22 }}>{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 620, fontSize: 13.5 }}>{title || '（还没填名字）'}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 1 }}>
            {finalDate
              ? `${finalDate} · ${prettyDate(finalDate).split(' ')[1] ?? ''}${
                  calendar === 'lunar' && lunarConverted ? ` · 农历${lunarConverted.leap ? '闰' : ''}${lunarMonthName(lunarMonth)}${lunarDayName(lunarDay)}` : ''
                }`
              : '请先把日期选完整'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            {valid ? pc.bigNumber : '—'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{valid ? `${pc.label}${pc.unit}` : ''}</div>
        </div>
      </div>

      <Field label="名称">
        <input
          className="input"
          autoFocus
          placeholder="例如：考研初试、妈妈生日、结婚纪念日"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) save();
          }}
        />
      </Field>

      <div className="grid-2">
        <Field label="日期类型">
          <Seg<CalendarMode>
            value={calendar}
            onChange={(v) => setCalendar(v)}
            options={[
              { value: 'solar', label: '公历' },
              { value: 'lunar', label: '农历' },
            ]}
          />
        </Field>
        <Field label="分类">
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {calendar === 'solar' ? (
        <Field label="日期" hint="公历日期。若开启「每年重复」，会自动滚到下一次。">
          <input type="date" className="input" value={solarDate} onChange={(e) => setSolarDate(e.target.value)} />
        </Field>
      ) : (
        <div className="grid-2">
          <Field
            label="农历年"
            hint={
              item?.anniversaryStyle || anniversaryStyle
                ? '填出生那一年（或要纪念的那一年），下面会算出到今年是第几周年。'
                : '只用来换算成公历日期；开启"每年重复"后每年会自动按农历重算。'
            }
          >
            <select className="select" value={lunarYear} onChange={(e) => setLunarYear(Number(e.target.value))}>
              {lunarYears.map((y) => (
                <option key={y} value={y}>
                  {y} 年
                </option>
              ))}
            </select>
          </Field>
          <Field label="农历月">
            <select
              className="select"
              value={lunarLeap ? -lunarMonth : lunarMonth}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLunarMonth(Math.abs(v));
                setLunarLeap(v < 0);
              }}
            >
              {monthOptions.map((m, i) => (
                <option key={`${m.label}-${i}`} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="农历日" hint={calendar === 'lunar' && !lunarConverted ? '这个农历日在所选年份不存在，换个日子试试' : undefined}>
            <select
              className="select"
              value={lunarDay}
              onChange={(e) => setLunarDay(Number(e.target.value))}
              style={!lunarConverted ? { borderColor: 'var(--danger)' } : undefined}
            >
              {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {lunarDayName(d)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="对应公历">
            <input className="input" readOnly value={lunarConverted?.date ?? '—'} />
          </Field>
        </div>
      )}

      <Field label="外观">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="picker-grid">
            {DDL_COLORS.map((c) => (
              <button
                key={c}
                className={`picker-swatch ${color === c ? 'picker-swatch--active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                title={c}
              />
            ))}
          </div>
          <div className="picker-grid">
            {DDL_EMOJIS.map((e) => (
              <button
                key={e}
                className={`picker-emoji ${emoji === e ? 'picker-emoji--active' : ''}`}
                onClick={() => setEmoji(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </Field>

      <div className="grid-2">
        <Field label="重复" hint="农历生日请选「每年（农历）」">
          <select className="select" value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((k) => (
              <option key={k} value={k}>
                {RECURRENCE_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="选项">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 3 }}>
            <Check checked={pinned} onChange={setPinned} label={<><IconPin /> 置顶显示</>} />
            <Check
              checked={precise}
              onChange={setPrecise}
              label={
                <>
                  <IconClock /> 精确倒计时（到时分秒）
                </>
              }
            />
            <Check
              checked={anniversaryStyle}
              onChange={setAnniversaryStyle}
              label={
                <>
                  <IconCheck /> 生日/周年样式（显示第 N 周年）
                </>
              }
            />
          </div>
        </Field>
      </div>

      <Field label="提醒">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Switch on={remindEnabled} onChange={setRemindEnabled} />
          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
            {remindEnabled ? '到日子前弹 Windows 通知' : '已关闭这条的提醒'}
          </span>
        </div>
        {remindEnabled && (
          <div className="tag-row" style={{ marginTop: 9 }}>
            {[30, 14, 7, 3, 1, 0].map((d) => (
              <button
                key={d}
                className={`tag-chip ${remindDays.includes(d) ? 'tag-chip--active' : ''}`}
                onClick={() => toggleRemindDay(d)}
              >
                <IconBell /> {d === 0 ? '当天' : `提前 ${d} 天`}
              </button>
            ))}
          </div>
        )}
      </Field>

      <Field label="备注">
        <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="想记点什么…" />
      </Field>
    </Modal>
  );
}
