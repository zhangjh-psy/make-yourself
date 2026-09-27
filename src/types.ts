/**
 * 全局数据模型定义
 * 所有数据最终保存为电脑上的一个 JSON 文件（见 electron/store.ts）
 */

/** 日历类型 */
export type CalendarMode = 'solar' | 'lunar';

/**
 * 重复规则。务必区分清楚，避免"农历生日"和"公历生日"搞混：
 * - none  不重复：就是某一天，过完就过去了
 * - yearly-solar 每年重复（按公历，如元旦、考试纪念日）
 * - yearly-lunar 每年重复（按农历，如长辈生日、春节）
 * - monthly 每月重复
 * - weekly 每周重复
 */
export type Recurrence = 'none' | 'yearly-solar' | 'yearly-lunar' | 'monthly' | 'weekly';

/** 倒数日条目 */
export interface DdlItem {
  id: string;
  title: string;
  /** 基准日期，格式 YYYY-MM-DD。农历条目这里存"当年对应的公历日"（或用户填的农历年对应公历日） */
  date: string;
  calendar: CalendarMode;
  /** 当 calendar = lunar 时，记录农历的月 / 日 / 是否闰月，用于每年重算 */
  lunar?: { month: number; day: number; leap: boolean };
  recurrence: Recurrence;
  /** 备注 */
  note?: string;
  /** 卡片颜色（十六进制） */
  color: string;
  /** 卡片 emoji 或图标字符 */
  emoji: string;
  /** 置顶 */
  pinned: boolean;
  /** 显示到小时/分钟/秒的精确倒计时 */
  precise: boolean;
  /** 提醒：提前几天（0 = 当天）。空数组表示关闭提醒 */
  remindDaysBefore: number[];
  /** 提醒总开关（单条） */
  remindEnabled: boolean;
  /** 分类标签 */
  category: string;
  /** 已过天数是否显示为"第 N 年/岁"（生日类） */
  anniversaryStyle: boolean;
/** 手动排序用的序号（选「手动排序」时按它排，拖动卡片会改它） */
  order?: number;
  /** 版面视图里的位置尺寸：全用百分比（0-100，相对画布），所以窗口缩放不会乱 */
  layout?: { x: number; y: number; w: number; h: number };
  /** 卡片外观（形状、背景、文字）。不设就用默认样式 */
  skin?: CardSkin;
  createdAt: number;
  updatedAt: number;
  /** 已读过的提醒，避免重复弹窗。存储形如 "2026-03-01|7" */
  firedReminders?: string[];
}

export type TodoRepeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

/** 待办 */
export interface Todo {
  id: string;
  title: string;
  /** 归属日期 YYYY-MM-DD */
  date: string;
  note?: string;
  /** 是否有具体截止时间，格式 HH:mm（为空表示整天任务） */
  dueTime?: string;
  repeat: TodoRepeat;
  /** 重复的锚点日期（首次创建日）。改期时不破坏历史完成记录 */
  baseDate: string;
  done: boolean;
  /** 完成时间戳 */
  doneAt?: number;
  /** 优先级 0 普通 1 重要 */
  priority: 0 | 1;
  /** 颜色标记 */
  color?: string;
  /** 排序用 */
  order: number;
  /** 归属的截止日（由截止日模块自动同步，不让用户手填） */
  deadlineId?: string;
  createdAt: number;
  updatedAt: number;
}

