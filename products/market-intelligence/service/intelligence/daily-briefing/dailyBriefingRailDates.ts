/**
 * 天头要画哪些日子（`02` v2.91）：
 *
 * **有版次 ∨ 有过尝试记录（`daily_briefing_attempts`）∨ 这一天是今天。**
 * **仅"被排期覆盖"不算**——排期每天重复（07:00 天天都有），按它算等于每天都成立，14 天会全被铺出来。
 * 只放行"今天"一天，是把读者正看着的那一天放进来，不是把窗口放宽：其余无痕迹的日子照旧不出现。
 */
export function briefingRailDates(input: Readonly<{
  dates: readonly string[]
  editionDates: ReadonlySet<string>
  runDates: ReadonlySet<string>
  today: string
}>): readonly string[] {
  // 新到旧：读者第一眼要看的是今天（与列表按天倒序一致）。
  return Object.freeze(input.dates
    .filter((date) => input.editionDates.has(date) || input.runDates.has(date) || date === input.today)
    .reverse())
}
