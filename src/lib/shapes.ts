/**
 * 卡片形状工具
 *
 * 形状由「控制点」定义，是 0-100 的百分比坐标（相对卡片自己的框）。
 * 用 SVG 路径渲染而不是 CSS clip-path，原因：
 *  - clip-path 会把文字一起裁掉，描边也会被切
 *  - SVG 可以做到"只裁背景、文字完整、描边投影正常、放大不糊"
 */
import type { ShapePoint, ShapePreset } from '../types';

/** 把点缩放到卡片实际像素尺寸 */
export function toPixels(points: ShapePoint[], w: number, h: number): ShapePoint[] {
  return points.map((p) => ({ x: (p.x / 100) * w, y: (p.y / 100) * h }));
}

/** 生成 SVG path 字符串 */
export function pointsToPath(points: ShapePoint[], w: number, h: number, close = true): string {
  if (!points.length) return '';
  const px = toPixels(points, w, h);
  let d = `M ${px[0].x.toFixed(2)} ${px[0].y.toFixed(2)}`;
  for (let i = 1; i < px.length; i++) d += ` L ${px[i].x.toFixed(2)} ${px[i].y.toFixed(2)}`;
  return close ? `${d} Z` : d;
}

/** 圆角矩形的近似点集（半径用 0-100 的百分比表示） */
export function roundedRectPoints(radius: number, steps = 3): ShapePoint[] {
  const r = Math.max(0, Math.min(49, radius));
  if (r < 0.5) {
    return [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
  }
  const pts: ShapePoint[] = [];
  const corners: { cx: number; cy: number; from: number; to: number }[] = [
    { cx: 100 - r, cy: r, from: -90, to: 0 }, // 右上
    { cx: 100 - r, cy: 100 - r, from: 0, to: 90 }, // 右下
    { cx: r, cy: 100 - r, from: 90, to: 180 }, // 左下
    { cx: r, cy: r, from: 180, to: 270 }, // 左上
  ];
  for (const c of corners) {
    for (let i = 0; i <= steps; i++) {
      const deg = c.from + ((c.to - c.from) * i) / steps;
      const rad = (deg * Math.PI) / 180;
      pts.push({ x: c.cx + r * Math.cos(rad), y: c.cy + r * Math.sin(rad) });
    }
  }
  return pts;
}

/** 椭圆/圆形的近似点集 */
function ellipsePoints(steps = 24): ShapePoint[] {
  const pts: ShapePoint[] = [];
  for (let i = 0; i < steps; i++) {
    const rad = (i / steps) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: 50 + 50 * Math.cos(rad), y: 50 + 50 * Math.sin(rad) });
  }
  return pts;
}

/** 星星 */
function starPoints(spikes = 5, innerRatio = 0.42): ShapePoint[] {
  const pts: ShapePoint[] = [];
  const total = spikes * 2;
  for (let i = 0; i < total; i++) {
    const r = i % 2 === 0 ? 50 : 50 * innerRatio;
    const rad = (i / total) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) });
  }
  return pts;
}

/**
 * 各预设底样的基础点位。
 * 注意：圆形/星形这类"不能拉伸"的形状，渲染时会按较短的边等比缩放（见 shapeFitUniform）。
 */
export function basePoints(shape: ShapePreset, radius = 16): ShapePoint[] {
  switch (shape) {
    case 'rect':
      return roundedRectPoints(radius);
    case 'chamfer': {
      const c = 18;
      return [
        { x: c, y: 0 },
        { x: 100 - c, y: 0 },
        { x: 100, y: c },
        { x: 100, y: 100 - c },
        { x: 100 - c, y: 100 },
        { x: c, y: 100 },
        { x: 0, y: 100 - c },
        { x: 0, y: c },
      ];
    }
    case 'circle':
    case 'capsule':
      return ellipsePoints(28);
    case 'ellipse':
      return ellipsePoints(28);
    case 'hexagon':
      return [
        { x: 25, y: 0 },
        { x: 75, y: 0 },
        { x: 100, y: 50 },
        { x: 75, y: 100 },
        { x: 25, y: 100 },
        { x: 0, y: 50 },
      ];
    case 'diamond':
      return [
        { x: 50, y: 0 },
        { x: 100, y: 50 },
        { x: 50, y: 100 },
        { x: 0, y: 50 },
      ];
    case 'trapezoid':
      return [
        { x: 18, y: 0 },
        { x: 82, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ];
    case 'star':
      return starPoints(5);
    case 'bubble': {
      // 圆角方框 + 左下角一个小尾巴（指示性"小尖角"）
      const r = 14;
      const box: ShapePoint[] = [
        { x: r, y: 0 },
        { x: 100 - r, y: 0 },
        { x: 100, y: r },
        { x: 100, y: 74 - r },
        { x: 100 - r, y: 74 },
        { x: 38, y: 74 },
        { x: 14, y: 98 },
        { x: 22, y: 74 },
        { x: r, y: 74 },
        { x: 0, y: 74 - r },
        { x: 0, y: r },
      ];
      return box;
    }
    default:
      return roundedRectPoints(radius);
  }
}

/** 形状是否需要"等比缩放"（按短边算），这样圆形不会被拉成椭圆、星星不会变形 */
export function shapeFitUniform(shape: ShapePreset): boolean {
  return shape === 'circle' || shape === 'star' || shape === 'hexagon' || shape === 'diamond';
}

/**
 * 取得卡片当前应该用的控制点：
 * 用户自定义过就用他的，否则用预设底样
 */
export function effectivePoints(
  shape: ShapePreset,
  custom: ShapePoint[] | undefined,
  radius: number,
): ShapePoint[] {
  if (custom && custom.length >= 3) return custom;
  return basePoints(shape, radius);
}

/** 编辑用的控制点：显示全部顶点；顶点太多时挑一部分，避免糊成一团 */
export function editablePoints(points: ShapePoint[], maxPoints = 16): ShapePoint[] {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const out: ShapePoint[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(points[Math.floor(i * step)]);
  return out;
}
