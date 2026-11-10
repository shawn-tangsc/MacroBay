import { describe, expect, it, vi } from 'vitest'

import {
  buildManualAnalysisFailureRequest,
  manualAnalysisFailureReasonCopy,
  notifyManualAnalysisFailure
} from './analysisManualFailureNotifier'

const failedRun = {
  runId: 'mi-ar-manual-1',
  failureCode: 'analysis-provider-error',
  failureDetailCode: 'upstream-aborted',
  occurredAt: '2026-11-06T10:00:00.000Z'
}

describe('manual analysis failure notice', () => {
  it('answers the attempt the reader asked for, keyed by that run', () => {
    const request = buildManualAnalysisFailureRequest(failedRun)
    expect(request?.eventTypeId).toBe('platform.analysis.manual-failed')
    expect(request?.dedupeVars).toEqual({ builder: 'template', vars: { runId: 'mi-ar-manual-1' } })
    // Two presses are two runs, so two notices; the key is the run, not the day.
    expect(buildManualAnalysisFailureRequest({ ...failedRun, runId: 'mi-ar-manual-2' })?.dedupeVars)
      .toEqual({ builder: 'template', vars: { runId: 'mi-ar-manual-2' } })
  })

  it('says the cause in words, not the code, in both languages at once', () => {
    const request = buildManualAnalysisFailureRequest(failedRun)
    // The reader's language is no longer an input: the record carries both sentences, so
    // switching language later re-reads the same notice in the new language.
    expect(request?.rendered?.['zh-CN']?.body).toBe(
      '你刚才点的那次分析没成：模型服务在生成中途断开了连接。这次没有产生结论，之前的结果不受影响。'
    )
    expect(request?.rendered?.['en-US']?.body).toBe(
      'The analysis you started did not finish: the model service dropped the connection while answering. Nothing was published this time, and earlier results are unaffected.'
    )
    expect(JSON.stringify(request)).not.toContain('upstream-aborted')
    expect(JSON.stringify(request)).not.toContain('analysis-provider-error')
    // One copy source per record: no leftover key once the sentence is in hand.
    expect(request).not.toHaveProperty('bodyParams')
    expect(request).not.toHaveProperty('bodyKey')
  })

  it('prefers the finer cause over the coarse code', () => {
    expect(manualAnalysisFailureReasonCopy({ failureCode: 'analysis-provider-error', failureDetailCode: 'http-429' })['zh-CN'])
      .toContain('限流')
    expect(manualAnalysisFailureReasonCopy({ failureCode: 'analysis-provider-error', failureDetailCode: 'connect-failed' })['en-US'])
      .toContain('could not be reached')
  })

  it('still answers when the cause is only known at the coarse level', () => {
    expect(manualAnalysisFailureReasonCopy({ failureCode: 'analysis-invalid-output-schema', failureDetailCode: 'shape:conclusion' })['zh-CN'])
      .toContain('不符合要求')
    expect(manualAnalysisFailureReasonCopy({ failureCode: 'something-new', failureDetailCode: 'also-new' })['zh-CN'])
      .toBe('这次分析没有完成')
    expect(manualAnalysisFailureReasonCopy({ failureCode: 'something-new', failureDetailCode: null })['en-US'])
      .toBe('this analysis did not finish')
  })

  it('carries an acknowledgement, not a link — the run log has no entry points any more', () => {
    const request = buildManualAnalysisFailureRequest(failedRun)
    // 用户 2026-11-11：运行记录只做审计、不设入口。这条通知只报事，按钮只确认收到。
    expect(request).not.toHaveProperty('deeplink')
    // `requiresUserAction` is declared for this event: an action-less submit is refused as
    // `missing-action`, so the acknowledgement is what makes it deliverable.
    expect(request?.actions).toEqual([{
      id: 'acknowledge',
      labelRef: { scope: 'product', productId: 'market-intelligence', key: expect.stringContaining('acknowledge') },
      kind: 'acknowledge'
    }])
  })

  it('never lets a failed submission change the run outcome', async () => {
    const submit = vi.fn(async () => { throw new Error('notification store unavailable') })
    await expect(notifyManualAnalysisFailure(submit, failedRun)).resolves.toBeUndefined()
    expect(submit).toHaveBeenCalledOnce()
    // No submitter wired (headless): silence, not a crash.
    await expect(notifyManualAnalysisFailure(undefined, failedRun)).resolves.toBeUndefined()
  })
})
