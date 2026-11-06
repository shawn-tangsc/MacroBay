import { describe, expect, it } from 'vitest'

import {
  analysisFailureNoticePolicy,
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

  it('keeps the lines apart: one line failing is not another line failing', () => {
    const calendar: AnalysisRunOutcome[] = Array.from({ length: 6 }, (_, index) => ({ ...failed(index), line: 'calendar' }))
    expect(decideAnalysisFailureNotice({ line: 'event', runs: calendar })).toEqual({ kind: 'none' })
  })

  it('reads the episode id from the run record, so a restart does not lose it', () => {
    expect(failureEpisodeRunId([failed(2), failed(5), ok(9)])).toBe('run-5')
    expect(failureEpisodeRunId([ok(1), ok(2)])).toBeUndefined()
  })

  it('treats an abandoned attempt as one fact, not a streak', () => {
    expect(decideAttemptAbandoned({ line: 'event', runId: 'run-9', kindLabel: 'same-release-abandoned' }))
      .toMatchObject({ kind: 'attempt-abandoned', runId: 'run-9' })
    expect(decideAttemptAbandoned({ line: 'event', runId: '', kindLabel: 'x' })).toEqual({ kind: 'none' })
  })

  it('passes only the declaration’s variables and lets the platform compose the key', () => {
    // 键字符串由平台按声明展开：这里只传声明点名的变量，不自己拼。
    expect(analysisFailureNoticeDedupeVars({ kind: 'recovered', line: 'event', episodeRunId: 'run-5', missingCount: 3 }))
      .toEqual({ episodeRunId: 'run-5' })
    expect(analysisFailureNoticeDedupeVars({ kind: 'repeated-failure', line: 'event', failures: 6, sample: 10 }))
      .toEqual({ line: 'event' })
    expect(analysisFailureNoticeDedupeVars({ kind: 'attempt-abandoned', line: 'event', runId: 'r', kindLabel: 'same-release-abandoned' }))
      .toEqual({ kind: 'same-release-abandoned' })
    // 文案行还没落进平台时，构造出来必须是 undefined：半句话比不说更糟。
    expect(buildAnalysisFailureNoticeRequest({ kind: 'recovered', line: 'event', episodeRunId: 'run-5', missingCount: 3 }, at(0)))
      .toBeUndefined()
    expect(analysisFailureNoticePolicy.recoverySuccessStreak).toBe(2)
  })
})
