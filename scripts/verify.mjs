/**
 * 农历与倒数日算法自检脚本
 * 运行： node scripts/verify.mjs   （需先 npm run build:renderer，用 dist 里的源码不现实，
 * 所以这里用一个 esbuild 打出来的临时 bundle）
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outfile = path.join(root, '.cache', 'date-probe.cjs');

await build({
  entryPoints: [path.join(root, 'src', 'lib', 'date.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  logLevel: 'warning',
});

const D = await import(`file://${outfile.replace(/\\/g, '/')}`);

let pass = 0;
let fail = 0;
function eq(actual, expected, label) {
  const ok = String(actual) === String(expected);
  if (ok) pass++;
  else {
    fail++;
    console.log(`  ✗ ${label}: 期望 ${expected}，实际 ${actual}`);
  }
}

/* ---------- 1. 已知农历日期换算 ---------- */
// 2026-09-20 的农历
const l1 = D.solarToLunar('2026-09-20');
console.log(`2026-09-20 -> 农历 ${l1.text}  节日=${l1.festival || '无'}  ${l1.ganzhi}${l1.zodiac}年`);
eq(l1.text.length > 2, true, '农历文本非空');

// 2025 年春节 = 2025-01-29（农历正月初一）
const cny2025 = D.lunarToSolar(2025, 1, 1, true);
eq(cny2025.date, '2025-01-29', '2025 春节');

// 2026 年春节 = 2026-02-17
const cny2026 = D.lunarToSolar(2026, 1, 1, true);
eq(cny2026.date, '2026-02-17', '2026 春节');

// 2024 年中秋 = 2024-09-17（农历八月十五）
eq(D.lunarToSolar(2024, 8, 15, true).date, '2024-09-17', '2024 中秋');

// 2023 年闰二月：农历 2023 闰二月十五 -> 2023-04-05
const leapMonth = D.lunarMonthsOfYear(2023);
eq(leapMonth.includes(-2), true, '2023 有闰二月');
const leapDate = D.lunarToSolar(2023, 2, 15, true);
console.log(`2023 闰二月十五 -> ${leapDate.date} (leap=${leapDate.leap})`);
eq(leapDate.leap, true, '闰二月优先取闰月');

/* ---------- 2. 节日 ---------- */
eq(D.festivalOf('2026-02-17'), '春节', '春节识别');
eq(D.festivalOf('2026-10-01'), '国庆节', '国庆节识别');
eq(D.festivalOf('2026-01-01'), '元旦', '元旦识别');

