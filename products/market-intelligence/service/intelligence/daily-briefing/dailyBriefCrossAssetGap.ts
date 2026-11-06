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
/**
 * 读者能看到的那一句：只说政策与后果，**不说我们问了几次**。
 *
 * 次数是内部机制（「探测 60 次」读者既看不懂、也不该由他判断我们的重试策略）；它留在
 * `MI_DAILY_BRIEF_CORE_FACTS_NOT_READY` 的日志字段里。中文逐字由 Chief 2026-11-06 定。
 */
const NOT_READY_SENTENCE: Readonly<Record<DailyBriefingLocale, (minutes: number) => string>> = {
  'zh-CN': (minutes) => `截止后 ${minutes} 分钟仍缺核心行情，本期按截止时点发布；之后的行情归下一期。`,
  'en-US': (minutes) => `Core market data was still missing ${minutes} minutes after the cutoff; this edition is published as of its cutoff, and later data belongs to the next one.`
}

export function withCoreFactsNotReadyGap(
  document: DailyBriefingDocument,
  wait: Readonly<{ polls: number; waitedMs: number }>,
  locale: DailyBriefingLocale
): DailyBriefingDocument {
  if (!document.conclusion) return document
  const minutes = Math.max(1, Math.round(wait.waitedMs / 60_000))
  // 句子只讲政策与后果；`wait.polls` 不进文案（读者可见文字不许出现内部机制）。
  const sentence = NOT_READY_SENTENCE[locale](minutes)
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
    /** A fetch for the missing quotes was attempted during this run. */
    backfilled?: boolean
    locale: DailyBriefingLocale
  }>
): DailyBriefingDocument {
  let next = withCrossAssetFailureGap(document, input.failure, input.locale)
  if (input.readinessWait && !input.readinessWait.ready) {
    next = withCoreFactsNotReadyGap(next, input.readinessWait, input.locale)
  }
  return input.backfilled ? withBackfillAttemptGap(next, input.locale) : next
}

/**
 * We asked the source for the missing quotes and it still did not give them.
 *
 * A reader who is told only "missing" cannot tell a source that is slow from one that never answered,
 * and neither can the next person reading the log. The edition says we tried.
 */
export function withBackfillAttemptGap(document: DailyBriefingDocument, locale: DailyBriefingLocale): DailyBriefingDocument {
  if (!document.conclusion) return document
  const sentence = locale === 'en-US'
    ? 'Missing quotes were requested from the source again during this run and still did not arrive.'
    : '本次生成已向数据源补抓缺失报价，仍未取到。'
  const gaps = document.conclusion.dataGaps
  if (gaps.includes(sentence)) return document
  return Object.freeze({
    ...document,
    conclusion: Object.freeze({ ...document.conclusion, dataGaps: Object.freeze([...gaps, sentence]) })
  })
}
