/** The month a meeting falls in, named the way the row's label needs it. */
export function policyPathMonth(meetingDate: string, locale: 'zh-CN' | 'en-US'): string {
  const month = Number(meetingDate.slice(5, 7))
  if (!Number.isInteger(month) || month < 1 || month > 12) return ''
  return locale === 'zh-CN' ? String(month) : new Date(Date.UTC(2026, month - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
}

/**
 * 一个**日历日**（`YYYY-MM-DD`）在读者语言里的写法：`12月9日` / `Dec 9`。
 *
 * 为什么不用 `formatShellDay` / `formatShellInstant`：那两处的入参是**瞬时**，会按读者时区换算；
 * 而 `meetingDate` / `sep.asOf` 是日历日（`decisionInstant()` 就是从这个字符串反推会议时刻的）。
 * 把日历日当瞬时按纽约或东八区换算，西半球读者会看到会前一天——那不是格式化，那是改日期。
 *
 * 所以这里用 UTC 锚定同一个日历日，只让 `Intl` 决定**书写顺序与分隔符**（语言差异在这里），
 * 不做任何字符串切片：`slice(5)` 在中文里恰好对，是因为它根本不看语言。
 */
export function policyPathDay(meetingDate: string, locale: 'zh-CN' | 'en-US'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(meetingDate)
  if (!match) return meetingDate
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const at = new Date(Date.UTC(year, month - 1, day))
  // 2026-02-30 这种会被 `Date.UTC` 顺延到三月：不是日期就原样交回去，不编一个出来。
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return meetingDate
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(at)
}