/* ---------- 3. 每年重复的滚动 ---------- */
function mk(over) {
  return {
    id: 'x',
    title: 't',
    date: '2000-03-08',
    calendar: 'solar',
    recurrence: 'yearly-solar',
    color: '#000',
    emoji: '⭐',
    pinned: false,
    precise: false,
    remindDaysBefore: [0],
    remindEnabled: true,
    category: '其他',
    anniversaryStyle: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

// 公历周年：3/8，今天假设 2026-09-20 -> 下一次 2027-03-08
const a = D.computeDdl(mk({}), '2026-09-20');
eq(a.occurrence, '2027-03-08', '公历周年滚到明年');
eq(a.dayDiff > 0, true, '公历周年应为未来');

// 2/29 生日：平年落到 2/28（该月最后一天）
const b = D.computeDdl(mk({ date: '2000-02-29' }), '2026-01-10');
console.log(`2/29 生日下一次 -> ${b.occurrence}`);
eq(b.occurrence, '2026-02-28', '2/29 在平年落到 2/28');

// 农历生日（十月初八）：2026-09-20 之后的下一次
const c = D.computeDdl(
  mk({ calendar: 'lunar', lunar: { month: 10, day: 8, leap: false }, recurrence: 'yearly-lunar', date: '2020-11-22' }),
  '2026-09-20',
);
console.log(`农历十月初八 下一次 -> ${c.occurrence}（农历 ${D.solarToLunar(c.occurrence).text}）`);
eq(D.solarToLunar(c.occurrence).month, 10, '农历生日月正确');
eq(D.solarToLunar(c.occurrence).day, 8, '农历生日日正确');
eq(c.dayDiff >= 0, true, '农历生日应在未来');

// 已经过去的 3/8（今天 2026-09-20，取过去的一次用于展示"已过天数"）
const d = D.computeDdl(mk({ recurrence: 'none', date: '2026-03-08' }), '2026-09-20');
eq(d.dayDiff, -196, '已过天数');
eq(d.label, '已过', '已过标签');

// 每周重复
const e = D.computeDdl(mk({ recurrence: 'weekly', date: '2026-09-16' }), '2026-09-20');
console.log(`每周三重复（2026-09-16 是周三）下一次 -> ${e.occurrence}`);
eq(D.parse(e.occurrence).getDay(), 3, '每周重复落在周三');

/* ---------- 4. 待办重复 ---------- */
const todo = {
  id: 't1',
  title: 'x',
  date: '2026-09-01',
  baseDate: '2026-09-01',
  repeat: 'weekdays',
  done: false,
  priority: 0,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
};
eq(D.todoOccursOn(todo, '2026-09-18'), true, '工作日重复：周五出现');
eq(D.todoOccursOn(todo, '2026-09-19'), false, '工作日重复：周六不出现');
eq(D.todoOccursOn(todo, '2026-08-31'), false, '重复待办不早于起始日');

/* ---------- 5. 日期工具 ---------- */
eq(D.addDays('2026-02-28', 1), '2026-03-01', '跨月加一天');
eq(D.addDays('2026-12-31', 1), '2027-01-01', '跨年加一天');
eq(D.diffDays('2026-09-20', '2026-09-01'), 19, '天数差');
eq(D.addMonths('2026-01-31', 1), '2026-02-28', '月末对齐');
eq(D.monthGrid(2026, 9, 1).length, 42, '月历 42 格');
eq(D.monthGrid(2026, 9, 1)[0], '2026-08-31', '月历从周一开始（9 月）');
eq(D.monthGrid(2026, 9, 0)[0], '2026-08-30', '月历从周日开始（9 月）');
eq(D.inMonth(D.monthGrid(2026, 9, 1)[30], 2026, 9), true, '网格里 9 月 30 日落在 9 月');
eq(D.weekGrid('2026-09-20', 1)[0], '2026-09-14', '周视图从周一算起');

// 每个月都要能覆盖自己：网格中间必须包含本月 1 号
for (let m = 1; m <= 12; m++) {
  const g = D.monthGrid(2026, m, 1);
  const hasFirst = g.includes(`2026-${String(m).padStart(2, '0')}-01`);
  if (!hasFirst) {
    fail++;
    console.log(`  ✗ 2026 年 ${m} 月的网格里没有本月 1 号，第一格是 ${g[0]}`);
  } else pass++;
}

/* ---------- 6. 精确倒计时（注意：用相对时间，不能写死日期） ---------- */
const in5h = Date.now() + 5 * 3600 * 1000 + 30 * 1000;
const r = D.preciseRemain(in5h);
eq(r.negative, false, '未来时间不是负数');
eq(r.h, 5, `5 小时后应为 5 小时，实际 ${r.h}`);
eq(r.d, 0, '5 小时内天数应为 0');
const past = D.preciseRemain(Date.now() - 3600 * 1000);
eq(past.negative, true, '过去的时间标记为负数');
eq(past.h, 1, `1 小时前应为 1 小时，实际 ${past.h}`);

/* ---------- 7. 边界情况 ---------- */
// 今天就是纪念日
const today0 = D.computeDdl(mk({ recurrence: 'yearly-solar', date: '2001-09-20' }), '2026-09-20');
eq(today0.dayDiff, 0, '今天的纪念日 dayDiff=0');
eq(today0.label, '就是今天', '今天的纪念日标签');

// 不重复的今天
eq(D.computeDdl(mk({ recurrence: 'none', date: '2026-09-20' }), '2026-09-20').label, '就是今天', '不重复的今天');

// 生日样式：天数照旧，另附"下一次生日是第 N 周年"
const ann = D.computeDdl(mk({ recurrence: 'yearly-solar', date: '2000-03-08', anniversaryStyle: true }), '2026-09-20');
eq(ann.unit, '天', '生日样式主数字仍是天数');
eq(ann.bigNumber, D.diffDays('2027-03-08', '2026-09-20'), '生日样式的天数准确');
eq(ann.anniversaryNth, 27, `下次 2027-03-08 是第 27 周年，实际 ${ann.anniversaryNth}`);
eq(ann.passed, false, '生日样式下一次在未来');
// 今年的生日刚过：2001-09-10 的周年，2026-09-20 看下一次是 2027-09-10（第 26 周年）
const annPast = D.computeDdl(mk({ recurrence: 'yearly-solar', date: '2001-09-10', anniversaryStyle: true }), '2026-09-20');
eq(annPast.occurrence, '2027-09-10', '刚过完的周年滚到明年');
eq(annPast.anniversaryNth, 26, `下次是第 26 周年，实际 ${annPast.anniversaryNth}`);
// 今天正好是周年
const annToday = D.computeDdl(mk({ recurrence: 'yearly-solar', date: '2001-09-20', anniversaryStyle: true }), '2026-09-20');
eq(annToday.label, '就是今天', '周年当天标签');
eq(annToday.anniversaryNth, 25, `当天是第 25 周年，实际 ${annToday.anniversaryNth}`);

// 每月重复：31 号在小月对齐到月末
const monthly = D.computeDdl(mk({ recurrence: 'monthly', date: '2026-01-31' }), '2026-02-15');
console.log(`每月 31 号（2 月）下一次 -> ${monthly.occurrence}`);
eq(D.parse(monthly.occurrence).getDate(), 28, '每月重复在小月落到月末');

// 每周重复：当天就是那一天
const weeklyToday = D.computeDdl(mk({ recurrence: 'weekly', date: '2026-09-16' }), '2026-09-16');
eq(weeklyToday.dayDiff, 0, '每周重复当天为 0');

// 无农历数据时不崩
eq(typeof D.computeDdl(mk({ calendar: 'lunar', recurrence: 'yearly-lunar', date: '2020-01-01' }), '2026-09-20').occurrence, 'string', '缺农历字段时兜底不崩');

// 闰月年份的闰月日存在性
eq(D.lunarMonthsOfYear(2025).includes(-6), true, '2025 年有闰六月');
eq(D.lunarMonthDays(2023, 2, true) >= 29, true, '2023 闰二月天数合理');

// 年龄计算
eq(D.ageOf('2000-03-08', '2026-09-20'), 26, '周岁计算');
eq(D.ageOf('2000-09-25', '2026-09-20'), 25, '生日没过不加岁');

/* ---------- 8. 农历生日要用出生年（修复：以前只能选最近两年，周年数算成 1） ---------- */
const born1985 = D.lunarToSolar(1985, 10, 8, true);
console.log(`1985 年农历十月初八 -> 公历 ${born1985.date}`);
eq(born1985.date.slice(0, 4), '1985', '1985 年的农历日期能换算出来');

const bornItem = mk({
  calendar: 'lunar',
  lunar: { month: 10, day: 8, leap: false },
  recurrence: 'yearly-lunar',
  anniversaryStyle: true,
  date: born1985.date,
});
const bornView = D.computeDdl(bornItem, '2026-09-20');
console.log(
  `2026-09-20 时，1985 年出生的农历生日：下一次 ${bornView.occurrence}，第 ${bornView.anniversaryNth} 周年`,
);
eq(D.parse(bornView.occurrence).getFullYear() - 1985, bornView.anniversaryNth, '周年数 = 发生年 - 出生年');
eq(
  bornView.anniversaryNth >= 40 && bornView.anniversaryNth <= 42,
  true,
  `1985 年生人到 2026 年应是 41 岁上下，实际 ${bornView.anniversaryNth}`,
);
// 对照：如果把"今年"当成出生年，周年数才会是 1 —— 这正是之前的问题
const wrongItem = mk({
  calendar: 'lunar',
  lunar: { month: 10, day: 8, leap: false },
  recurrence: 'yearly-lunar',
  anniversaryStyle: true,
  date: '2026-11-16',
});
eq(D.computeDdl(wrongItem, '2026-09-20').anniversaryNth, 1, '把今年当出生年时周年数才是 1（对照）');

/* ---------- 9. 截止日 ---------- */
function mkDl(over) {
  return {
    id: 'dl1',
    title: '课题方案提交',
    dueDate: '2026-09-25',
    priority: 1,
    progress: 60,
    done: false,
    color: '#E0574F',
    tags: ['论文'],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const dlTodo = {
  id: 't9',
  title: '写方案',
  date: '2026-09-25',
  baseDate: '2026-09-25',
  repeat: 'none',
  done: false,
  priority: 1,
  order: 0,
  deadlineId: 'dl1',
  createdAt: 0,
  updatedAt: 0,
};

const dlSoon = D.computeDeadline(mkDl({}), [dlTodo], '2026-09-20');
eq(dlSoon.daysLeft, 5, '截止日剩余天数');
eq(dlSoon.statusText, '还有 5 天', '截止日状态文案');
eq(dlSoon.urgency, 'soon', '5 天算「快到了」');
eq(dlSoon.todos.length, 1, '截止日能带出关联待办');

const dlToday = D.computeDeadline(mkDl({ dueDate: '2026-09-20' }), [], '2026-09-20');
eq(dlToday.dueToday, true, '今天到期标记');
eq(dlToday.statusText, '今天到期', '今天到期文案');
eq(dlToday.urgency, 'today', '今天到期紧急度');

const dlOver = D.computeDeadline(mkDl({ dueDate: '2026-09-17' }), [], '2026-09-20');
eq(dlOver.overdue, true, '过期标记');
eq(dlOver.statusText, '已过期 3 天', '过期文案');
eq(dlOver.urgency, 'overdue', '过期紧急度');

const dlDone = D.computeDeadline(mkDl({ done: true, progress: 100 }), [], '2026-09-20');
eq(dlDone.overdue, false, '已完成的不算过期');
eq(dlDone.urgency, 'done', '完成紧急度');

eq(D.computeDeadline(mkDl({ dueDate: '2026-09-21' }), [], '2026-09-20').statusText, '明天到期', '明天到期文案');
eq(D.computeDeadline(mkDl({ dueDate: '2026-12-01' }), [], '2026-09-20').urgency, 'normal', '远期不算紧急');

/* 日历显示规则 */
eq(D.deadlineShowsOn(mkDl({}), '2026-09-25', '2026-09-20'), true, '截止当天在日历上显示');
eq(D.deadlineShowsOn(mkDl({}), '2026-09-24', '2026-09-20'), false, '没到期不在别的日子显示');
eq(D.deadlineShowsOn(mkDl({ dueDate: '2026-09-17' }), '2026-09-20', '2026-09-20'), true, '过期未完成挂在今天');
eq(D.deadlineShowsOn(mkDl({ dueDate: '2026-09-17', done: true }), '2026-09-20', '2026-09-20'), false, '已完成的过期项不再挂');

/* 排序：过期 → 今天 → 快到期 → 远期 → 已完成 */
const sortedIds = D.sortDeadlines([
  D.computeDeadline(mkDl({ id: 'a', dueDate: '2026-12-01' }), [], '2026-09-20'),
  D.computeDeadline(mkDl({ id: 'b', dueDate: '2026-09-17' }), [], '2026-09-20'),
  D.computeDeadline(mkDl({ id: 'c', dueDate: '2026-09-20' }), [], '2026-09-20'),
  D.computeDeadline(mkDl({ id: 'd', dueDate: '2026-09-25' }), [], '2026-09-20'),
  D.computeDeadline(mkDl({ id: 'e', dueDate: '2026-09-18', done: true }), [], '2026-09-20'),
]).map((v) => v.d.id);
eq(sortedIds.join(','), 'b,c,d,a,e', `截止日排序，实际 ${sortedIds.join(',')}`);

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
