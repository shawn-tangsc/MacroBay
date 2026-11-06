import { describe, expect, it } from 'vitest'

import {
  analysisFailureNoticePolicy,
  analysisRunOutcomesOf,
  analysisFailureNoticeDedupeVars,
  buildAnalysisFailureNoticeRequest,
  decideAnalysisFailureNotice,
  decideAttemptAbandoned,
  failureEpisodeRunId,
  type AnalysisRunOutcome
} from './analysisFailureNotices'

const at = (minutesAgo: number): string => new Date(Date.UTC(2026, 10, 6, 12, 0) - minutesAgo * 60_000).toISOString()

const failed = (index: number): AnalysisRunOutcome => ({ id: `run-${index}`, line: 'event', status: 'failed', failureCode: 'analysis-provider-error', queuedAt: at(index) })
const ok = (index: number): AnalysisRunOutcome => ({ id: `run-${index}`, line: 'event', status: 'succeeded', failureCode: null, queuedAt: at(index) })

describe('the three failure notices', () => {
  it('calls six failures in the last ten a pattern, five not one', () => {
    expect(decideAnalysisFailureNotice({ line: 'event', runs: Array.from({ length: 6 }, (_, index) => failed(index)) }))
      .toMatchObject({ kind: 'repeated-failure', failures: 6, sample: 6 })
    expect(decideAnalysisFailureNotice({ line: 'event', runs: Array.from({ length: 5 }, (_, index) => failed(index)) }))
      .toEqual({ kind: 'none' })
    // 十次里六次失败：样本够了，比例也够。
    const mixed = [0, 1, 2, 3, 4, 5].map(failed).concat([6, 7, 8, 9].map(ok))
    expect(decideAnalysisFailureNotice({ line: 'event', runs: mixed })).toMatchObject({ kind: 'repeated-failure', failures: 6, sample: 10 })
  })

  it('reports a recovery only after two successes, and keys it by the run that opened the episode', () => {
    const episode = [0, 1, 2, 3, 4, 5].map(failed)
    expect(decideAnalysisFailureNotice({ line: 'event', runs: [ok(10), ok(11), ...episode], missingCount: 6 }))
      .toMatchObject({ kind: 'recovered', episodeRunId: 'run-5', missingCount: 6 })
    // 一次成功还不够：故障可能是间歇的，报「恢复」会变成假消息。
    expect(decideAnalysisFailureNotice({ line: 'event', runs: [ok(10), failed(11), ...episode] }))
      .toMatchObject({ kind: 'none' })
  })

  it('never turns a recovery back into a repeated failure, even when the window is full of failures', () => {
    const decision = decideAnalysisFailureNotice({ line: 'event', runs: [ok(0), ok(1), ...Array.from({ length: 8 }, (_, index) => failed(index + 2))] })
    // 恢复优先：同一个时刻报「连续失败」会把刚恢复的事说反。
    expect(decision.kind).toBe('recovered')
  })

  it('does not let a cancellation look like a failure or a recovery', () => {
    // 读者关窗、任务取消、应用退出：这是我们把它停了，不是它坏了。
    const cancels = Array.from({ length: 6 }, (_, index): AnalysisRunOutcome => ({ ...failed(index), status: 'cancelled', failureCode: null }))
    expect(decideAnalysisFailureNotice({ line: 'event', runs: cancels })).toEqual({ kind: 'none' })
    // 取消不打断已经开着的故障段：取消失败之间仍算同一段。
    expect(failureEpisodeRunId([{ ...failed(0), status: 'cancelled' }, failed(1), failed(2)])).toBe('run-2')
    // 取消夹在两次成功后面，不构成恢复。
    expect(decideAnalysisFailureNotice({ line: 'event', runs: [ok(0), { ...failed(1), status: 'cancelled' }] }))
      .toEqual({ kind: 'none' })
  })

  it('keeps the lines apart: one line failing is not another line failing', () => {
    const calendar: AnalysisRunOutcome[] = Array.from({ length: 6 }, (_, index) => ({ ...failed(index), line: 'calendar' }))
    expect(decideAnalysisFailureNotice({ line: 'event', runs: calendar })).toEqual({ kind: 'none' })
  })

  it('reads the episode id from the run record, so a restart does not lose it', () => {
    expect(failureEpisodeRunId([failed(2), failed(5), ok(9)])).toBe('run-5')
    expect(failureEpisodeRunId([ok(1), ok(2)])).toBeUndefined()
  })

  it('treats an abandoned attempt as one fact, not a streak', () => {
    expect(decideAttemptAbandoned({ line: 'event', runId: 'run-9', abandon: 'release' }))
      .toMatchObject({ kind: 'attempt-abandoned', runId: 'run-9' })
    expect(decideAttemptAbandoned({ line: 'event', runId: '', abandon: 'release' })).toEqual({ kind: 'none' })
  })

  it('reads the decision input off stored rows, deriving the line from the trigger key', () => {
    const outcomes = analysisRunOutcomesOf([
      { id: 'r1', triggerKey: 'signal.open-interest.oi-liquidation-proxy', status: 'failed', failureCode: 'analysis-provider-error', queuedAt: at(10) },
      { id: 'r2', triggerKey: 'calendar.refresh', status: 'succeeded', failureCode: null, queuedAt: at(1) },
      { id: 'r3', triggerKey: 'signal.etf-flows.etf-outflow-3d', status: 'cancelled', failureCode: null, queuedAt: at(5) }
    ])
    expect(outcomes.map(run => [run.id, run.line])).toEqual([['r2', 'calendar'], ['r3', 'event'], ['r1', 'event']])
  })

  it('passes only the declaration’s variables and lets the platform compose the key', () => {
    // 键字符串由平台按声明展开：这里只传声明点名的变量，不自己拼。
    expect(analysisFailureNoticeDedupeVars({ kind: 'recovered', line: 'event', episodeRunId: 'run-5', missingCount: 3 }))
      .toEqual({ episodeRunId: 'run-5' })
    expect(analysisFailureNoticeDedupeVars({ kind: 'repeated-failure', line: 'event', failures: 6, sample: 10 }))
      .toEqual({ line: 'event' })
    expect(analysisFailureNoticeDedupeVars({ kind: 'attempt-abandoned', line: 'event', runId: 'r', abandon: 'release' }))
      .toEqual({ kind: 'release' })
    // 文案行还没落进平台时，构造出来必须是 undefined：半句话比不说更糟。
    expect(buildAnalysisFailureNoticeRequest({ kind: 'recovered', line: 'event', episodeRunId: 'run-5', missingCount: 3 }, at(0)))
      .toBeUndefined()
    expect(analysisFailureNoticePolicy.recoverySuccessStreak).toBe(2)
  })
})
