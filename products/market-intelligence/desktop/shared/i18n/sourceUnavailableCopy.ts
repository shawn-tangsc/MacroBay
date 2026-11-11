/**
 * 来源「不可用」的原因码 → **读者看到的说法**。全仓只有这一张表。
 *
 * 规则（今晚定的）：正文只给人话，**内部码不进正文**；码本身要出现就走 ⓘ。
 * 表里没有的码退回兜底那句（「取不到（原因见详情）」），**绝不把码漏出来**——
 * 码名一改就会变成读者读不懂的串。
 *
 * 配置抽屉目录调用这里（设置页详情那块已按用户 2026-11-12 删除）：加码只改这一处。
 */
/**
 * 一个码在**不同来源类型**下不是同一句话：403 对官方日历是「官方源」，对聚合商 feed
 * 就不能也叫官方源。句子按 `kind` 分组，登记方不用记住「这个码只给某一类用」。
 * `kind` 缺省时给不指认归属的那句（「这个来源暂时不可用」）——宁可不说是哪一类，也不叫错。
 */
type SentenceGroup = 'official' | 'market' | 'other'

const UNAVAILABLE_SENTENCE: Readonly<Record<string, Readonly<Record<SentenceGroup, string>>>> = {
  'official-endpoint-returned-403': {
    official: '官方源暂时不可用（403）',
    market: '市场日历源暂时不可用（403）',
    other: '这个来源暂时不可用（403）'
  }
}

function sentenceGroupOf(kind: string | undefined): SentenceGroup {
  if (kind === 'official-calendar') return 'official'
  if (kind === 'market-calendar') return 'market'
  return 'other'
}

/**
 * 兜底句的文案键：两个面都解析**同一个键**，不许各自再写一句「取不到」。
 * 值在 `productText` 的配置抽屉文案组里（`取不到（原因见详情）`）。
 */
export const SOURCE_UNAVAILABLE_FALLBACK_KEY = 'pages.intelligence.portal.dashboard.configDrawer.sourceUnavailable'

const CODE_LIKE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/u

export function sourceUnavailableSentence(reasonCode: string | undefined, fallback: string, kind?: string): string {
  if (reasonCode === undefined) return fallback
  return UNAVAILABLE_SENTENCE[reasonCode]?.[sentenceGroupOf(kind)] ?? fallback
}

/** 兜底：看起来像内部码就绝不显示原文。 */
export function looksLikeReasonCode(value: string): boolean {
  return CODE_LIKE.test(value)
}
