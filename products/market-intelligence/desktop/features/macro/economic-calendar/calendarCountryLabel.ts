/**
 * 国家这一格显示什么：**映射出的名字 → 源给的国家码 → 什么都没有**。
 *
 * 用户 2026-11-16 定的规则：名字是什么就显示什么。查不到中文名时**原样显示源给的国家码**
 * （`US` 就显示 `US`、`USA` 就显示 `USA`），不替它改名、也不猜；两者都没有才不画这一格。
 *
 * 为什么不是「查不到就不画」：那是把「读不到」画成「没有」——国家列会整列静默消失，而事件
 * 本身还在，读者看不出这一行少了信息。今晚这条已经踩过一次（适配器只给码、没人算名）。
 *
 * **一处定义**：行（`CalendarEventRow`）与详情面板（`MarketCalendarEvents`）共用这一条链。
 * 唯一的差别在「两者都没有」之后：行不画这一格；详情面板要说出「未知国家」——同一个事实，
 * 两种表达，都在调用点决定，不在这里再分叉。
 */
export function calendarCountryLabel(event: Readonly<{
  countryName?: string | undefined
  countryCode?: string | null
}>): string | undefined {
  return event.countryName ?? event.countryCode ?? undefined
}
