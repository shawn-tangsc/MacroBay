/**
 * 历史窗口的两个日期算术：展示窗口与"次日"。
 *
 * 都在 UTC 日期串上做，不借本地时区——"列表看哪几天"是窗口事实，不是读者的钟面时间；
 * 读者时区只影响那一版写的是哪一天，由版次自己带。
 */
export function dayAfter(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}

export function lastDays(today: string, days: number): readonly string[] {
  const start = Date.parse(`${today}T00:00:00.000Z`)
  return Object.freeze(Array.from({ length: days }, (_, index) =>
    new Date(start - (days - 1 - index) * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)))
}
