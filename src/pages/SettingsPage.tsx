/**
 * 设置页：把散落各处的开关和工具集中到一处。
 *
 * 分四块：
 *   外观     主题、强调色、每周起始日
 *   提醒与后台  通知总开关、开机自启、托盘、早间汇总、悬浮窗
 *   数据     数据文件位置、导出 JSON / Markdown、导入、备份文件夹、桌面快捷方式
 *   谨慎操作  载入示例数据、清空待办日记、恢复出厂
 *
 * 设计原则：**所有后台功能都给开关，默认值只是建议**。
 * 危险操作（清空/恢复出厂）一律走 ConfirmModal 二次确认，并且页面里反复提示先导出。
 */
import React, { useState } from 'react';
import { useWorkbench } from '../store';
import { ConfirmModal, Field, Seg, Switch } from '../components/Modal';
import { useToast } from '../components/Toast';
import { IconDownload, IconFolder, IconSparkle, IconUpload } from '../components/Icons';
import { emptyDb, DATA_VERSION } from '../lib/seed';
import { todayStr } from '../lib/date';
import { APP_NAME, AUTHOR, IS_BETA, releasesUrl, versionLabel } from '../lib/version';

const ACCENTS = ['#4F6BED', '#2F7FD8', '#3FA46A', '#E0574F', '#E8873B', '#7A5AE0', '#C7499B', '#4A4F57'];

