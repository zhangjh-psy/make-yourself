/**
 * 带皮肤的倒数日卡片
 *
 * 渲染结构（从下到上）：
 *   1. SVG clipPath —— 只用来裁"背景"，文字不会被裁
 *   2. SVG 路径填充 —— 背景纯色/渐变/图片 + 投影
 *   3. SVG 描边 —— 形状外框
 *   4. 内容层 —— emoji、标题、大数字、标签…（用内边距把字收进形状里）
 *
 * 为什么不直接用 CSS clip-path：它会连文字和描边一起裁掉。
 */
import { useEffect, useMemo, useState } from 'react';
import type { CardSkin, DdlItem } from '../types';
import { DEFAULT_SKIN } from '../types';
import { computeDdl, parse, prettyDate, preciseRemain, solarToLunar, todayStr } from '../lib/date';
import { effectivePoints, pointsToPath, shapeFitUniform } from '../lib/shapes';
import { IconPin } from './Icons';

export function resolveSkin(skin?: CardSkin): CardSkin {
  if (!skin) return DEFAULT_SKIN;
  return {
    ...DEFAULT_SKIN,
    ...skin,
    background: { ...DEFAULT_SKIN.background, ...(skin.background ?? {}) },
    textColors: { ...DEFAULT_SKIN.textColors, ...(skin.textColors ?? {}) },
    show: { ...DEFAULT_SKIN.show, ...(skin.show ?? {}) },
  };
}

/** 生成稳定的 id（同一张卡每次渲染都一样，避免 clipPath 引用错乱） */
function useIds(id: string) {
  return useMemo(
    () => ({
      clip: `clip-${id}`,
      grad: `grad-${id}`,
      pattern: `pat-${id}`,
    }),
    [id],
  );
}