/** 截止日：项目、报告、报名这类"必须在某天前交掉"的事 */
export interface Deadline {
  id: string;
  title: string;
  /** 截止日期 YYYY-MM-DD */
  dueDate: string;
  /** 截止时刻 HH:mm，可选 */
  dueTime?: string;
  note?: string;
  /** 0 普通 1 重要 2 紧急 */
  priority: 0 | 1 | 2;
  /** 完成进度 0-100 */
  progress: number;
  done: boolean;
  doneAt?: number;
  color: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/** 截止日的推导状态（不存库，每次算） */
export interface DeadlineView {
  d: Deadline;
  /** 距离截止还剩几天：正数=还有，0=今天到期，负数=已过期 */
  daysLeft: number;
  overdue: boolean;
  dueToday: boolean;
  /** 状态文案，如"还有 5 天""今天到期""已过期 3 天" */
  statusText: string;
  /** 紧张程度，决定颜色 */
  urgency: 'done' | 'overdue' | 'today' | 'soon' | 'normal';
  /** 归属这条截止日的待办 */
  todos: Todo[];
}

export const DEADLINE_TAGS = ['项目', '论文', '考试', '报名', '作业', '工作', '生活', '其他'];

export const PRIORITY_LABEL: Record<0 | 1 | 2, string> = { 0: '普通', 1: '重要', 2: '紧急' };

/* ------------------------------------------------------------------ */
/*                        首页 / 慎独页的外观                           */
/* ------------------------------------------------------------------ */

export interface HomeDisplay {
  /** 正中间那句话（可多行） */
  quote: string;
  quoteSize: number;
  quoteColor: string;
  quoteWeight: 300 | 400 | 500 | 700;
  /** 文字的垂直位置 %，50 = 正中 */
  quotePos: number;
  quoteAlign: 'center' | 'left';
  /** 文字阴影，背景图花的时候用 */
  quoteShadow: boolean;
  background: CardBackground;
}

export const DEFAULT_HOME: HomeDisplay = {
  quote: '愿你今天，心无旁骛。',
  quoteSize: 40,
  quoteColor: '',
  quoteWeight: 300,
  quotePos: 46,
  quoteAlign: 'center',
  quoteShadow: true,
  background: {
    type: 'none',
    color: '#F4F4F3',
    color2: '#E6E9F5',
    angle: 135,
    opacity: 100,
    imageFit: 'cover',
    imageMask: 30,
  },
};

/* ------------------------------------------------------------------ */
/*                        倒数日卡片的外观                              */
/* ------------------------------------------------------------------ */

/** 形状的预设底样 */
export type ShapePreset =
  | 'rect'
  | 'chamfer'
  | 'circle'
  | 'ellipse'
  | 'capsule'
  | 'hexagon'
  | 'diamond'
  | 'trapezoid'
  | 'star'
  | 'bubble';

/** 控制点：百分比坐标，0-100，相对卡片自己的框 */
export interface ShapePoint {
  x: number;
  y: number;
}

/** 背景设置 */
export interface CardBackground {
  type: 'none' | 'solid' | 'gradient' | 'image';
  color: string;
  color2: string;
  /** 渐变角度，0-360 */
  angle: number;
  /** 背景透明度 0-100 */
  opacity: number;
  /** 图片（dataURL，已压缩），只在 type=image 时用 */
  image?: string;
  /** 图片填充方式 */
  imageFit: 'cover' | 'contain';
  /** 暗色蒙版强度 0-100，用来压暗图片让文字看得清 */
  imageMask: number;
}

export interface CardSkin {
  shape: ShapePreset;
  /** 自定义控制点。不设 = 用 shape 的预设点位 */
  points?: ShapePoint[];
  /** 圆角（只在预设底样上生效）0-50 */
  radius: number;
  /** 描边宽度 0-8 */
  borderWidth: number;
  borderColor: string;
  /** 投影 0-100 */
  shadow: number;
  background: CardBackground;
  /** 整卡透明度 0-100 */
  cardOpacity: number;
  textColors: { title: string; number: string; small: string };
  /** 文字整体缩放 % */
  scale: number;
  /** 大数字额外缩放 % */
  numberScale: number;
  /** 内容内边距 %（自由形状时用来把文字收进形状里） */
  padding: number;
  /** 卡片上显示哪几项 */
  show: {
    emoji: boolean;
    title: boolean;
    label: boolean;
    number: boolean;
    anniversary: boolean;
    precise: boolean;
    date: boolean;
    weekday: boolean;
    lunar: boolean;
    repeat: boolean;
  };
}

export const DEFAULT_SKIN: CardSkin = {
  shape: 'rect',
  radius: 16,
  borderWidth: 1,
  borderColor: '#00000022',
  shadow: 30,
  background: {
    type: 'solid',
    color: '#FFFFFF',
    color2: '#EEF1FF',
    angle: 135,
    opacity: 100,
    imageFit: 'cover',
    imageMask: 0,
  },
  cardOpacity: 100,
  textColors: { title: '', number: '', small: '' },
  scale: 100,
  numberScale: 100,
  padding: 10,
  show: {
    emoji: true,
    title: true,
    label: true,
    number: true,
    anniversary: true,
    precise: true,
    date: true,
    weekday: true,
    lunar: true,
    repeat: true,
  },
};

export const SHAPE_LABEL: Record<ShapePreset, string> = {
  rect: '圆角矩形',
  chamfer: '切角矩形',
  circle: '圆形',
  ellipse: '椭圆',
  capsule: '胶囊',
  hexagon: '六边形',
  diamond: '菱形',
  trapezoid: '梯形',
  star: '星形',
  bubble: '气泡对话框',
};

export const SHAPE_LIST = Object.keys(SHAPE_LABEL) as ShapePreset[];

/** 重复待办在某一天的完成记录（key = `${todoId}|${date}`） */
export interface CompletionRecord {
  doneAt: number;
}

/** 每日记录：心情 + 标签 + 日记 */
export interface DayLog {
  /** YYYY-MM-DD */
  date: string;
  /** 心情 emoji，空表示没标 */
  mood?: string;
  /** 心情标签 */
  tags?: string[];
  /** 日记正文 */
  diary?: string;
  /** 每天一个高亮色，用于月历小色点 */
  color?: string;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/*                          慎独（专注计时）                            */
/* ------------------------------------------------------------------ */

/** 一段慎独（停留在首页/慎独页的那段时间） */
export interface FocusSession {
  /** 按开始时间所在的那一天归属（跨零点会切成两段） */
  date: string;
  /** 开始时间戳 */
  start: number;
  /** 结束时间戳，进行中为 undefined */
  end?: number;
  /** 跨零点被切出来的一半，标记一下 */
  split?: boolean;
}

/** 慎独的运行时状态 */
export interface FocusState {
  /** 正在计时的那一段，没有就表示已暂停 */
  active?: { date: string; start: number };
  /** 每天累计的秒数（这样反复进出也不会丢） */
  totals: Record<string, number>;
  sessions: FocusSession[];
}

export function emptyFocus(): FocusState {
  return { totals: {}, sessions: [] };
}

/** 软件设置 */
export interface Settings {
  accent: string;
  theme: 'light' | 'dark';
  /** 开机自动启动 */
  autoLaunch: boolean;
  /** 关闭窗口时最小化到托盘而不是退出 */
  minimizeToTray: boolean;
  /** 倒数日提醒总开关 */
  remindersEnabled: boolean;
  /** 默认提前提醒天数 */
  defaultRemindDaysBefore: number[];
  /** 每日早间汇总提醒 */
  morningDigest: boolean;
  /** 早间汇总时间 HH:mm */
  morningDigestTime: string;
  /** 桌面悬浮窗 */
  floatingWindow: boolean;
  /** 悬浮窗显示内容 */
  floatingShow: 'pinned' | 'nearest' | 'today';
  /** 开机补发错过的提醒 */
  catchUpMissed: boolean;
  /** 星期起始日：0 = 周日，1 = 周一 */
  weekStartsOn: 0 | 1;
  /** 数据目录（只读展示） */
  dataDir?: string;
}

/** 根数据结构 */
export interface Db {
  version: number;
  settings: Settings;
  ddl: DdlItem[];
  todos: Todo[];
  /** 截止日 */
  deadlines: Deadline[];
  /** 重复待办的完成记录 */
  completions: Record<string, CompletionRecord>;
  dayLogs: Record<string, DayLog>;
  /** 慎独计时 */
  focus: FocusState;
  /** 首页 / 慎独页的外观 */
  home: HomeDisplay;
  /** 界面状态（记着"今天是不是已经进来过"，用于按钮文案） */
  ui?: { lastOpen?: string; started?: boolean };
  /** 是否已写过示例数据 */
  seeded?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  accent: '#4F6BED',
  theme: 'light',
  autoLaunch: true,
  minimizeToTray: true,
  remindersEnabled: true,
  defaultRemindDaysBefore: [7, 1, 0],
  morningDigest: false,
  morningDigestTime: '08:30',
  floatingWindow: false,
  floatingShow: 'pinned',
  catchUpMissed: true,
  weekStartsOn: 1,
};

export const DDL_COLORS = [
  '#4F6BED',
  '#E0574F',
  '#E8873B',
  '#3FA46A',
  '#2FA3A3',
  '#7A5AE0',
  '#C7499B',
  '#7A8899',
  '#4A4F57',
];

export const DDL_EMOJIS = [
  '🎂', '🎓', '📝', '💼', '🎉', '💗', '✈️', '🏃', '🍰', '⏰',
  '📚', '🎯', '🌸', '☀️', '🌙', '⭐️', '🏆', '🧧', '🎁', '🩺',
];

export const CATEGORIES = ['纪念日', '生日', '考试', '节日', '学习', '工作', '其他'];

export const TODO_COLORS = ['#4F6BED', '#E0574F', '#E8873B', '#3FA46A', '#7A5AE0'];
