import { DEFAULT_PERIOD_ID, type DailyBriefingEditionSummary, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { sessionWhen } from './briefingRailRowText'

/**
 * 屏幕上这一版的会话（E9）：历史里**按 (date, periodId, locale) 精确命中**那一条。
 *
 * 为什么抽出来：这条匹配只允许一种规则——取当前显示那一版。取第一版、按「最近一次生成」猜、
 * 按日期就近，都会在历史多版次时打开别人的会话；把它写成纯函数，就能拿三版真实夹具钉住。
 * 判据：`screenDocument` 为空（失败行 / 空态 / 别的日子没版次）或那一版没有会话时返回 `undefined`
 * ——顶部那颗整颗不渲染，不画禁用占位。
 */
export function briefingOnScreenSession(input: Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  edition: Readonly<{ date: string; periodId?: string; locale: DailyBriefingLocale }>
  /** 只用来取那句可访问名模板（`history.openSessionAria`），不让调用点自己拼文案。 */
  text: Readonly<{ history: Readonly<{ openSessionAria: string }> }>
  locale: DailyBriefingLocale
  timeZone: string
}>): Readonly<{ sessionId: string; label: string }> | undefined {
  const periodId = input.edition.periodId ?? DEFAULT_PERIOD_ID
  const summary = input.editions.find(entry =>
    entry.date === input.edition.date &&
    (entry.periodId ?? DEFAULT_PERIOD_ID) === periodId &&
    entry.locale === input.edition.locale)
  if (summary?.sessionId === undefined) return undefined
  return {
    sessionId: summary.sessionId,
    label: input.text.history.openSessionAria.replace('{when}', sessionWhen(summary, input.locale, input.timeZone))
  }
}