export function SettingsPage({ onLoadDemo }: { onLoadDemo: () => void }) {
  const { db, updateSettings, replaceDb, dataDir, dbFile } = useWorkbench();
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const s = db.settings;

  const exportJson = async () => {
    const res = await window.workbench.exportFile(`工作台数据-${todayStr()}.json`, JSON.stringify(db, null, 2));
    if (res.ok) toast(`已导出到 ${res.path}`);
  };

  const exportMarkdown = async () => {
    const lines: string[] = ['# 工作台数据导出', '', `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
    lines.push('## 倒数日', '');
    for (const d of db.ddl) {
      lines.push(`- ${d.emoji} **${d.title}** — ${d.date}（${d.category}）${d.note ? ` · ${d.note}` : ''}`);
    }
    lines.push('', '## 待办', '');
    for (const t of db.todos) {
      lines.push(`- [${t.done ? 'x' : ' '}] ${t.date} ${t.dueTime ?? ''} ${t.title}${t.repeat !== 'none' ? `（重复：${t.repeat}）` : ''}`);
    }
    lines.push('', '## 日记', '');
    for (const [date, log] of Object.entries(db.dayLogs).sort()) {
      lines.push(`### ${date} ${log.mood ?? ''} ${(log.tags ?? []).join(' ')}`, '', log.diary ?? '', '');
    }
    const res = await window.workbench.exportFile(`工作台数据-${todayStr()}.md`, lines.join('\n'));
    if (res.ok) toast(`已导出到 ${res.path}`);
  };

  const importJson = async () => {
    const res = await window.workbench.importFile();
    if (!res.ok) {
      if (res.error) toast(`导入失败：${res.error}`);
      return;
    }
    if (res.db) {
      replaceDb(res.db);
      toast('导入成功');
    }
  };

  return (
    <>
      <div className="card settings-section">
        <div className="card__head">
          <div className="card__title">外观</div>
        </div>
        <div className="card__body" style={{ paddingTop: 6, paddingBottom: 6 }}>
          <SettingRow title="主题" desc="亮色 / 深色，随时切换">
            <Seg<'light' | 'dark'>
              value={s.theme}
              onChange={(v) => updateSettings({ theme: v })}
              options={[
                { value: 'light', label: '亮色' },
                { value: 'dark', label: '深色' },
              ]}
            />
          </SettingRow>
          <SettingRow title="强调色" desc="按钮、选中态、进度条用的颜色">
            <div className="picker-grid">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  className={`picker-swatch ${s.accent.toLowerCase() === c.toLowerCase() ? 'picker-swatch--active' : ''}`}
                  style={{ background: c }}
                  onClick={() => updateSettings({ accent: c })}
                  title={c}
                />
              ))}
            </div>
          </SettingRow>
          <SettingRow title="每周从哪天开始" desc="影响日历的排列顺序">
            <Seg<'0' | '1'>
              value={String(s.weekStartsOn) as '0' | '1'}
              onChange={(v) => updateSettings({ weekStartsOn: Number(v) as 0 | 1 })}
              options={[
                { value: '1', label: '周一' },
                { value: '0', label: '周日' },
              ]}
            />
          </SettingRow>
        </div>
      </div>

      <div className="card settings-section">
        <div className="card__head">
          <div className="card__title">提醒与后台</div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>所有功能都可以单独开关</div>
        </div>
        <div className="card__body" style={{ paddingTop: 6, paddingBottom: 6 }}>
          <SettingRow title="倒数日提醒" desc="到日子前弹 Windows 通知（提前几天在每条倒数日里单独设置）">
            <Switch on={s.remindersEnabled} onChange={(v) => updateSettings({ remindersEnabled: v })} />
          </SettingRow>
          <SettingRow title="开机自动启动" desc="开机后静默在后台运行，这样提醒才来得及弹出来">
            <Switch on={s.autoLaunch} onChange={(v) => updateSettings({ autoLaunch: v })} />
          </SettingRow>
          <SettingRow title="关闭窗口时最小化到托盘" desc="关掉这个，点 × 就直接退出程序">
            <Switch on={s.minimizeToTray} onChange={(v) => updateSettings({ minimizeToTray: v })} />
          </SettingRow>
          <SettingRow title="每天早上汇总提醒" desc="到点用一条通知告诉你今天要做的事">
            <div className="row">
              {s.morningDigest && (
                <input
                  type="time"
                  className="input"
                  style={{ width: 108 }}
                  value={s.morningDigestTime}
                  onChange={(e) => updateSettings({ morningDigestTime: e.target.value })}
                />
              )}
              <Switch on={s.morningDigest} onChange={(v) => updateSettings({ morningDigest: v })} />
            </div>
          </SettingRow>
          <SettingRow title="补发错过的提醒" desc="开机时把最近错过但还没处理的提醒补给你">
            <Switch on={s.catchUpMissed} onChange={(v) => updateSettings({ catchUpMissed: v })} />
          </SettingRow>
          <SettingRow
            title="桌面悬浮窗"
            desc="屏幕角落常显最近的倒数日，可以拖动位置，不占任务栏"
          >
            <div className="row">
              {s.floatingWindow && (
                <select
                  className="select"
                  style={{ width: 118 }}
                  value={s.floatingShow}
                  onChange={(e) => updateSettings({ floatingShow: e.target.value as typeof s.floatingShow })}
                >
                  <option value="pinned">只显示置顶</option>
                  <option value="nearest">最近 4 条</option>
                  <option value="today">今天待办</option>
                </select>
              )}
              <Switch
                on={s.floatingWindow}
                onChange={async (v) => {
                  updateSettings({ floatingWindow: v });
                  await window.workbench.windowAction('toggle-float');
                }}
              />
            </div>
          </SettingRow>
          <SettingRow title="默认提前提醒天数" desc="新建倒数日时默认勾选的提前天数">
            <div className="tag-row">
              {[30, 14, 7, 3, 1, 0].map((d) => {
                const active = s.defaultRemindDaysBefore.includes(d);
                return (
                  <button
                    key={d}
                    className={`tag-chip ${active ? 'tag-chip--active' : ''}`}
                    onClick={() => {
                      const next = active
                        ? s.defaultRemindDaysBefore.filter((x) => x !== d)
                        : [...s.defaultRemindDaysBefore, d].sort((a, b) => b - a);
                      updateSettings({ defaultRemindDaysBefore: next.length ? next : [0] });
                    }}
                  >
                    {d === 0 ? '当天' : `${d} 天前`}
                  </button>
                );
              })}
            </div>
          </SettingRow>
        </div>
      </div>

      <div className="card settings-section">
        <div className="card__head">
          <div className="card__title">数据</div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>全部存在你自己的电脑上，不联网</div>
        </div>
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          <Field label="数据位置" hint="想手动备份，直接复制下面这个文件就行；换电脑时把它拷过去即可。">
            <div className="path-box">{dbFile || dataDir}</div>
          </Field>

          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={exportJson}>
              <IconDownload /> 导出全部数据（JSON）
            </button>
            <button className="btn" onClick={exportMarkdown}>
              <IconDownload /> 导出为 Markdown
            </button>
            <button className="btn" onClick={importJson}>
              <IconUpload /> 导入数据
            </button>
            <button className="btn" onClick={() => window.workbench.openPath('backup')}>
              <IconFolder /> 打开备份文件夹
            </button>
          </div>

          <div className="mini-note">
            自动备份：每天第一次保存时会生成一份快照，保留最近 30 份，放在数据目录的 backups 子文件夹里。数据文件万一损坏，程序会自动尝试用最近的备份恢复。
          </div>

          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => window.workbench.createShortcut().then((r) => toast(r.ok ? '桌面快捷方式已创建' : '创建失败'))}>
              在桌面创建快捷方式
            </button>
          </div>
        </div>
      </div>

      <div className="card settings-section">
        <div className="card__head">
          <div className="card__title">使用说明（30 秒看完）</div>
        </div>
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <HelpItem title="加一个纪念日" text="「倒数日」→ 右上角新建 → 填名字、选日期。生日、纪念日把「重复」设成每年（公历）；长辈农历生日就把日期类型切成农历，再选「每年（农历）」，以后每年自动换算。" />
          <HelpItem title="看还有多久" text="未来的日子显示「还有 N 天」，已经过去的显示「已过 N 天」；勾了「精确倒计时」的会精确到秒，适合考试、发布会这种。" />
          <HelpItem title="加待办 / 改日期" text="「日历」里点某一天，右下角输入框敲字回车就加上了。按住待办拖到别的日期格子，就改期了。" />
          <HelpItem title="重复待办" text="加待办时点「更多选项」，「每周 / 工作日 / 每月」都行。每周的跑步勾了这周，不会影响上周的记录。" />
          <HelpItem title="记心情和日记" text="「日历」右侧下面可以点心情 emoji、选标签、写日记，都是自动保存。月历上每天会留一个小点。" />
          <HelpItem title="提醒" text="默认提前 7 天 / 1 天 / 当天通知你。不要的提醒可以在每条倒数日里单独关掉，或者在设置里一刀切。" />
        </div>
      </div>

      <div className="card settings-section danger-zone">
        <div className="card__head">
          <div className="card__title" style={{ color: 'var(--danger)' }}>
            谨慎操作
          </div>
        </div>
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={onLoadDemo}>
              <IconSparkle /> 载入示例数据
            </button>
            <button className="btn btn--danger" onClick={() => setClearOpen(true)}>
              清空待办和日记
            </button>
            <button className="btn btn--danger" onClick={() => setResetOpen(true)}>
              恢复出厂（清空一切）
            </button>
          </div>
          <div className="mini-note">清空之前建议先点上面的「导出全部数据」存一份。这些操作不可撤销。</div>
        </div>
      </div>

      {clearOpen && (
        <ConfirmModal
          title="清空待办和日记？"
          danger
          confirmText="清空"
          message="倒数日会保留，待办、完成记录、日记和心情全部删除。"
          onConfirm={() => {
            replaceDb({ ...db, todos: [], completions: {}, dayLogs: {} });
            toast('已清空待办和日记');
          }}
          onClose={() => setClearOpen(false)}
        />
      )}

      {resetOpen && (
        <ConfirmModal
          title="恢复出厂设置？"
          danger
          confirmText="全部清空"
          message="所有倒数日、待办、日记都会被删除，设置恢复默认。这个操作无法撤销，请确认已经导出过备份。"
          onConfirm={() => {
            replaceDb({ ...emptyDb(dataDir), seeded: true });
            toast('已恢复出厂');
          }}
          onClose={() => setResetOpen(false)}
        />
      )}

      {/* 关于：版本号 + 检查更新 */}
      <div className="card settings-section">
        <div className="card__head">
          <div className="card__title">关于</div>
        </div>
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 650 }}>{APP_NAME}</span>
            <span className="about-version">{versionLabel()}</span>
            {IS_BETA && <span className="about-beta">内测版</span>}
          </div>
          <div className="mini-note">
            作者 {AUTHOR} · 数据全部存在本机，不联网、不需要账号
            <br />
            数据结构版本 v{DATA_VERSION}（升级程序时老数据会自动兼容/迁移）
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {releasesUrl() ? (
              <button
                className="btn btn--sm"
                onClick={async () => {
                  const ok = await window.workbench.openExternal(releasesUrl());
                  if (!ok) toast('打开链接失败，可以手动访问 GitHub 的 Releases 页');
                }}
              >
                <IconDownload size={13} /> 检查更新
              </button>
            ) : (
              <span className="mini-note">（还没填 GitHub 仓库地址，填好后这里会出现「检查更新」）</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function SettingRow({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-row__main">
        <div className="setting-row__title">{title}</div>
        {desc && <div className="setting-row__desc">{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function HelpItem({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      <div className="setting-row__desc" style={{ marginTop: 2 }}>
        {text}
      </div>
    </div>
  );
}
