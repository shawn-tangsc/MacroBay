import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'

/**
 * A failed cross-asset read is a fact about the run, and the reader deserves it in words.
 *
 * The named reason (`rejected:closedReturns.btc.4h`, `threw:…`, `not-wired`) exists only in memory at
 * generation time; the stored rows carry a code. Appending one sentence to the conclusion's own gap
 * list keeps the shape of the document unchanged — no new field, no `schemaVersion` move — while the
 * rail's gap block and the report both show what actually failed.
 */
const SENTENCE: Readonly<Record<DailyBriefingLocale, (failure: string) => string>> = {
  'zh-CN': (failure) => `跨资产查询失败：${failure}`,
  'en-US': (failure) => `Cross-asset query failed: ${failure}`
}

export function withCrossAssetFailureGap(document: DailyBriefingDocument, failure: string | undefined, locale: DailyBriefingLocale): DailyBriefingDocument {
  if (!failure || !document.conclusion) return document
  const sentence = SENTENCE[locale](failure)
  const gaps = document.conclusion.dataGaps
  if (gaps.includes(sentence)) return document
  return Object.freeze({
    ...document,
    conclusion: Object.freeze({ ...document.conclusion, dataGaps: Object.freeze([...gaps, sentence]) })
  })
}
