/**
 * 卡片外观属性面板（版面视图右侧滑出）
 * 形状 / 背景 / 透明度 / 文字 / 显示项 / 复制样式
 */
import { useRef } from 'react';
import type { CardSkin, DdlItem, ShapePreset } from '../types';
import { DEFAULT_SKIN, SHAPE_LABEL, SHAPE_LIST } from '../types';
import { resolveSkin } from './StyledCard';
import { basePoints } from '../lib/shapes';
import { Field } from './Modal';
import { IconTrash, IconUpload } from './Icons';
import { useToast } from './Toast';

const BG_PRESETS = [
  '#FFFFFF',
  '#F4F4F3',
  '#1B1B1D',
  '#4F6BED',
  '#E0574F',
  '#E8873B',
  '#3FA46A',
  '#7A5AE0',
  '#C7499B',
  '#2FA3A3',
];
const TEXT_COLORS = ['', '#1B1B1D', '#FFFFFF', '#4F6BED', '#E0574F', '#3FA46A', '#8E9199', '#E8873B'];

export function SkinPanel({
  item,
  patch,
  onDelete,
  onCopyStyle,
  targets,
}: {
  item: DdlItem;
  patch: (p: Partial<CardSkin>) => void;
  onDelete: () => void;
  onCopyStyle: (toIds: string[]) => void;
  /** 可以贴样式的其他卡片 */
  targets: DdlItem[];
}) {
  const skin = resolveSkin(item.skin);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const setBg = (p: Partial<CardSkin['background']>) => patch({ background: { ...skin.background, ...p } });
  const setShow = (k: keyof CardSkin['show'], v: boolean) => patch({ show: { ...skin.show, [k]: v } });

  /** 选图片：自动压缩后再存，避免数据文件变大 */
  const pickImage = async (file: File) => {
    try {
      const dataUrl = await compressImage(file, 1200, 0.82);
      setBg({ type: 'image', image: dataUrl });
      const kb = Math.round((dataUrl.length * 3) / 4 / 1024);
      toast(kb > 400 ? `图片已压缩到约 ${kb}KB（数据文件会变大，注意备份大小）` : `图片已设置（约 ${kb}KB）`);
    } catch (err) {
      toast(`图片处理失败：${String(err)}`);
    }
  };

  return (
    <aside className="skin-panel">
      <div className="skin-panel__head">
        <span className="skin-panel__title">{item.emoji} {item.title}</span>
        <button className="ddl-icon-btn" title="删除这张卡" onClick={onDelete}>
          <IconTrash size={13} />
        </button>
      </div>

      <div className="skin-panel__body">
        {/* 形状 */}
        <Field label="形状">
          <div className="shape-grid">
            {SHAPE_LIST.map((s) => (
              <button
                key={s}
                className={`shape-chip ${skin.shape === s && !skin.points ? 'shape-chip--active' : ''}`}
                onClick={() => patch({ shape: s, points: undefined })}
                title={SHAPE_LABEL[s]}
              >
                <ShapeThumb shape={s} />
                <span>{SHAPE_LABEL[s]}</span>
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn--sm" onClick={() => patch({ shape: 'rect', points: undefined, radius: DEFAULT_SKIN.radius })}>
              恢复普通形状
            </button>
            {skin.points && (
              <button className="btn btn--sm btn--ghost" onClick={() => patch({ points: undefined })}>
                重置为预设形状
              </button>
            )}
          </div>
          <div className="field__hint">
            {skin.points
              ? `已自定义形状（${skin.points.length} 个控制点）。拖画布上的圆点改形状；拖歪了点「重置为预设形状」。`
              : '选一个底样，然后拖画布上的圆点就能改成任意形状。'}
          </div>
        </Field>

        <Slider label="圆角" value={skin.radius} min={0} max={50} onChange={(v) => patch({ radius: v })} unit="%" hint="自定义形状后此项不再生效" />
        <Slider label="描边粗细" value={skin.borderWidth} min={0} max={8} step={0.5} onChange={(v) => patch({ borderWidth: v })} />
        <div className="field">
          <div className="field__label">描边颜色</div>
          <ColorRow value={skin.borderColor} onChange={(c) => patch({ borderColor: c })} allowEmpty={false} />
        </div>
        <Slider label="投影" value={skin.shadow} min={0} max={100} onChange={(v) => patch({ shadow: v })} unit="%" />

        {/* 背景 */}
        <Field label="背景">
          <div className="seg" style={{ width: '100%' }}>
            {(
              [
                ['none', '无'],
                ['solid', '纯色'],
                ['gradient', '渐变'],
                ['image', '图片'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                className={`seg__item ${skin.background.type === v ? 'seg__item--active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setBg({ type: v })}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        {skin.background.type === 'solid' && (
          <div className="field">
            <div className="field__label">背景色</div>
            <ColorRow value={skin.background.color} onChange={(c) => setBg({ color: c })} />
            <div className="field__hint">选「透明」就是没有底色，只留形状和文字</div>
          </div>
        )}

        {skin.background.type === 'gradient' && (
          <>
            <div className="field">
              <div className="field__label">渐变（起 → 止）</div>
              <ColorRow value={skin.background.color} onChange={(c) => setBg({ color: c })} allowEmpty={false} />
              <ColorRow value={skin.background.color2} onChange={(c) => setBg({ color2: c })} allowEmpty={false} />
            </div>
            <Slider label="渐变角度" value={skin.background.angle} min={0} max={360} onChange={(v) => setBg({ angle: v })} unit="°" />
          </>
        )}

        {skin.background.type === 'image' && (
          <>
            <div className="field">
              <div className="field__label">图片</div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn--sm" onClick={() => fileRef.current?.click()}>
                  <IconUpload size={13} /> 选择图片
                </button>
                {skin.background.image && (
                  <button className="btn btn--sm btn--ghost" onClick={() => setBg({ image: undefined })}>
                    移除图片
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void pickImage(f);
                    e.target.value = '';
                  }}
                />
              </div>
              {skin.background.image && (
                <div className="skin-panel__thumb">
                  <img src={skin.background.image} alt="背景预览" />
                  <span className="mini-note">
                    约 {Math.round((skin.background.image.length * 3) / 4 / 1024)}KB，存在数据文件里
                  </span>
                </div>
              )}
            </div>
            <div className="field">
              <div className="field__label">填充方式</div>
              <div className="seg">
                <button
                  className={`seg__item ${skin.background.imageFit === 'cover' ? 'seg__item--active' : ''}`}
                  onClick={() => setBg({ imageFit: 'cover' })}
                >
                  铺满
                </button>
                <button
                  className={`seg__item ${skin.background.imageFit === 'contain' ? 'seg__item--active' : ''}`}
                  onClick={() => setBg({ imageFit: 'contain' })}
                >
                  完整显示
                </button>
              </div>
            </div>
            <Slider
              label="暗色蒙版"
              value={skin.background.imageMask}
              min={0}
              max={80}
              onChange={(v) => setBg({ imageMask: v })}
              unit="%"
              hint="图片太亮时加一点，文字更清楚"
            />
          </>
        )}

        {skin.background.type !== 'none' && (
          <Slider label="背景透明度" value={skin.background.opacity} min={0} max={100} onChange={(v) => setBg({ opacity: v })} unit="%" />
        )}
        <Slider label="整卡透明度" value={skin.cardOpacity} min={10} max={100} onChange={(v) => patch({ cardOpacity: v })} unit="%" />

        {/* 文字 */}
        <div className="field">
          <div className="field__label">文字颜色</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ColorLine
              label="标题"
              value={skin.textColors.title}
              onChange={(c) => patch({ textColors: { ...skin.textColors, title: c } })}
            />
            <ColorLine
              label="大数字"
              value={skin.textColors.number}
              onChange={(c) => patch({ textColors: { ...skin.textColors, number: c } })}
            />
            <ColorLine
              label="小字"
              value={skin.textColors.small}
              onChange={(c) => patch({ textColors: { ...skin.textColors, small: c } })}
            />
          </div>
          <div className="field__hint">留空 = 用默认色（大数字默认跟随卡片颜色）</div>
        </div>
        <Slider label="字号" value={skin.scale} min={60} max={220} onChange={(v) => patch({ scale: v })} unit="%" />
        <Slider label="大数字字号" value={skin.numberScale} min={50} max={200} onChange={(v) => patch({ numberScale: v })} unit="%" />
        <Slider
          label="内容内边距"
          value={skin.padding}
          min={0}
          max={40}
          onChange={(v) => patch({ padding: v })}
          unit="%"
          hint="自己拉的形状文字容易露出去，用它把文字往里收"
        />

        {/* 显示项 */}
        <Field label="卡片上显示">
          <div className="skin-panel__toggles">
            {(
              [
                ['emoji', 'emoji'],
                ['title', '标题'],
                ['label', '还有/已过'],
                ['number', '大数字'],
                ['anniversary', '周年附注'],
                ['precise', '精确倒计时'],
                ['date', '日期'],
                ['weekday', '星期'],
                ['lunar', '农历'],
                ['repeat', '重复标签'],
              ] as const
            ).map(([k, label]) => (
              <label className="check" key={k}>
                <input type="checkbox" checked={skin.show[k]} onChange={(e) => setShow(k, e.target.checked)} />
                <span className="check__box">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
                    <path d="M4.5 12.5l5 5 10-11" />
                  </svg>
                </span>
                <span className="check__label">{label}</span>
              </label>
            ))}
          </div>
        </Field>

        {/* 复制样式 */}
        <Field label="复制这张卡的样式" hint="勾选要贴过去的卡片，会覆盖它们的形状/背景/文字设置">
          <div className="skin-panel__targets">
            {targets.length === 0 && <span className="mini-note">没有别的卡片</span>}
            {targets.map((t) => (
              <label className="check" key={t.id}>
                <input
                  type="checkbox"
                  onChange={(e) => {
                    if (e.target.checked) {
                      onCopyStyle([t.id]);
                      e.target.checked = false;
                    }
                  }}
                />
                <span className="check__box">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
                    <path d="M4.5 12.5l5 5 10-11" />
                  </svg>
                </span>
                <span className="check__label">
                  {t.emoji} {t.title}
                </span>
              </label>
            ))}
          </div>
        </Field>

        <button className="btn btn--sm btn--danger" style={{ width: '100%' }} onClick={() => patch({ ...DEFAULT_SKIN, points: undefined })}>
          这张卡恢复默认外观
        </button>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <div className="field__label" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-3)', fontWeight: 500 }}>
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="skin-range"
      />
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}

function ColorRow({ value, onChange, allowEmpty = true }: { value: string; onChange: (c: string) => void; allowEmpty?: boolean }) {
  return (
    <div className="skin-colors">
      {allowEmpty && (
        <button
          className={`skin-swatch skin-swatch--empty ${!value ? 'skin-swatch--active' : ''}`}
          onClick={() => onChange('')}
          title="透明/默认"
        />
      )}
      {BG_PRESETS.map((c) => (
        <button
          key={c}
          className={`skin-swatch ${value.toLowerCase() === c.toLowerCase() ? 'skin-swatch--active' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          title={c}
        />
      ))}
      <input type="color" className="skin-color-input" value={value || '#ffffff'} onChange={(e) => onChange(e.target.value)} title="自定义颜色" />
    </div>
  );
}

function ColorLine({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <span style={{ width: 46, fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
      <div className="skin-colors">
        <button
          className={`skin-swatch skin-swatch--empty ${!value ? 'skin-swatch--active' : ''}`}
          onClick={() => onChange('')}
          title="默认"
        />
        {TEXT_COLORS.filter(Boolean).map((c) => (
          <button
            key={c}
            className={`skin-swatch ${value.toLowerCase() === c.toLowerCase() ? 'skin-swatch--active' : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            title={c}
          />
        ))}
        <input type="color" className="skin-color-input" value={value || '#1b1b1d'} onChange={(e) => onChange(e.target.value)} title="自定义颜色" />
      </div>
    </div>
  );
}

/** 形状小预览 */
function ShapeThumb({ shape }: { shape: ShapePreset }) {
  const pts = basePoints(shape, 18);
  const d = pts
    .map((p, i) => {
      const x = 2 + (p.x / 100) * 26;
      const y = 2 + (p.y / 100) * 20;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={30} height={24} viewBox="0 0 30 24" aria-hidden>
      <path d={`${d} Z`} fill="currentColor" opacity={0.22} />
      <path d={`${d} Z`} fill="none" stroke="currentColor" strokeWidth={1.2} />
    </svg>
  );
}

/** 把图片压到指定宽度以内，返回 dataURL */
async function compressImage(file: File, maxWidth: number, quality: number): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('图片读取失败'));
    im.src = dataUrl;
  });
  if (img.width <= maxWidth && dataUrl.length < 400_000) return dataUrl;
  const scale = Math.min(1, maxWidth / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
