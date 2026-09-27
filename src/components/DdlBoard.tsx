/**
 * 倒数日 · 版面视图
 *
 * 固定 16:10 的"画布"，卡片按百分比坐标自由摆放（跟 PPT 摆形状一个思路）。
 * 因为用百分比，窗口放大缩小时整版等比缩放，排版不会乱。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DdlItem, ShapePoint } from '../types';
import { DEFAULT_SKIN } from '../types';
import { effectivePoints, editablePoints, pointsToPath, shapeFitUniform } from '../lib/shapes';
import { resolveSkin, StyledCard } from './StyledCard';

const CANVAS_RATIO = 16 / 10;
/** 对齐吸附阈值（百分比） */
const SNAP = 1.8;

export interface BoardCallbacks {
  onSelect: (id: string | null) => void;
  onMove: (id: string, layout: { x: number; y: number }) => void;
  onResize: (id: string, layout: { w: number; h: number; x: number; y: number }) => void;
  onOpenCard: (item: DdlItem) => void;
  onShapePoints: (id: string, points: ShapePoint[]) => void;
}

export function DdlBoard({
  items,
  layoutOf,
  editing,
  selectedId,
  showGuides,
  shapeEditing,
  onSelect,
  onMove,
  onResize,
  onOpenCard,
  onShapePoints,
}: {
  items: DdlItem[];
  /** 取某张卡的有效版面位置 */
  layoutOf: (item: DdlItem) => { x: number; y: number; w: number; h: number };
  editing: boolean;
  selectedId: string | null;
  showGuides: boolean;
  /** 是否为选中的卡显示控制点 */
  shapeEditing: boolean;
} & BoardCallbacks) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });

  /* 画布尺寸：宽度优先，按 16:10 算高度；空间不够时按高度反推 */
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const availW = el.clientWidth;
      const availH = Math.max(320, window.innerHeight - el.getBoundingClientRect().top - 28);
      let w = availW;
      let h = w / CANVAS_RATIO;
      if (h > availH) {
        h = availH;
        w = h * CANVAS_RATIO;
      }
      setBox({ w: Math.round(w), h: Math.round(h) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  /* ------------------------------------------------------------------ */
  /*                        拖动 / 缩放                                  */
  /* ------------------------------------------------------------------ */

  const dragRef = useRef<{
    id: string;
    mode: 'move' | 'resize' | 'point';
    startX: number;
    startY: number;
    base: { x: number; y: number; w: number; h: number };
    pointIndex?: number;
    points?: ShapePoint[];
  } | null>(null);

  const pct = useCallback(
    (dx: number, dy: number) => ({ dx: (dx / box.w) * 100, dy: (dy / box.h) * 100 }),
    [box.w, box.h],
  );

  const startMove = (e: React.PointerEvent, item: DdlItem, mode: 'move' | 'resize') => {
    if (!editing) return;
    e.stopPropagation();
    e.preventDefault();
    capturePointer(e);
    const base = layoutOf(item);
    dragRef.current = { id: item.id, mode, startX: e.clientX, startY: e.clientY, base };
    onSelect(item.id);
  };

  const startPoint = (e: React.PointerEvent, item: DdlItem, index: number, points: ShapePoint[]) => {
    if (!editing || !shapeEditing) return;
    e.stopPropagation();
    e.preventDefault();
    capturePointer(e);
    dragRef.current = {
      id: item.id,
      mode: 'point',
      startX: e.clientX,
      startY: e.clientY,
      base: layoutOf(item),
      pointIndex: index,
      points: points.map((p) => ({ ...p })),
    };
    onSelect(item.id);
  };

  useEffect(() => {
    if (!editing) return;
    const onMoveEvt = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const { dx, dy } = pct(e.clientX - d.startX, e.clientY - d.startY);

      if (d.mode === 'move') {
        let x = clamp(d.base.x + dx, 0, 100 - d.base.w);
        let y = clamp(d.base.y + dy, 0, 100 - d.base.h);
        /* 对齐吸附：跟画布中线/边缘，以及其他卡片对齐时吸过去 */
        const vLines = [0, 50, 100, ...items.map((it) => layoutOf(it).x), ...items.map((it) => layoutOf(it).x + layoutOf(it).w)];
        const hLines = [0, 50, 100, ...items.map((it) => layoutOf(it).y), ...items.map((it) => layoutOf(it).y + layoutOf(it).h)];
        const snappedV: number[] = [];
        const snappedH: number[] = [];
        if (showGuides) {
          for (const line of vLines) {
            if (Math.abs(x - line) < SNAP) {
              x = line;
              snappedV.push(line);
              break;
            }
            if (Math.abs(x + d.base.w / 2 - line) < SNAP) {
              x = line - d.base.w / 2;
              snappedV.push(line);
              break;
            }
            if (Math.abs(x + d.base.w - line) < SNAP) {
              x = line - d.base.w;
              snappedV.push(line);
              break;
            }
          }
          for (const line of hLines) {
            if (Math.abs(y - line) < SNAP) {
              y = line;
              snappedH.push(line);
              break;
            }
            if (Math.abs(y + d.base.h / 2 - line) < SNAP) {
              y = line - d.base.h / 2;
              snappedH.push(line);
              break;
            }
            if (Math.abs(y + d.base.h - line) < SNAP) {
              y = line - d.base.h;
              snappedH.push(line);
              break;
            }
          }
        }
        setGuides({ v: snappedV, h: snappedH });
        onMove(d.id, { x: round2(clamp(x, 0, 100 - d.base.w)), y: round2(clamp(y, 0, 100 - d.base.h)) });
        return;
      }

      if (d.mode === 'resize') {
        const w = clamp(d.base.w + dx, 8, 100 - d.base.x);
        const h = clamp(d.base.h + dy, 8, 100 - d.base.y);
        onResize(d.id, { w: round2(w), h: round2(h), x: d.base.x, y: d.base.y });
        return;
      }

      if (d.mode === 'point' && d.points && d.pointIndex !== undefined) {
        /* 控制点：按百分比移动，限制在 -10~110 之间，允许略微出框 */
        const nx = clamp(d.points[d.pointIndex].x + (dx / d.base.w) * 100, -12, 112);
        const ny = clamp(d.points[d.pointIndex].y + (dy / d.base.h) * 100, -12, 112);
        const next = d.points.map((p, i) => (i === d.pointIndex ? { x: round2(nx), y: round2(ny) } : p));
        onShapePoints(d.id, next);
      }
    };
    const onUp = () => {
      dragRef.current = null;
      setGuides({ v: [], h: [] });
    };
    window.addEventListener('pointermove', onMoveEvt);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMoveEvt);
      window.removeEventListener('pointerup', onUp);
    };
  }, [editing, items, layoutOf, onMove, onResize, onShapePoints, pct, showGuides]);

  return (
    <div className="board-wrap" ref={wrapRef}>
      <div
        className={`board ${editing ? 'board--editing' : ''}`}
        style={{ width: box.w, height: box.h }}
        onPointerDown={() => editing && onSelect(null)}
      >
        {editing && <div className="board__grid" />}

        {editing &&
          guides.v.map((v, i) => (
            <div key={`v${i}`} className="board__guide board__guide--v" style={{ left: `${v}%` }} />
          ))}
        {editing &&
          guides.h.map((h, i) => (
            <div key={`h${i}`} className="board__guide board__guide--h" style={{ top: `${h}%` }} />
          ))}

        {items.map((item) => {
          const l = layoutOf(item);
          const pw = (l.w / 100) * box.w;
          const ph = (l.h / 100) * box.h;
          const selected = selectedId === item.id;
          const skin = resolveSkin(item.skin);
          const pts = effectivePoints(skin.shape, skin.points, skin.radius);
          const handles = shapeEditing && selected ? editablePoints(pts, 16) : [];

          return (
            <div
              key={item.id}
              className={`board__card ${editing ? 'board__card--editing' : ''}`}
              style={{ left: `${l.x}%`, top: `${l.y}%`, width: `${l.w}%`, height: `${l.h}%` }}
              onPointerDown={(e) => startMove(e, item, 'move')}
              onClick={(e) => {
                e.stopPropagation();
                if (!editing) onOpenCard(item);
              }}
            >
              <StyledCard
                item={item}
                width={pw}
                height={ph}
                editing={editing}
                selected={selected && shapeEditing}
              />

              {/* 编辑模式：选中框 + 缩放角 + 控制点 */}
              {editing && selected && <span className="board__ring" />}
              {editing && selected && (
                <>
                  {handles.map((pt, i) => {
                    /* 控制点要跟渲染时一样处理等比缩放，否则拖动的点跟形状对不上 */
                    const uniform = shapeFitUniform(skin.shape) && !skin.points;
                    const side = Math.min(pw, ph);
                    const offX = uniform ? (pw - side) / 2 : 0;
                    const offY = uniform ? (ph - side) / 2 : 0;
                    const px = offX + ((pt.x / 100) * (uniform ? side : pw));
                    const py = offY + ((pt.y / 100) * (uniform ? side : ph));
                    return (
                      <span
                        key={i}
                        className="board__point"
                        style={{ left: px, top: py }}
                        onPointerDown={(e) => startPoint(e, item, i, handles)}
                        title="拖动改形状"
                      />
                    );
                  })}
                </>
              )}
              {editing && selected && shapeEditing && (
                <svg className="board__outline" width={pw} height={ph} aria-hidden>
                  <path
                    d={pointsToPath(
                      pts,
                      shapeFitUniform(skin.shape) && !skin.points ? Math.min(pw, ph) : pw,
                      shapeFitUniform(skin.shape) && !skin.points ? Math.min(pw, ph) : ph,
                    )}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    transform={
                      shapeFitUniform(skin.shape) && !skin.points
                        ? `translate(${(pw - Math.min(pw, ph)) / 2} ${(ph - Math.min(pw, ph)) / 2})`
                        : undefined
                    }
                  />
                </svg>
              )}
              {editing && selected && (
                <span
                  className="board__resize"
                  onPointerDown={(e) => startMove(e, item, 'resize')}
                  title="拖动改大小"
                />
              )}
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="board__empty">
            还没有倒数日
            <br />
            先回「列表」视图新建几条，再回来看版面
          </div>
        )}
      </div>
    </div>
  );
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * 抓住指针：这样鼠标移出画布也能继续拖。
 * 必须 try/catch —— 某些情况下（指针已释放、合成事件、跨进程焦点变化）会抛错，
 * 一旦抛出，后面的"选中卡片"逻辑就断了，表现为点了卡片没反应。
 */
function capturePointer(e: React.PointerEvent) {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  } catch {
    /* 抓不住就算了，拖动依然能用（只是移出画布会中断） */
  }
}

/** 给还没有位置的卡片算一个整齐的初始布局（网格状） */
export function autoLayout(index: number, total: number): { x: number; y: number; w: number; h: number } {
  const cols = total <= 4 ? 2 : 3;
  const rows = Math.max(1, Math.ceil(total / cols));
  const gapX = 3;
  const gapY = 4;
  const w = (100 - gapX * (cols + 1)) / cols;
  const h = (100 - gapY * (rows + 1)) / rows;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: round2(gapX + col * (w + gapX)),
    y: round2(gapY + row * (h + gapY)),
    w: round2(w),
    h: round2(h),
  };
}

export { DEFAULT_SKIN };
