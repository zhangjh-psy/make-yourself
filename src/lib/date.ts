/**
 * 日期与农历工具
 * 全部以"本地日期"为准，日期字符串统一 YYYY-MM-DD，避免时区偏移带来的隔天问题。
 */
import { Lunar, LunarYear, Solar } from 'lunar-javascript';
import type { Deadline, DeadlineView, DdlItem, Recurrence, Todo } from '../types';

export const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
export const WEEKDAY_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** 数字补零 */
const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Date -> YYYY-MM-DD */
export function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD -> Date（本地零点） */
export function parse(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function todayStr(): string {
  return fmt(new Date());
}

export function addDays(s: string, n: number): string {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

export function addMonths(s: string, n: number): string {
  const d = parse(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return fmt(d);
}

/** a - b 的天数差（正数表示 a 在 b 之后） */
export function diffDays(a: string, b: string): number {
  const ms = parse(a).getTime() - parse(b).getTime();
  return Math.round(ms / 86400000);
}

export function isSameDay(a: string, b: string): boolean {
  return a === b;
}

/** 该日期所在周的周一（weekStartsOn = 0 时返回周日） */
export function startOfWeek(s: string, weekStartsOn: 0 | 1 = 1): string {
  const d = parse(s);
  const wd = d.getDay();
  const delta = weekStartsOn === 1 ? (wd + 6) % 7 : wd;
  return addDays(s, -delta);
}

/** 生成从 start 起连续 n 天的日期数组 */
export function daysFrom(start: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(start, i));
  return out;
}

/**
 * 月历网格：返回覆盖整月的 6*7 = 42 天（含上下月补白），保证行数稳定不跳动
 * @param month 自然月，1-12（与 inMonth / monthLabel 保持一致）
 */
export function monthGrid(year: number, month: number, weekStartsOn: 0 | 1 = 1): string[] {
  const first = `${year}-${pad(month)}-01`;
  const gridStart = startOfWeek(first, weekStartsOn);
  return daysFrom(gridStart, 42);
}

/** 月历网格（周视图：从某天所在周的周一起 7 天） */
export function weekGrid(day: string, weekStartsOn: 0 | 1 = 1): string[] {
  return daysFrom(startOfWeek(day, weekStartsOn), 7);
}

export function inMonth(dateStr: string, year: number, month: number): boolean {
  const d = parse(dateStr);
  return d.getFullYear() === year && d.getMonth() + 1 === month;
}

export function isWeekend(s: string): boolean {
  const wd = parse(s).getDay();
  return wd === 0 || wd === 6;
}

/* ------------------------------------------------------------------ */
/*                              农历                                    */
/* ------------------------------------------------------------------ */

const LUNAR_DAY_CN = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
const LUNAR_MONTH_CN = ['', '正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];

export function lunarDayName(day: number): string {
  return LUNAR_DAY_CN[day] || String(day);
}

export function lunarMonthName(month: number, leap = false): string {
  return `${leap ? '闰' : ''}${LUNAR_MONTH_CN[Math.abs(month)] || month}月`;
}

/** 农历节日（按农历月日判断） */
const LUNAR_FESTIVALS: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵节',
  '5-5': '端午节',
  '7-7': '七夕',
  '7-15': '中元节',
  '8-15': '中秋节',
  '9-9': '重阳节',
  '12-8': '腊八节',
  '12-23': '小年',
  '12-30': '除夕',
};

export interface LunarInfo {
  /** 农历月（1-12） */
  month: number;
  /** 农历日（1-30） */
  day: number;
  /** 是否闰月 */
  leap: boolean;
  /** 农历文本，如 "腊月廿三" */
  text: string;
  /** 节日名称（农历节日或节气），没有则为空 */
  festival: string;
  /** 生肖 */
  zodiac: string;
  /** 干支年 */
  ganzhi: string;
}

/** 公历日期 -> 农历信息 */
export function solarToLunar(dateStr: string): LunarInfo {
  const d = parse(dateStr);
  const solar = Solar.fromYmd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const lunar = solar.getLunar();
  const month = lunar.getMonth();
  const day = lunar.getDay();
  const leap = month < 0;
  const absMonth = Math.abs(month);
  const jieQi = lunar.getJieQi();
  const lunarFestival = LUNAR_FESTIVALS[`${absMonth}-${day}`];
  return {
    month: absMonth,
    day,
    leap,
    text: `${lunarMonthName(absMonth, leap)}${lunarDayName(day)}`,
    festival: lunarFestival || jieQi || '',
    zodiac: lunar.getYearShengXiao(),
    ganzhi: lunar.getYearInGanZhi(),
  };
}

/** 公历节日 */
const SOLAR_FESTIVALS: Record<string, string> = {
  '1-1': '元旦',
  '2-14': '情人节',
  '3-8': '妇女节',
  '3-12': '植树节',
  '4-1': '愚人节',
  '5-1': '劳动节',
  '5-4': '青年节',
  '6-1': '儿童节',
  '7-1': '建党节',
  '8-1': '建军节',
  '9-10': '教师节',
  '10-1': '国庆节',
  '12-25': '圣诞节',
};

/** 取某天的"节日/节气"标签，农历节日优先 */
export function festivalOf(dateStr: string): string {
  const d = parse(dateStr);
  const lunar = solarToLunar(dateStr);
  if (lunar.festival) return lunar.festival;
  return SOLAR_FESTIVALS[`${d.getMonth() + 1}-${d.getDate()}`] || '';
}

/** 农历 -> 公历。闰月时优先取闰月 */
export function lunarToSolar(
  year: number,
  month: number,
  day: number,
  preferLeap = true,
): { date: string; leap: boolean } | null {
  const candidates = preferLeap ? [month * -1, month] : [month, month * -1];
  for (const m of candidates) {
    try {
      const lunar = Lunar.fromYmd(year, m, day);
      const solar = lunar.getSolar();
      const y = solar.getYear();
      const mo = solar.getMonth();
      const d = solar.getDay();
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { date: fmt(new Date(y, mo - 1, d)), leap: m < 0 };
    } catch {
      /* 该农历月不存在（如小月没有三十），继续尝试下一个 */
    }
  }
  return null;
}

/** 某农历年的所有月份（含闰月），值为 1..12，闰月为负数 */
export function lunarMonthsOfYear(year: number): number[] {
  try {
    return LunarYear.fromYear(year)
      .getMonths()
      .map((m: { getMonth(): number }) => m.getMonth());
  } catch {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  }
}

/** 该农历年是否存在闰某月 */
export function lunarYearHasLeapMonth(year: number, month: number): boolean {
  return lunarMonthsOfYear(year).includes(-month);
}

/** 某年某农历月有多少天 */
export function lunarMonthDays(year: number, month: number, leap = false): number {
  try {
    const months = LunarYear.fromYear(year).getMonths();
    const target = months.find((m: { getMonth(): number }) => m.getMonth() === (leap ? -month : month));
    return target ? target.getDayCount() : 30;
  } catch {
    return 30;
  }
}

/* ------------------------------------------------------------------ */
/*                           倒数日 计算                                */
/* ------------------------------------------------------------------ */

export interface DdlComputed {
  /** 距离今天的整数天数差：正数=还有几天，0=就是今天，负数=已过几天 */
  dayDiff: number;
  /** 本次"发生"的日期（重复条目会滚到最近一次） */
  occurrence: string;
  /** 是否已过去（对不重复条目而言） */
  passed: boolean;
  /** 状态文案 */
  label: string;
  /** 大数字 */
  bigNumber: number;
  /** 大数字单位 */
  unit: string;
  /** 精确倒计时用：目标时间的毫秒时间戳 */
  targetMs?: number;
  /** 距离事件起始日的周年数（生日/纪念日样式时用于附注） */
  anniversaryNth?: number;
}

/** 不重复条目：直接用存下来的公历日 */
function plainOccurrence(item: DdlItem): string {
  return item.date;
}

/**
 * 找重复条目"今天或之后最近的一次发生"，找不到就返回过去最近的一次（用于已过天数展示）
 */
export function nextOccurrence(item: DdlItem, today: string): string {
  const rec: Recurrence = item.recurrence;

  if (rec === 'none') return plainOccurrence(item);

  if (rec === 'yearly-lunar' && item.lunar) {
    const { month, day } = item.lunar;
    const todayYear = parse(today).getFullYear();
    for (let y = todayYear; y <= todayYear + 3; y++) {
      const conv = lunarToSolar(y, month, day, true);
      if (conv && diffDays(conv.date, today) >= 0) return conv.date;
    }
    // 未来 3 年都找不到，退回用当年换算
    const fallback = lunarToSolar(todayYear, month, day, true);
    return fallback ? fallback.date : item.date;
  }

  if (rec === 'yearly-solar') {
    const origin = parse(item.date);
    const todayYear = parse(today).getFullYear();
    // 2/29 出生的人：平年落到该月最后一天（2/28）
    for (let y = todayYear; y <= todayYear + 3; y++) {
      const lastDay = new Date(y, origin.getMonth() + 1, 0).getDate();
      const candidate = fmt(new Date(y, origin.getMonth(), Math.min(origin.getDate(), lastDay)));
      if (diffDays(candidate, today) >= 0) return candidate;
    }
  }

  if (rec === 'monthly') {
    const origin = parse(item.date);
    const t = parse(today);
    for (let i = 0; i <= 24; i++) {
      const y = t.getFullYear();
      const m = t.getMonth() + i;
      const lastDay = new Date(y, m + 1, 0).getDate();
      const candidate = fmt(new Date(y, m, Math.min(origin.getDate(), lastDay)));
      if (diffDays(candidate, today) >= 0) return candidate;
    }
  }

  if (rec === 'weekly') {
    const origin = parse(item.date).getDay();
    const t = parse(today);
    const delta = (origin - t.getDay() + 7) % 7;
    return addDays(today, delta);
  }

  return item.date;
}

/** 计算倒数日的展示数据 */
export function computeDdl(item: DdlItem, today = todayStr()): DdlComputed {
  const occurrence = nextOccurrence(item, today);
  const dayDiff = diffDays(occurrence, today);

  // 精确倒计时：目标时刻按当天 00:00 起算
  const targetMs = item.precise ? parse(occurrence).getTime() : undefined;

  // 生日/周年样式：无论还没到还是已经过去，都显示"第 N 周年"，这样口径一致
  if (item.anniversaryStyle) {
    const origin = parse(item.date);
    const at = parse(occurrence);
    let nth = at.getFullYear() - origin.getFullYear();
    if (nth < 1) nth = 1;
    // 已经过了今年的生日，则"已过"的是下一周年之前的那一年
    if (dayDiff < 0) nth = Math.max(1, nth - 1);
    return {
      dayDiff,
      occurrence,
      passed: dayDiff < 0,
      label: dayDiff === 0 ? '就是今天' : dayDiff > 0 ? '还有' : '已过',
      bigNumber: dayDiff === 0 ? 0 : Math.abs(dayDiff),
      unit: '天',
      targetMs,
      anniversaryNth: nth,
    };
  }

  if (dayDiff > 0) {
    return { dayDiff, occurrence, passed: false, label: '还有', bigNumber: dayDiff, unit: '天', targetMs };
  }
  if (dayDiff === 0) {
    return { dayDiff, occurrence, passed: false, label: '就是今天', bigNumber: 0, unit: '天', targetMs };
  }
  return { dayDiff, occurrence, passed: true, label: '已过', bigNumber: -dayDiff, unit: '天', targetMs };
}

/** 剩余时间的时分秒，用于精确倒计时 */
export function preciseRemain(targetMs: number): { d: number; h: number; m: number; s: number; negative: boolean } {
  let ms = targetMs - Date.now();
  const negative = ms < 0;
  ms = Math.abs(ms);
  const totalSec = Math.floor(ms / 1000);
  return {
    d: Math.floor(totalSec / 86400),
    h: Math.floor((totalSec % 86400) / 3600),
    m: Math.floor((totalSec % 3600) / 60),
    s: totalSec % 60,
    negative,
  };
}

/* ------------------------------------------------------------------ */
/*                             待办 计算                                */
/* ------------------------------------------------------------------ */

/** 重复待办是否出现在某一天 */
export function todoOccursOn(todo: Todo, day: string): boolean {
  if (todo.repeat === 'none') return todo.date === day;
  if (diffDays(day, todo.baseDate) < 0) return false;

  switch (todo.repeat) {
    case 'daily':
      return true;
    case 'weekdays': {
      const wd = parse(day).getDay();
      return wd >= 1 && wd <= 5;
    }
    case 'weekly': {
      return parse(day).getDay() === parse(todo.baseDate).getDay();
    }
    case 'monthly': {
      const base = parse(todo.baseDate);
      const d = parse(day);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return d.getDate() === Math.min(base.getDate(), lastDay);
    }
    default:
      return false;
  }
}

/** 重复待办的完成状态存在 completions 里，键为 `${todoId}|${date}` */
export function completionKey(todoId: string, date: string): string {
  return `${todoId}|${date}`;
}

export function todoDoneOn(
  todo: Todo,
  day: string,
  completions: Record<string, { doneAt: number }>,
  today = todayStr(),
): boolean {
  if (todo.repeat === 'none') {
    // 不重复：完成状态只跟这一天有关
    return !!completions[completionKey(todo.id, day)] || (todo.done && todo.date === day && day === today);
  }
  return !!completions[completionKey(todo.id, day)];
}

/** 星期中文 + 日期，如 "3月5日 星期三" */
export function prettyDate(dateStr: string): string {
  const d = parse(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_FULL[d.getDay()]}`;
}

export function monthLabel(year: number, month: number): string {
  return `${year}年${month}月`;
}

/* ------------------------------------------------------------------ */
/*                            截止日 计算                               */
/* ------------------------------------------------------------------ */

/** 还有几天算"快到了" */
export const DEADLINE_SOON_DAYS = 7;

/** 计算截止日的展示状态 */
export function computeDeadline(d: Deadline, todos: Todo[], today = todayStr()): DeadlineView {
  const daysLeft = diffDays(d.dueDate, today);
  const overdue = !d.done && daysLeft < 0;
  const dueToday = !d.done && daysLeft === 0;

  let statusText: string;
  if (d.done) statusText = '已完成';
  else if (daysLeft < 0) statusText = `已过期 ${-daysLeft} 天`;
  else if (daysLeft === 0) statusText = '今天到期';
  else if (daysLeft === 1) statusText = '明天到期';
  else statusText = `还有 ${daysLeft} 天`;

  const urgency: DeadlineView['urgency'] = d.done
    ? 'done'
    : overdue
      ? 'overdue'
      : dueToday
        ? 'today'
        : daysLeft <= DEADLINE_SOON_DAYS
          ? 'soon'
          : 'normal';

  return {
    d,
    daysLeft,
    overdue,
    dueToday,
    statusText,
    urgency,
    todos: todos.filter((t) => t.deadlineId === d.id),
  };
}

/** 截止日是否应该出现在某一天的日历上（截止当天；已过期未完成则一直挂着催办） */
export function deadlineShowsOn(d: Deadline, day: string, today = todayStr()): boolean {
  if (d.dueDate === day) return true;
  if (!d.done && diffDays(d.dueDate, today) < 0 && diffDays(day, today) <= 0) return true;
  return false;
}

/** 排序：未完成在前 → 越紧急越靠前 → 优先级高的靠前 */
export function sortDeadlines(views: DeadlineView[]): DeadlineView[] {
  const weight = (v: DeadlineView) => (v.urgency === 'overdue' ? 0 : v.urgency === 'today' ? 1 : 2);
  return [...views].sort((a, b) => {
    if (a.d.done !== b.d.done) return a.d.done ? 1 : -1;
    const wa = weight(a);
    const wb = weight(b);
    if (wa !== wb) return wa - wb;
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    if (a.d.priority !== b.d.priority) return b.d.priority - a.d.priority;
    return a.d.dueDate < b.d.dueDate ? -1 : 1;
  });
}

/** 计算年龄（周岁），用于生日条目 */
export function ageOf(birthDate: string, at = todayStr()): number {
  const b = parse(birthDate);
  const t = parse(at);
  let age = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) age--;
  return age;
}

export { pad };
