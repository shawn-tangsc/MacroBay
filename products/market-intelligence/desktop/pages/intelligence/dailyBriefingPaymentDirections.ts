import { productText } from '../../shared/i18n/productText'

/**
 * The funding-direction words, resolved once from the copy that owns them.
 *
 * The dashboard's positioning panel already says "多头付费 / 空头付费 / 中性" for a positive, a
 * negative and a flat funding rate. A brief card that said the same thing with its own words would be
 * a second name for one concept: tomorrow someone edits one of them and the other goes stale. So the
 * brief reuses that table — the card takes it as a prop, and nothing on the briefing side holds a copy.
 */
export type paymentDirectionWords = Readonly<Record<'long-pays-short' | 'short-pays-long' | 'neutral', string>>

export function briefingPaymentDirections(locale: 'zh-CN' | 'en-US'): paymentDirectionWords {
  // The compact set only: the card never prints the long wording, and handing it both would leave a
  // later edit a choice that fails silently.
  return productText[locale].pages.intelligence.portal.dashboard.positioning.paymentDirectionsCompact
}

/** The word for one funding rate: the sign decides, and a flat rate is its own word (never "positive"). */
export function paymentDirectionFor(rate: number | undefined, words: paymentDirectionWords): string {
  if (rate === undefined) return words.neutral
  if (rate > 0) return words['long-pays-short']
  if (rate < 0) return words['short-pays-long']
  return words.neutral
}

/**
 * The two words the dial's bottom row needs, resolved once from the copy that owns them.
 *
 * Same rule as the funding directions: the policy block already says "维持" and "其余 {value}", so the
 * brief reuses that table instead of holding a second copy of two words it does not own.
 */
export type policyGaugeWords = Readonly<{ hold: string; rest: string }>

export function briefingPolicyGaugeWords(locale: 'zh-CN' | 'en-US'): policyGaugeWords {
  const words = productText[locale].pages.intelligence.portal.dashboard.policyPath
  return { hold: words.shortOutcomes['no-change'], rest: words.topRest }
}

/** The arrows a signed change prints, resolved from the positioning copy that owns them. */
export type changeArrowWords = Readonly<{ up: string; down: string }>

export function briefingChangeArrows(locale: 'zh-CN' | 'en-US'): changeArrowWords {
  return productText[locale].pages.intelligence.portal.dashboard.positioning.changeArrows
}

/** The arrow for a signed change, and none at all for zero or an unknown value. */
export function changeArrowFor(value: number | undefined, words: changeArrowWords): string {
  if (value === undefined || value === 0) return ''
  return value > 0 ? words.up : words.down
}

/**
 * The fear-and-greed band words, resolved once from the copy that owns them.
 *
 * The band is derived from the score by the same table the collector uses (`resolveFearGreedSnapshotBucket`),
 * so the document stores the score and nothing else: a stored band would be the same fact in two places,
 * and the two disagree at a boundary. Only the words travel, and they travel from this one table.
 */
export type fearGreedBucketWords = Readonly<Record<'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed', string>>

export function briefingFearGreedBuckets(locale: 'zh-CN' | 'en-US'): fearGreedBucketWords {
  return productText[locale].pages.intelligence.portal.dashboard.fearGreed.buckets
}
