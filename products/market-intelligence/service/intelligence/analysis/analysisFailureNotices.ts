import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'
import { renderPlatformEventCopy } from '@platform/notifications/producers/platformEventCopy'

import { RUN_MARKET_ANALYSIS_JOB } from '../jobs/marketAnalysisJobIds'

/**
 * 三档自动分析的提醒：连续失败、被放弃、恢复。
 *
 * 三档是三件不同的事，读者对它们能做的事也不同：**连着好几次都不成**（去看看模型配置）、
 * **这一次在排队阶段就被放弃**（这次不会有结果了）、**恢复了**（可以回来看结论）。所以三个事件、
 * 三套独立额度，不合并成一个「分析有状况」。
 *
 * 这一层只做判定和请求构造：输入是已经按时间排好的运行结果，输出是「该发哪一档」。它不读库、
 * 不判额度（额度由平台按 UTC 日算），也不落任何状态——那三件事各有各的主人。
 */

export const ANALYSIS_REPEATED_FAILURE_EVENT_ID = 'platform.analysis.repeated-failure'
export const ANALYSIS_ATTEMPT_ABANDONED_EVENT_ID = 'platform.analysis.attempt-abandoned'
export const ANALYSIS_RECOVERED_EVENT_ID = 'platform.analysis.recovered'

export type AnalysisRunLine = 'event' | 'calendar' | 'scheduled'
export type AnalysisRunOutcomeStatus = 'succeeded' | 'failed' | 'cancelled'

/** One finished attempt, newest first when collected. */
export type AnalysisRunOutcome = Readonly<{
  id: string
  line: AnalysisRunLine
  status: AnalysisRunOutcomeStatus
  failureCode: string | null
  /** The instant the attempt was queued; the day bucket and the wording both read it. */
  queuedAt: string
}>

export const analysisFailureNoticePolicy = Object.freeze({
  version: 'analysisFailureNotice.v1',
  /** Six failures out of the last ten is a pattern, not a bad afternoon. */
  repeatedFailureWindow: 10,
  repeatedFailureMinimumFailures: 6,
  /** Two successes in a row after a failure ends the episode. */
  recoverySuccessStreak: 2,
  /** A gap smaller than this between the same notice is noise; the platform applies it. */
  repeatedFailureMinimumGapMs: 6 * 60 * 60 * 1_000
})

/**
 * The first failure of the current episode — the run id the recovery notice is keyed by.
 *
 * It has to survive a restart, so the caller reads it from the run record rather than recomputing it
 * from a list: a process that restarted mid-episode would otherwise forget which failure opened it
 * and the recovery notice would never be sent, silently.
 */
export function failureEpisodeRunId(runs: readonly AnalysisRunOutcome[]): string | undefined {
  // Newest first: walk back while it is still the same episode (failures, with successes only after
  // the episode has recovered), and keep the oldest failure that is still adjacent to today.
  let episode: string | undefined
  for (const run of runs) {
    if (run.status === 'succeeded') break
    episode = run.id
  }
  return episode
}

export type AnalysisFailureNoticeDecision =
  | Readonly<{ kind: 'repeated-failure'; line: AnalysisRunLine; failures: number; sample: number }>
  | Readonly<{ kind: 'attempt-abandoned'; line: AnalysisRunLine; runId: string; kindLabel: string }>
  | Readonly<{ kind: 'recovered'; line: AnalysisRunLine; episodeRunId: string; missingCount: number }>
  | Readonly<{ kind: 'none' }>

/**
 * Which notice, if any, this history asks for.
 *
 * One decision per call, and the order matters: a run that just succeeded after failures is a
 * recovery, and reporting "repeated failure" for the same moment would tell the reader the opposite
 * of what happened. Recovery is therefore judged first.
 */
