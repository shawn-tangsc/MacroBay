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

/**
 * The wait for market data ran out before the edition was built.
 *
 * Producing the edition anyway is right — the reader wants the morning brief — but it must not look
 * like an ordinary one: the sentence says the wait happened and how long it lasted, in the edition's
 * own language, in the same gap list the rest of the run uses.
 */
export function withCoreFactsNotReadyGap(
  document: DailyBriefingDocument,
  wait: Readonly<{ polls: number; waitedMs: number }>,
  locale: DailyBriefingLocale
): DailyBriefingDocument {
  if (!document.conclusion) return document
  const minutes = Math.max(1, Math.round(wait.waitedMs / 60_000))
  // The sentence names the policy, not just the wait: the reader has to know the edition was still
  // published as of its cutoff, and that data arriving after that is a different edition's business.
  const sentence = locale === 'en-US'
    ? `Core market data still missing after the ${minutes}-minute late-data grace: published as of the cutoff (${wait.polls} probes).`
    : `截止后 ${minutes} 分钟仍缺核心行情：按截止时点发布（探测 ${wait.polls} 次）。`
  const gaps = document.conclusion.dataGaps
  if (gaps.includes(sentence)) return document
  return Object.freeze({
    ...document,
    conclusion: Object.freeze({ ...document.conclusion, dataGaps: Object.freeze([...gaps, sentence]) })
  })
}

/**
 * Both run-level facts a reader needs in the gap list, applied once: a failed cross-asset read, and a
 * wait for market data that ran out. One call so the generation path stays a path.
 */
export function withRunGaps(
  document: DailyBriefingDocument,
  input: Readonly<{
    failure: string | undefined
    readinessWait: Readonly<{ ready: boolean; polls: number; waitedMs: number }> | undefined
    locale: DailyBriefingLocale
  }>
): DailyBriefingDocument {
  let next = withCrossAssetFailureGap(document, input.failure, input.locale)
  if (input.readinessWait && !input.readinessWait.ready) {
    next = withCoreFactsNotReadyGap(next, input.readinessWait, input.locale)
  }
  return next
}
