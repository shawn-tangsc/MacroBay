/**
 * 来源「不可用」的原因码 → **读者看到的说法**。全仓只有这一张表。
 *
 * 规则（今晚定的）：正文只给人话，**内部码不进正文**；码本身要出现就走 ⓘ。
 * 表里没有的码退回兜底那句（「取不到（原因见详情）」），**绝不把码漏出来**——
 * 码名一改就会变成读者读不懂的串。
 *
 * 注意：`settings/intelligence-sources/ProviderDetail.tsx` 里还有一份同样的映射，
 * 那份要迁到这张表（该文件归存储缓存，等它那一笔）。在那之前以这张为准，不要加第三份。
 */
const UNAVAILABLE_SENTENCE: Readonly<Record<string, string>> = {
  'official-endpoint-returned-403': '官方源暂时不可用（403）'
}

const CODE_LIKE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/u

export function sourceUnavailableSentence(reasonCode: string | undefined, fallback: string): string {
  if (reasonCode === undefined) return fallback
  return UNAVAILABLE_SENTENCE[reasonCode] ?? fallback
}

/** 兜底：看起来像内部码就绝不显示原文。 */
export function looksLikeReasonCode(value: string): boolean {
  return CODE_LIKE.test(value)
}