export function decideAnalysisFailureNotice(input: Readonly<{
  runs: readonly AnalysisRunOutcome[]
  line: AnalysisRunLine
  /** Failures in this episode that produced no analysis — what the recovery sentence counts. */
  missingCount?: number
}>): AnalysisFailureNoticeDecision {
  const runs = input.runs.filter(run => run.line === input.line)
  const newest = runs[0]
  if (!newest) return { kind: 'none' }

  if (newest.status === 'succeeded') {
    const streak = runs.findIndex(run => run.status !== 'succeeded')
    const successes = streak === -1 ? runs.length : streak
    if (successes >= analysisFailureNoticePolicy.recoverySuccessStreak) {
      const episodeRunId = failureEpisodeRunId(runs.slice(successes))
      if (episodeRunId) {
        return { kind: 'recovered', line: input.line, episodeRunId, missingCount: input.missingCount ?? 0 }
      }
    }
    return { kind: 'none' }
  }

  const sample = runs.slice(0, analysisFailureNoticePolicy.repeatedFailureWindow)
  const failures = sample.filter(run => run.status !== 'succeeded').length
  if (sample.length >= analysisFailureNoticePolicy.repeatedFailureMinimumFailures &&
    failures >= analysisFailureNoticePolicy.repeatedFailureMinimumFailures) {
    return { kind: 'repeated-failure', line: input.line, failures, sample: sample.length }
  }
  return { kind: 'none' }
}

/**
 * The abandonment notice is a fact about one attempt, not a streak: the scheduler gave up on this
 * release, so this release will never be analysed. It carries no count.
 */
export function decideAttemptAbandoned(input: Readonly<{
  line: AnalysisRunLine
  runId: string
  kindLabel: string
}>): AnalysisFailureNoticeDecision {
  return input.runId ? { kind: 'attempt-abandoned', line: input.line, runId: input.runId, kindLabel: input.kindLabel } : { kind: 'none' }
}

export function analysisNoticeDeeplink(runId: string) {
  return {
    scope: 'product' as const,
    productId: 'market-intelligence',
    settingsSectionId: 'intelligence-sources',
    entityType: 'analysis-run',
    entityId: runId
  }
}

/**
 * The three variables the declaration names, and nothing else.
 *
 * Exported for its test: the key string is the platform's to compose, and a second composer here
 * would produce a key its counter never sees.
 */
export function analysisFailureNoticeDedupeVars(
  decision: Exclude<AnalysisFailureNoticeDecision, { kind: 'none' }>
): Readonly<Record<string, string>> {
  if (decision.kind === 'repeated-failure') return { line: decision.line }
  if (decision.kind === 'attempt-abandoned') return { kind: decision.kindLabel }
  return { episodeRunId: decision.episodeRunId }
}

/**
 * The submit request for one decision.
 *
 * The dedupe key is expanded by the platform from the declaration; this layer only passes the three
 * variables the declaration names (`line` / `kind` / `episodeRunId`), never a composed key. Composing
 * it here would create a second key format that the platform's counter cannot see.
 */
export function buildAnalysisFailureNoticeRequest(
  decision: AnalysisFailureNoticeDecision,
  occurredAt: string
): NotificationSubmitRequest | undefined {
  if (decision.kind === 'none') return undefined
  const vars = analysisFailureNoticeDedupeVars(decision)
  const eventTypeId = decision.kind === 'repeated-failure'
    ? ANALYSIS_REPEATED_FAILURE_EVENT_ID
    : decision.kind === 'attempt-abandoned'
      ? ANALYSIS_ATTEMPT_ABANDONED_EVENT_ID
      : ANALYSIS_RECOVERED_EVENT_ID
  const runId = decision.kind === 'attempt-abandoned' ? decision.runId : decision.kind === 'recovered' ? decision.episodeRunId : ''
  const deeplink = runId ? analysisNoticeDeeplink(runId) : undefined
  const params: Record<string, string> = decision.kind === 'repeated-failure'
    ? { failures: String(decision.failures), sample: String(decision.sample) }
    : decision.kind === 'attempt-abandoned'
      ? { kind: decision.kindLabel }
      : { missing: String(decision.missingCount) }
  const rendered = renderPlatformEventCopy({
    eventTypeId,
    paramsByLanguage: { 'zh-CN': params, 'en-US': params }
  })
  if (rendered === undefined) return undefined
  // No action button yet: a button needs a signed copy key, and those land with the platform's
  // declaration rows. A notice without its action is still readable; a notice with an unresolved
  // label key would render blank.
  return {
    eventTypeId,
    producerId: RUN_MARKET_ANALYSIS_JOB,
    dedupeVars: { builder: 'template', vars },
    rendered,
    ...(deeplink ? { deeplink } : {}),
    occurredAt
  } as NotificationSubmitRequest
}
