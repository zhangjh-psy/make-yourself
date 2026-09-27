/**
 * 首页 / 慎独页 —— 打开 app 的第一屏，也是点侧边栏「慎独」回来的那一页。
 *
 * 整屏只有三样东西：正中间一句话（可编辑）、背景（跟随主题/纯色/渐变/图片）、
 * 底部计时文字 + 两个按钮。**没有左侧导航**，因为要的就是干净。
 *
 * 两个按钮互不冲突：
 *   主按钮   开始慎独 → 计数中变「暂停」→ 暂停后变「继续慎独」
 *   次按钮   进入工作台（去日历页），**不会打断计时**
 *
 * 计时规则（都在 store 里实现，这里只负责显示和触发）：
 *   - 开始之后**去任何板块都继续算**，不是"只在本页才算"
 *   - 反复进出是累加到"今天"，不会丢掉已经慎独的时间
 *   - 按「暂停」或**退出应用**才停表；退出时的时间已经存盘
 *   - 跨零点会切成两段，分别记到两天
 *
 * 实现上有个坑值得记一笔：这里的秒数必须用 `focusSeconds(今天)` **实时算**，
 * 不能用 store 里预先算好的值 —— 那种值是 Provider 渲染那一刻定死的，
 * 本页每秒重渲染时会一直读到旧值（数字看起来"卡住不动"）。
 */
import { useEffect, useRef, useState } from 'react';
import { useWorkbench, formatFocus } from '../store';
import type { HomeDisplay } from '../types';
import { DEFAULT_HOME } from '../types';
import { parse, prettyDate, solarToLunar, todayStr, WEEKDAY_SHORT } from '../lib/date';
import { Field } from '../components/Modal';
import { IconChevronRight, IconEdit, IconTrash, IconUpload } from '../components/Icons';
import { useToast } from '../components/Toast';

const QUOTE_COLORS = ['', '#1B1B1D', '#FFFFFF', '#4F6BED', '#E0574F', '#3FA46A', '#8E9199', '#E8873B'];
const BG_COLORS = ['#F4F4F3', '#FFFFFF', '#1B1B1D', '#2C3040', '#4F6BED', '#E0574F', '#3FA46A', '#7A5AE0'];