export function StyledCard({
  item,
  width,
  height,
  selected,
  editing,
  onClick,
  children,
}: {
  item: DdlItem;
  /** 卡片实际像素宽度 */
  width: number;
  /** 卡片实际像素高度 */
  height: number;
  selected?: boolean;
  /** 是否处于布局编辑模式（显示虚线选中框） */
  editing?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const skin = resolveSkin(item.skin);
  const ids = useIds(item.id);
  const today = todayStr();
  const c = computeDdl(item, today);
  const lunarNow = solarToLunar(c.occurrence);

  const w = Math.max(1, width);
  const h = Math.max(1, height);

  /* 控制点 → 路径 */
  const pts = effectivePoints(skin.shape, skin.points, skin.radius);
  const uniform = shapeFitUniform(skin.shape) && !skin.points;
  const fitPts = useMemo(() => {
    if (!uniform) return pts;
    // 等比：按短边算，保证圆形是正的圆
    const side = Math.min(w, h);
    const offX = (w - side) / 2;
    const offY = (h - side) / 2;
    return pts.map((p) => ({ x: offX + (p.x / 100) * side, y: offY + (p.y / 100) * side }));
  }, [pts, uniform, w, h]);

  const pathD = useMemo(() => {
    if (uniform) return pointsToPath(fitPts, 1, 1);
    return pointsToPath(pts, w, h);
  }, [uniform, fitPts, pts, w, h]);

  /* 背景 */
  const bg = skin.background;
  const fill = bg.type === 'gradient' ? `url(#${ids.grad})` : bg.type === 'image' ? 'transparent' : bg.color;
  const bgOpacity = bg.type === 'none' ? 0 : Math.max(0, Math.min(100, bg.opacity)) / 100;
  const maskOpacity = Math.max(0, Math.min(100, bg.imageMask)) / 100;

  /* 字号：跟着卡片宽度走，保证大卡片字大、小卡片字小 */
  const base = Math.max(7, Math.min(30, w * 0.035)) * (skin.scale / 100);
  const fontTitle = base * 1.0;
  const fontNumber = base * 2.9 * (skin.numberScale / 100);
  const fontSmall = base * 0.78;

  /* 内边距：自由形状时用户自己调；固定预设按形状给个合理值 */
  const pad = (skin.padding / 100) * Math.min(w, h);

  const textColor = {
    title: skin.textColors.title || 'var(--text)',
    number: skin.textColors.number || item.color,
    small: skin.textColors.small || 'var(--text-3)',
  };

  const radiusPx = (skin.radius / 100) * Math.min(w, h);

  return (
    <div
      className={`scard ${editing ? 'scard--editing' : ''} ${selected ? 'scard--selected' : ''}`}
      style={{
        width: w,
        height: h,
        opacity: Math.max(0, Math.min(100, skin.cardOpacity)) / 100,
      }}
      onClick={onClick}
    >
      {/* 形状层：背景 + 描边 */}
      <svg className="scard__svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <defs>
          <clipPath id={ids.clip}>
            <path d={pathD} />
          </clipPath>
          {bg.type === 'gradient' && (
            <linearGradient id={ids.grad} gradientTransform={`rotate(${bg.angle} 0.5 0.5)`}>
              <stop offset="0%" stopColor={bg.color} stopOpacity={bgOpacity} />
              <stop offset="100%" stopColor={bg.color2} stopOpacity={bgOpacity} />
            </linearGradient>
          )}
          {bg.type === 'image' && bg.image && (
            <pattern id={ids.pattern} patternUnits="userSpaceOnUse" width={w} height={h}>
              <image
                href={bg.image}
                x="0"
                y="0"
                width={w}
                height={h}
                preserveAspectRatio={bg.imageFit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
                opacity={bgOpacity}
              />
            </pattern>
          )}
        </defs>

        {/* 背景填充（图片在这里，用同一个 clipPath 裁形状） */}
        {bg.type === 'image' && bg.image ? (
          <g clipPath={`url(#${ids.clip})`}>
            <rect x="0" y="0" width={w} height={h} fill={`url(#${ids.pattern})`} />
            {maskOpacity > 0 && <rect x="0" y="0" width={w} height={h} fill="#000" opacity={maskOpacity} />}
          </g>
        ) : bg.type !== 'none' ? (
          <path d={pathD} fill={fill} />
        ) : null}

        {/* 描边 */}
        {skin.borderWidth > 0 && (
          <path
            d={pathD}
            fill="none"
            stroke={skin.borderColor}
            strokeWidth={skin.borderWidth}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* 内容层 */}
      <div
        className="scard__content"
        style={{ padding: pad, paddingTop: pad * 0.8 }}
      >
        <div className="scard__inner">
          {skin.show.title || skin.show.emoji ? (
            <div className="scard__top">
              {skin.show.emoji && (
                <span
                  className="scard__emoji"
                  style={{
                    fontSize: fontTitle * 1.25,
                    width: fontTitle * 2,
                    height: fontTitle * 2,
                    borderRadius: Math.min(radiusPx, fontTitle),
                    background: `${item.color}22`,
                    color: item.color,
                  }}
                >
                  {item.emoji}
                </span>
              )}
              {skin.show.title && (
                <span className="scard__title" style={{ fontSize: fontTitle, color: textColor.title }} title={item.title}>
                  {item.title}
                </span>
              )}
              {item.pinned && <IconPin size={Math.max(9, fontSmall)} />}
            </div>
          ) : null}

          {skin.show.label || skin.show.number ? (
            <div className="scard__main">
              {skin.show.label && (
                <span style={{ fontSize: fontSmall * 1.15, color: textColor.small }}>{c.label}</span>
              )}
              {skin.show.number && (
                <span className="scard__num" style={{ fontSize: fontNumber, color: textColor.number }}>
                  {c.bigNumber}
                </span>
              )}
              {skin.show.number && <span style={{ fontSize: fontSmall * 1.15, color: textColor.small }}>{c.unit}</span>}
            </div>
          ) : null}

          {skin.show.anniversary && item.anniversaryStyle && c.anniversaryNth && (
            <div style={{ fontSize: fontSmall, color: textColor.small }}>第 {c.anniversaryNth} 周年</div>
          )}

          {skin.show.precise && item.precise && c.targetMs !== undefined && (
            <PreciseLine targetMs={c.targetMs} color={textColor.number} size={fontSmall} />
          )}

          {skin.show.date && (
            <div className="scard__foot" style={{ fontSize: fontSmall, color: textColor.small }}>
              <span>
                {c.occurrence}
                {skin.show.weekday
                  ? ` · ${prettyDate(c.occurrence).replace(`${parse(c.occurrence).getMonth() + 1}月${parse(c.occurrence).getDate()}日 `, '')}`
                  : ''}
              </span>
              {skin.show.lunar && item.calendar === 'lunar' && <span className="scard__tag">农历 {lunarNow.text}</span>}
              {skin.show.repeat && item.recurrence !== 'none' && <span className="scard__tag">重复</span>}
            </div>
          )}
        </div>
      </div>

      {editing && <span className="scard__editring" />}
      {children}
    </div>
  );
}

/** 每秒刷新一次的计时器（用于精确倒计时） */
function useTick() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setN((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return n;
}

/** 精确倒计时：每秒刷新 */
function PreciseLine({ targetMs, color, size }: { targetMs: number; color: string; size: number }) {
  useTick();
  const r = preciseRemain(targetMs);
  if (r.negative) {
    const total = Math.floor((Date.now() - targetMs) / 1000);
    const d = Math.floor(total / 86400);
    return (
      <div className="scard__precise" style={{ fontSize: size, color }}>
        已过去 {d} 天 {String(Math.floor((total % 86400) / 3600)).padStart(2, '0')}:
        {String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:{String(total % 60).padStart(2, '0')}
      </div>
    );
  }
  return (
    <div className="scard__precise" style={{ fontSize: size, color }}>
      还剩 {r.d} 天 {String(r.h).padStart(2, '0')}:{String(r.m).padStart(2, '0')}:{String(r.s).padStart(2, '0')}
    </div>
  );
}
