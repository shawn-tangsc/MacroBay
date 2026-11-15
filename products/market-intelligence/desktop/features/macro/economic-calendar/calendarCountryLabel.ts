/**
 * 国家这一格显示什么：**映射出的名字 → 源给的国家码原样 → 「未知国家」**。
 *
 * 用户 2026-11-16 定了两次：先是「名字是什么就显示什么」，再是「没有国家数据的时候，显示
 * 未知国家」。所以这一格**永远有内容**，不留空：
 * - 查得到名字 → 「美国」；
 * - 查不到名字 → 源给的原值，`US` 就 `US`、`USA` 就 `USA`，**不改名、不猜**；
 * - 两者都没有 → 走 i18n 的「未知国家」。不用「—」「N/A」：那是「没有这一项」，
 *   而这里是「我们不知道是哪国」——两件事，读者要能分清。
 *
 * **三级只在这里判一次**（架构师 2026-11-16 的要求）：行组件与详情面板都只调它，不许在调用点
 * 再补一段 `?? 未知国家`。写成两处 if 链的话，将来加第三档（比如别名表）就会出现「一处改了、
 * 一处没改」，而三条 DOM 判据断的本来是同一个实现。
 */
export function calendarCountryLabel(
  event: Readonly<{ countryName?: string | undefined; countryCode?: string | null }>,
  text: Readonly<{ market: Readonly<{ unknownCountry: string }> }>
): string {
  return event.countryName ?? event.countryCode ?? text.market.unknownCountry
}
