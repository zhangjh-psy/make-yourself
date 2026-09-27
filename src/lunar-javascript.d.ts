/**
 * lunar-javascript 的最小类型声明（该包本身不带类型）
 * 只声明本项目实际用到的 API。
 * 文档：https://github.com/6tail/lunar-javascript
 */
declare module 'lunar-javascript' {
  export class Solar {
    static fromYmd(year: number, month: number, day: number): Solar;
    static fromDate(date: Date): Solar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getLunar(): Lunar;
  }

  export class Lunar {
    static fromYmd(year: number, month: number, day: number): Lunar;
    /** 农历月，闰月为负数 */
    getMonth(): number;
    getDay(): number;
    getYear(): number;
    getSolar(): Solar;
    getJieQi(): string;
    getYearShengXiao(): string;
    getYearInGanZhi(): string;
    getMonthInChinese(): string;
    getDayInChinese(): string;
  }

  export class LunarMonth {
    getMonth(): number;
    getDayCount(): number;
    getFirstJulianDay(): number;
  }

  export class LunarYear {
    static fromYear(year: number): LunarYear;
    getMonths(): LunarMonth[];
  }
}