export function HomePage({
  started,
  onEnterApp,
  onFirstStart,
  firstRun,
  onLoadDemo,
}: {
  /** 今天是否已经进来过（决定按钮文案是"开始工作"还是"开始慎独"） */
  started: boolean;
  /** 进入工作台 */
  onEnterApp: () => void;
  /** 第一次点「开始工作」：记住，以后不再显示欢迎文案 */
  onFirstStart: () => void;
  /** 全新安装（什么都没有）：右上角给一个"载入示例数据"的入口 */
  firstRun?: boolean;
  onLoadDemo?: () => void;
}) {
  const { db, updateHome, startFocus, stopFocus, focusRunning, focusSeconds } = useWorkbench();
  const toast = useToast();
  const home = db.home ?? DEFAULT_HOME;

  /* 今天已慎独的秒数：用函数实时算（不要用预先算好的值，那样每秒刷新时会读旧值） */
  const todaySecs = focusSeconds(todayStr());
  const focusedBefore = db.focus.sessions.length > 0;

  const [editing, setEditing] = useState(false);
  /* 这个 state 本身不显示，只用来让组件每秒重渲染一次，好让计时数字动起来 */
  const [, setTick] = useState(0);

  /* 计时中每秒刷新一次显示 */
  useEffect(() => {
    if (!focusRunning) return;
    const t = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, [focusRunning]);

  /**
   * 计时是全局的：点了「开始慎独」之后，去日历/倒数日/日记都继续算，
   * 只有按「暂停」或退出应用才停。
   */
  const toggleFocus = () => {
    if (focusRunning) {
      stopFocus(); // 暂停：停表但留在首页
      return;
    }
    // 只要今天还没开始过，就顺手记一下（这样按钮文案会切换成"继续慎独"）
    if (db.focus.sessions.length === 0) onFirstStart();
    startFocus();
  };

  /* 「进入工作台」不打断计时：正在计时就让它继续跑 */
  const enterApp = () => onEnterApp();

  const today = todayStr();
  const lunar = solarToLunar(today);

  const bg = home.background;
  const bgStyle: React.CSSProperties = {};
  if (bg.type === 'image' && bg.image) {
    bgStyle.backgroundImage = `url(${bg.image})`;
    bgStyle.backgroundSize = bg.imageFit === 'cover' ? 'cover' : 'contain';
    bgStyle.backgroundPosition = 'center';
    bgStyle.backgroundRepeat = 'no-repeat';
  } else if (bg.type === 'gradient') {
    bgStyle.background = `linear-gradient(${bg.angle}deg, ${bg.color}, ${bg.color2})`;
  } else if (bg.type === 'solid') {
    bgStyle.background = bg.color;
  }

  const quoteColor = home.quoteColor || (bg.type === 'image' && home.quoteShadow ? '#fff' : 'var(--text)');

  return (
    <div className={`home ${editing ? 'home--editing' : ''}`} style={bgStyle}>
      {/* 背景图的暗色蒙版，让文字看得清 */}
      {bg.type === 'image' && bg.image && bg.imageMask > 0 && (
        <div className="home__mask" style={{ opacity: bg.imageMask / 100 }} />
      )}

      {/* 正中间那句话 */}
      <div
        className="home__quote-wrap"
        style={{ top: `${home.quotePos}%`, alignItems: home.quoteAlign === 'center' ? 'center' : 'flex-start' }}
      >
        {editing ? (
          <textarea
            className="home__quote-input"
            style={{
              fontSize: home.quoteSize,
              color: quoteColor,
              fontWeight: home.quoteWeight,
              textAlign: home.quoteAlign,
            }}
            value={home.quote}
            placeholder="写一句给自己的话…"
            onChange={(e) => updateHome({ quote: e.target.value })}
            rows={2}
          />
        ) : (
          <div
            className="home__quote"
            style={{
              fontSize: home.quoteSize,
              color: quoteColor,
              fontWeight: home.quoteWeight,
              textAlign: home.quoteAlign,
              textShadow: home.quoteShadow && bg.type === 'image' ? '0 2px 18px rgba(0,0,0,0.55)' : undefined,
            }}
          >
            {home.quote}
          </div>
        )}
      </div>

      {/* 慎独计时 + 按钮 */}
      <div className="home__bottom">
        <div className="home__timer">
          {focusRunning ? (
            <>
              正在慎独 · 今天已 <b>{formatFocus(todaySecs)}</b>
            </>
          ) : focusedBefore || started ? (
            <>
              今日已慎独 <b>{formatFocus(todaySecs)}</b>
            </>
          ) : (
            <>
              {prettyDate(today)} · 农历{lunar.text}
            </>
          )}
        </div>

        {/* 两个按钮互不冲突：慎独是慎独，进工作台是进工作台 */}
        <div className="row" style={{ gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn--primary btn--lg" onClick={toggleFocus}>
            {focusRunning ? '暂停' : focusedBefore ? '继续慎独' : '开始慎独'}
          </button>
          <button className="btn btn--ghost btn--lg" onClick={enterApp}>
            进入工作台 <IconChevronRight size={15} />
          </button>
        </div>

        <div className="home__hint">
          {focusRunning
            ? '计时中：去日历、倒数日、日记都继续算，退出应用才停'
            : focusedBefore
              ? '点「继续慎独」接着累计；今天已经慎独过的时间不会丢'
              : '点「开始慎独」开始记录；之后去哪都继续计时，退出应用才停'}
        </div>
      </div>

      {/* 右下角：编辑（平时很淡，鼠标移上去才明显） */}
      <div className="home__corner">
        {firstRun && onLoadDemo && !editing && (
          <button className="home__ghostbtn" onClick={onLoadDemo} title="先放几条示例数据看看">
            载入示例数据
          </button>
        )}
        {!editing && (
          <button className="home__ghostbtn" onClick={() => setEditing(true)} title="编辑这句话和背景">
            <IconEdit size={14} />
          </button>
        )}
        {editing && (
          <button className="home__ghostbtn home__ghostbtn--solid" onClick={() => setEditing(false)}>
            完成
          </button>
        )}
      </div>

      {/* 编辑面板 */}
      {editing && <HomePanel home={home} patch={(p) => updateHome(p)} onToast={toast} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                          编辑面板                                    */
/* ------------------------------------------------------------------ */

function HomePanel({
  home,
  patch,
  onToast,
}: {
  home: HomeDisplay;
  patch: (p: Partial<HomeDisplay>) => void;
  onToast: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const setBg = (p: Partial<HomeDisplay['background']>) => patch({ background: { ...home.background, ...p } });
  const bg = home.background;

  const pickImage = async (file: File) => {
    try {
      const dataUrl = await compressImage(file, 1920, 0.85);
      setBg({ type: 'image', image: dataUrl });
      const kb = Math.round((dataUrl.length * 3) / 4 / 1024);
      onToast(`背景图已设置（约 ${kb}KB，会存在数据文件里）`);
    } catch (err) {
      onToast(`图片处理失败：${String(err)}`);
    }
  };

  return (
    <aside className="home-panel">
      <div className="home-panel__head">
        <span>首页设置</span>
      </div>
      <div className="home-panel__body">
        <Field label="那句话" hint="直接在上面点着改也行">
          <textarea
            className="textarea"
            style={{ minHeight: 56, fontSize: 13 }}
            value={home.quote}
            onChange={(e) => patch({ quote: e.target.value })}
            placeholder="写一句给自己的话…"
          />
        </Field>

        <div className="field">
          <div className="field__label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>字号</span>
            <span style={{ color: 'var(--text-3)' }}>{home.quoteSize}px</span>
          </div>
          <input
            type="range"
            min={16}
            max={96}
            value={home.quoteSize}
            className="skin-range"
            onChange={(e) => patch({ quoteSize: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <div className="field__label">粗细</div>
          <div className="seg" style={{ width: '100%' }}>
            {(
              [
                [300, '细'],
                [400, '正常'],
                [500, '中'],
                [700, '粗'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                className={`seg__item ${home.quoteWeight === v ? 'seg__item--active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => patch({ quoteWeight: v })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <div className="field__label">文字颜色</div>
          <div className="skin-colors">
            {QUOTE_COLORS.map((c, i) => (
              <button
                key={c || `auto-${i}`}
                className={`skin-swatch ${home.quoteColor === c ? 'skin-swatch--active' : ''} ${!c ? 'skin-swatch--empty' : ''}`}
                style={c ? { background: c } : undefined}
                onClick={() => patch({ quoteColor: c })}
                title={c || '跟随主题'}
              />
            ))}
            <input
              type="color"
              className="skin-color-input"
              value={home.quoteColor || '#1b1b1d'}
              onChange={(e) => patch({ quoteColor: e.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <div className="field__label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>垂直位置</span>
            <span style={{ color: 'var(--text-3)' }}>{home.quotePos}%</span>
          </div>
          <input
            type="range"
            min={12}
            max={88}
            value={home.quotePos}
            className="skin-range"
            onChange={(e) => patch({ quotePos: Number(e.target.value) })}
          />
          <div className="field__hint">有些背景图中间正好有东西，可以把文字挪开</div>
        </div>

        <div className="field">
          <div className="field__label">对齐</div>
          <div className="seg">
            <button className={`seg__item ${home.quoteAlign === 'center' ? 'seg__item--active' : ''}`} onClick={() => patch({ quoteAlign: 'center' })}>
              居中
            </button>
            <button className={`seg__item ${home.quoteAlign === 'left' ? 'seg__item--active' : ''}`} onClick={() => patch({ quoteAlign: 'left' })}>
              左对齐
            </button>
          </div>
        </div>

        <label className="check">
          <input type="checkbox" checked={home.quoteShadow} onChange={(e) => patch({ quoteShadow: e.target.checked })} />
          <span className="check__box">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
              <path d="M4.5 12.5l5 5 10-11" />
            </svg>
          </span>
          <span className="check__label">文字加阴影（背景图花时更清楚）</span>
        </label>

        <div className="field">
          <div className="field__label">背景</div>
          <div className="seg" style={{ width: '100%' }}>
            {(
              [
                ['none', '跟随主题'],
                ['solid', '纯色'],
                ['gradient', '渐变'],
                ['image', '图片'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                className={`seg__item ${bg.type === v ? 'seg__item--active' : ''}`}
                style={{ flex: 1, fontSize: 11.5 }}
                onClick={() => setBg({ type: v })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {bg.type === 'solid' && (
          <div className="field">
            <div className="field__label">背景色</div>
            <div className="skin-colors">
              {BG_COLORS.map((c) => (
                <button
                  key={c}
                  className={`skin-swatch ${bg.color === c ? 'skin-swatch--active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setBg({ color: c })}
                />
              ))}
              <input type="color" className="skin-color-input" value={bg.color} onChange={(e) => setBg({ color: e.target.value })} />
            </div>
          </div>
        )}

        {bg.type === 'gradient' && (
          <>
            <div className="field">
              <div className="field__label">渐变（起 → 止）</div>
              <div className="skin-colors">
                <input type="color" className="skin-color-input" value={bg.color} onChange={(e) => setBg({ color: e.target.value })} />
                {BG_COLORS.slice(0, 5).map((c) => (
                  <button key={c} className="skin-swatch" style={{ background: c }} onClick={() => setBg({ color: c })} />
                ))}
              </div>
              <div className="skin-colors" style={{ marginTop: 6 }}>
                <input type="color" className="skin-color-input" value={bg.color2} onChange={(e) => setBg({ color2: e.target.value })} />
                {BG_COLORS.slice(0, 5).map((c) => (
                  <button key={c} className="skin-swatch" style={{ background: c }} onClick={() => setBg({ color2: c })} />
                ))}
              </div>
            </div>
            <div className="field">
              <div className="field__label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>渐变角度</span>
                <span style={{ color: 'var(--text-3)' }}>{bg.angle}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={360}
                value={bg.angle}
                className="skin-range"
                onChange={(e) => setBg({ angle: Number(e.target.value) })}
              />
            </div>
          </>
        )}

        {bg.type === 'image' && (
          <>
            <div className="field">
              <div className="field__label">背景图片</div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn--sm" onClick={() => fileRef.current?.click()}>
                  <IconUpload size={13} /> 选择图片
                </button>
                {bg.image && (
                  <button className="btn btn--sm btn--ghost" onClick={() => setBg({ image: undefined })}>
                    移除
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
              {bg.image && (
                <div className="mini-note" style={{ marginTop: 6 }}>
                  约 {Math.round((bg.image.length * 3) / 4 / 1024)}KB，存在数据文件里
                </div>
              )}
            </div>
            <div className="field">
              <div className="field__label">填充方式</div>
              <div className="seg">
                <button className={`seg__item ${bg.imageFit === 'cover' ? 'seg__item--active' : ''}`} onClick={() => setBg({ imageFit: 'cover' })}>
                  铺满
                </button>
                <button
                  className={`seg__item ${bg.imageFit === 'contain' ? 'seg__item--active' : ''}`}
                  onClick={() => setBg({ imageFit: 'contain' })}
                >
                  完整显示
                </button>
              </div>
            </div>
            <div className="field">
              <div className="field__label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>暗色蒙版</span>
                <span style={{ color: 'var(--text-3)' }}>{bg.imageMask}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={80}
                value={bg.imageMask}
                className="skin-range"
                onChange={(e) => setBg({ imageMask: Number(e.target.value) })}
              />
              <div className="field__hint">图片太亮时加一点，字更清楚</div>
            </div>
          </>
        )}

        <FocusStats />

        <button className="btn btn--sm" style={{ width: '100%' }} onClick={() => patch({ ...DEFAULT_HOME, background: { ...DEFAULT_HOME.background } })}>
          <IconTrash size={13} /> 恢复默认
        </button>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*                        慎独统计（7 天 + 本月）                        */
/* ------------------------------------------------------------------ */

function FocusStats() {
  const { focusSeconds } = useWorkbench();
  const today = todayStr();

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const p = (n: number) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return { date, secs: focusSeconds(date), wd: WEEKDAY_SHORT[d.getDay()] };
  });
  const max = Math.max(60, ...days.map((d) => d.secs));

  /* 本月 */
  const y = parse(today).getFullYear();
  const m = parse(today).getMonth() + 1;
  const lastDay = new Date(y, m, 0).getDate();
  const monthDays = Array.from({ length: lastDay }, (_, i) => {
    const date = `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    return { date, secs: focusSeconds(date) };
  });
  const monthTotal = monthDays.reduce((s, d) => s + d.secs, 0);
  const activeDays = monthDays.filter((d) => d.secs > 0).length;
  const maxDay = Math.max(60, ...monthDays.map((d) => d.secs));

  return (
    <div className="field">
      <div className="field__label">慎独记录</div>

      <div className="focus-bars">
        {days.map((d) => (
          <div className="focus-bar" key={d.date} title={`${d.date} ${formatFocus(d.secs)}`}>
            <div className="focus-bar__track">
              <div
                className={`focus-bar__fill ${d.date === today ? 'focus-bar__fill--today' : ''}`}
                style={{ height: `${Math.max(d.secs > 0 ? 6 : 0, (d.secs / max) * 100)}%` }}
              />
            </div>
            <span className="focus-bar__label">{d.wd}</span>
          </div>
        ))}
      </div>

      <div className="mini-note" style={{ marginTop: 8 }}>
        最近 7 天 · 共 <b>{formatFocus(days.reduce((s, d) => s + d.secs, 0))}</b>
      </div>

      <div className="focus-month">
        {monthDays.map((d) => (
          <span
            key={d.date}
            className={`focus-month__day ${d.secs > 0 ? 'focus-month__day--on' : ''} ${d.date === today ? 'focus-month__day--today' : ''}`}
            style={d.secs > 0 ? { opacity: 0.25 + (d.secs / maxDay) * 0.75 } : undefined}
            title={`${d.date} ${formatFocus(d.secs)}`}
          />
        ))}
      </div>
      <div className="mini-note" style={{ marginTop: 6 }}>
        {m} 月 · 共 <b>{formatFocus(monthTotal)}</b> · 有慎独 {activeDays} 天
      </div>
    </div>
  );
}

/** 把图片压到指定宽度以内 */
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
  if (img.width <= maxWidth && dataUrl.length < 600_000) return dataUrl;
  const scale = Math.min(1, maxWidth / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
