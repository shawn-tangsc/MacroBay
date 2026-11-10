/**
 * 来源「不可用」的原因码 → **读者看到的说法**。全仓只有这一张表。
 *
 * 规则（今晚定的）：正文只给人话，**内部码不进正文**；码本身要出现就走 ⓘ。
 * 表里没有的码退回兜底那句（「取不到（原因见详情）」），**绝不把码漏出来**——
 * 码名一改就会变成读者读不懂的串。
 *
 * 设置页的详情（`SourceHealthDetail.tsx`）与配置抽屉都调用这里：两处对同一个码给同一句话，
 * 加码只改这一处。
 */
const UNAVAILABLE_SENTENCE: Readonly<Record<string, string>> = {
  'official-endpoint-returned-403': '官方源暂时不可用（403）'
}

/**
 * 兜底句的文案键：两个面都解析**同一个键**，不许各自再写一句「取不到」。
 * 值在 `productText` 的配置抽屉文案组里（`取不到（原因见详情）`）。
 */
export const SOURCE_UNAVAILABLE_FALLBACK_KEY = 'pages.intelligence.portal.dashboard.configDrawer.sourceUnavailable'

const CODE_LIKE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/u

export function sourceUnavailableSentence(reasonCode: string | undefined, fallback: string): string {
  if (reasonCode === undefined) return fallback
  return UNAVAILABLE_SENTENCE[reasonCode] ?? fallback
}

/** 兜底：看起来像内部码就绝不显示原文。 */
export function looksLikeReasonCode(value: string): boolean {
  return CODE_LIKE.test(value)
}
