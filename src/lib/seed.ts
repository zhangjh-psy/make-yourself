/**
 * 数据文件的"出生地"：默认值、示例数据、以及老数据的兼容处理。
 *
 * 三件事：
 *   uid()          生成不重复的 id（时间戳 + 序号 + 随机后缀，肉眼可读）
 *   emptyDb()      全新安装时的空数据（所有字段的默认值都集中在这里）
 *   normalizeDb()  **读盘时必过**：把旧版本没有的字段补齐、把脏数据挡掉
 *
 * 为什么 normalizeDb 很重要：这个文件是要长期使用的，以后加字段是常态。
 * 只要读的时候统一补默认值，老数据文件就不会因为缺字段而崩。
 */
import type { DayLog, Db, Deadline, DdlItem, FocusState, HomeDisplay, Settings, Todo } from '../types';
import { DEFAULT_HOME, DEFAULT_SETTINGS, emptyFocus } from '../types';
import { addDays, lunarToSolar, parse, solarToLunar, todayStr } from '../lib/date';

let idSeq = 0;
export function uid(prefix = 'i'): string {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyDb(dataDir = ''): Db {
  return {
    version: DATA_VERSION,
    settings: { ...DEFAULT_SETTINGS, dataDir },
    ddl: [],
    todos: [],
    deadlines: [],
    completions: {},
    dayLogs: {},
    focus: emptyFocus(),
    home: { ...DEFAULT_HOME, background: { ...DEFAULT_HOME.background } },
    seeded: false,
  };
}

function ddl(partial: Partial<DdlItem> & { title: string; date: string }): DdlItem {
  const now = Date.now();
  return {
    id: uid('d'),
    calendar: 'solar',
    recurrence: 'none',
    color: '#4F6BED',
    emoji: '⭐️',
    pinned: false,
    precise: false,
    remindDaysBefore: [7, 1, 0],
    remindEnabled: true,
    category: '其他',
    anniversaryStyle: false,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

function todo(partial: Partial<Todo> & { title: string; date: string }): Todo {
  const now = Date.now();
  return {
    id: uid('t'),
    repeat: 'none',
    baseDate: partial.date,
    done: false,
    priority: 0,
    order: 0,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

function deadline(partial: Partial<Deadline> & { title: string; dueDate: string }): Deadline {
  const now = Date.now();
  return {
    id: uid('dl'),
    dueTime: undefined,
    note: '',
    priority: 1,
    progress: 0,
    done: false,
    color: '#E0574F',
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/** 生成初次使用的示例数据（每种形态各一条，方便你看到效果后删掉） */
export function buildSeed(): Db {
  const db = emptyDb();
  const today = todayStr();

  // 农历示例：一位长辈的农历生日（十月初八）
  const lunarBirthday = lunarToSolar(parse(today).getFullYear(), 10, 8, true);
  // 农历示例：春节（正月初一），明年
  const springFestival =
    lunarToSolar(parse(today).getFullYear() + 1, 1, 1, true) ||
    lunarToSolar(parse(today).getFullYear(), 1, 1, true);

  db.ddl = [
    ddl({
      title: '考研初试',
      date: addDays(today, 128),
      recurrence: 'none',
      precise: true,
      pinned: true,
      emoji: '📚',
      color: '#4F6BED',
      category: '考试',
      note: '示例：勾选"精确倒计时"后，会显示到小时/分钟/秒',
    }),
    ddl({
      title: '我的生日',
      date: addDays(today, 23),
      recurrence: 'yearly-solar',
      anniversaryStyle: true,
      emoji: '🎂',
      color: '#C7499B',
      category: '生日',
      note: '示例：每年重复（公历），过去后会显示"第 N 周年"',
    }),
    lunarBirthday
      ? ddl({
          title: '奶奶生日（农历十月初八）',
          date: lunarBirthday.date,
          calendar: 'lunar',
          lunar: { month: 10, day: 8, leap: lunarBirthday.leap },
          recurrence: 'yearly-lunar',
          anniversaryStyle: true,
          emoji: '🧧',
          color: '#E0574F',
          category: '生日',
          note: '示例：农历每年重复，自动换算成每年的公历日期',
        })
      : ddl({ title: '奶奶生日（农历）', date: addDays(today, 60) }),
    springFestival
      ? ddl({
          title: '春节',
          date: springFestival.date,
          calendar: 'lunar',
          lunar: { month: 1, day: 1, leap: false },
          recurrence: 'yearly-lunar',
          emoji: '🎉',
          color: '#E8873B',
          category: '节日',
        })
      : ddl({ title: '春节', date: addDays(today, 300) }),
    ddl({
      title: '项目答辩',
      date: addDays(today, -9),
      recurrence: 'none',
      emoji: '🎓',
      color: '#3FA46A',
      category: '学习',
      note: '示例：已经过去的日子，会显示"已过 N 天"',
    }),
    ddl({
      title: '每周组会',
      date: addDays(today, 3),
      recurrence: 'weekly',
      emoji: '💼',
      color: '#2FA3A3',
      category: '工作',
      remindDaysBefore: [0],
    }),
  ];

  db.todos = [
    todo({ title: '把工作台装到桌面，双击试试', date: today, priority: 1, order: 0, color: '#4F6BED' }),
    todo({ title: '看一遍使用说明（设置页里有）', date: today, order: 1 }),
    todo({ title: '每天喝八杯水', date: today, repeat: 'daily', order: 2 }),
    todo({ title: '周报提交', date: addDays(today, 2), dueTime: '18:00', priority: 1, order: 0, color: '#E0574F' }),
    todo({ title: '给家里打个电话', date: addDays(today, 5), repeat: 'weekly', order: 0 }),
    todo({ title: '整理上个月的实验数据', date: addDays(today, -2), order: 0, color: '#E8873B', note: '示例：过期任务会高亮' }),
    todo({ title: '读完《…》第三章', date: addDays(today, 1), order: 0 }),
  ];

  // 截止日示例：一条紧急的、一条正常的
  const dl1 = deadline({
    title: '课题方案提交',
    dueDate: addDays(today, 5),
    dueTime: '18:00',
    priority: 2,
    progress: 60,
    color: '#E0574F',
    tags: ['论文', '项目'],
    note: '示例：进度条可以点 +25% 快速推进；勾选"完成"会同步它名下的待办。',
  });
  const dl2 = deadline({
    title: '奖学金材料提交',
    dueDate: addDays(today, 21),
    priority: 1,
    progress: 10,
    color: '#E8873B',
    tags: ['报名'],
  });
  db.deadlines = [dl1, dl2];

  // 每条截止日自动在截止当天挂一条待办（和真实使用时的行为一致）
  db.todos.push(
    todo({
      title: dl1.title,
      date: dl1.dueDate,
      dueTime: dl1.dueTime,
      priority: 1,
      order: 0,
      color: dl1.color,
      deadlineId: dl1.id,
    }),
    todo({
      title: dl2.title,
      date: dl2.dueDate,
      priority: 1,
      order: 0,
      color: dl2.color,
      deadlineId: dl2.id,
    }),
  );

  const lunar = solarToLunar(today);
  db.dayLogs[today] = {
    date: today,
    mood: '🙂',
    tags: ['平静'],
    diary:
      `今天是工作台上线的第一天。\n\n` +
      `今天的农历是 ${lunar.text}（${lunar.ganzhi}${lunar.zodiac}年）。\n\n` +
      `这里是日记区，随便写点什么都会自动保存。左边月历上的小圆点会记住每天的心情。`,
    color: '#4F6BED',
    updatedAt: Date.now(),
  };

  db.seeded = true;
  return db;
}

/* ------------------------------------------------------------------ */
/*                        数据版本与迁移                                */
/* ------------------------------------------------------------------ */

/**
 * 当前数据结构的版本号。**改动数据结构时就要 +1**，并在下面 MIGRATIONS 里加一条。
 *
 * 为什么需要它：程序要升级，用户的数据文件不会跟着变。
 * 如果只靠"缺字段就补默认值"（normalizeDb 里做的），能解决 90% 的情况
 * （加字段、加开关），但解决不了这几种：
 *   - 改了某个字段的含义或类型（比如日期从字符串改成时间戳）
 *   - 把一份数据拆成两份，或者把两个字段合并
 *   - 要把老数据的某个值换算成新的表示
 * 这些必须"读出来 → 转换 → 再交给程序用"，也就是迁移。
 */
export const DATA_VERSION = 1;

/**
 * 迁移表：从版本 N 升到 N+1 该做什么。
 *
 * 写法约定（照抄即可）：
 *   2: (db) => { ...把 version 1 的数据改成 version 2 的样子...; return db; }
 *
 * 要点：
 *   - 一个键 = 一步，会从用户当前版本**逐步**升到最新（1→2→3…）
 *   - **不要在这里做"补默认值"**，那是 normalizeDb 的事，这里只管结构变化
 *   - 改完记得把 DATA_VERSION 也 +1
 *   - 迁移应该有防御性：老数据可能因为手动编辑而不完整，别假设字段一定存在
 */
const MIGRATIONS: Record<number, (db: Partial<Db>) => Partial<Db>> = {
  // 还没有任何迁移。将来举例：
  // 2: (db) => ({ ...db, todos: (db.todos ?? []).map((t) => ({ ...t, tags: [] })) }),
};

/** 把数据从旧版本逐步升到当前版本；顺带返回有没有真的迁移过 */
function migrate(raw: Partial<Db>): { db: Partial<Db>; migratedFrom?: number } {
  let current = raw;
  const from = typeof current.version === 'number' ? current.version : 0;
  if (from >= DATA_VERSION) return { db: current };
  let v = from;
  while (v < DATA_VERSION) {
    const step = MIGRATIONS[v + 1];
    if (step) {
      try {
        current = step(current);
      } catch (err) {
        console.error(`[make-yourself] 数据迁移 v${v} → v${v + 1} 失败`, err);
        break;
      }
    }
    v += 1;
  }
  return { db: current, migratedFrom: from };
}

/** 兼容旧版本数据：先迁移结构，再补齐缺失字段 */
export function normalizeDb(raw: Partial<Db> | null | undefined, dataDir = ''): Db {
  const base = emptyDb(dataDir);
  if (!raw || typeof raw !== 'object') return base;
  const { db: migrated, migratedFrom } = migrate(raw);
  if (migratedFrom !== undefined && migratedFrom < DATA_VERSION) {
    console.info(`[make-yourself] 数据已从 v${migratedFrom} 迁移到 v${DATA_VERSION}`);
  }
  const rawData = migrated;
  const settings: Settings = { ...base.settings, ...(rawData.settings || {}), dataDir };
  const ddlList: DdlItem[] = Array.isArray(rawData.ddl)
    ? rawData.ddl.map((item) => ({ ...ddl({ title: '', date: todayStr() }), ...item }))
    : [];
  const todos: Todo[] = Array.isArray(rawData.todos)
    ? rawData.todos.map((item) => ({
        ...todo({ title: '', date: todayStr() }),
        ...item,
        baseDate: item.baseDate || item.date,
        date: item.date,
      }))
    : [];
  const dayLogs: Record<string, DayLog> = {};
  if (rawData.dayLogs && typeof rawData.dayLogs === 'object') {
    for (const [k, v] of Object.entries(rawData.dayLogs)) {
      if (v && typeof v === 'object') dayLogs[k] = { ...(v as DayLog), date: k };
    }
  }
  const deadlines: Deadline[] = Array.isArray(rawData.deadlines)
    ? rawData.deadlines.map((item) => ({
        ...deadline({ title: '', dueDate: todayStr() }),
        ...item,
        tags: Array.isArray(item.tags) ? item.tags : [],
      }))
    : [];
  const focus: FocusState = {
    active: rawData.focus?.active,
    totals: rawData.focus?.totals && typeof rawData.focus.totals === 'object' ? rawData.focus.totals : {},
    sessions: Array.isArray(rawData.focus?.sessions) ? rawData.focus.sessions : [],
  };
  const home: HomeDisplay = {
    ...DEFAULT_HOME,
    ...(rawData.home ?? {}),
    background: { ...DEFAULT_HOME.background, ...(rawData.home?.background ?? {}) },
  };
  return {
    // 统一写成当前版本号：下次读盘就知道数据已经是新版的了
    version: DATA_VERSION,
    settings,
    ddl: ddlList,
    todos,
    deadlines,
    completions: rawData.completions && typeof rawData.completions === 'object' ? rawData.completions : {},
    dayLogs,
    focus,
    home,
    ui: rawData.ui && typeof rawData.ui === 'object' ? rawData.ui : {},
    seeded: !!rawData.seeded,
  };
}
