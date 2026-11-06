import { describe, expect, it, vi } from 'vitest'

import {
  buildManualAnalysisFailureRequest,
  manualAnalysisFailureReason,
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
    const request = buildManualAnalysisFailureRequest({ ...failedRun, language: 'zh-CN' })
    expect(request.eventTypeId).toBe('platform.analysis.manual-failed')
    expect(request.dedupeVars).toEqual({ builder: 'template', vars: { runId: 'mi-ar-manual-1' } })
    // Two presses are two runs, so two notices; the key is the run, not the day.
    expect(buildManualAnalysisFailureRequest({ ...failedRun, runId: 'mi-ar-manual-2', language: 'zh-CN' }).dedupeVars)
      .toEqual({ builder: 'template', vars: { runId: 'mi-ar-manual-2' } })
  })

  it('says the cause in words, not the code', () => {
    const zh = buildManualAnalysisFailureRequest({ ...failedRun, language: 'zh-CN' })
    const en = buildManualAnalysisFailureRequest({ ...failedRun, language: 'en-US' })
    expect(zh.bodyParams?.reason).toBe('模型服务在生成中途断开了连接')
    expect(en.bodyParams?.reason).toBe('the model service dropped the connection while answering')
    expect(JSON.stringify(zh)).not.toContain('upstream-aborted')
    expect(JSON.stringify(en)).not.toContain('analysis-provider-error')
  })

  it('prefers the finer cause over the coarse code', () => {
    expect(manualAnalysisFailureReason({ failureCode: 'analysis-provider-error', failureDetailCode: 'http-429', language: 'zh-CN' }))
      .toContain('限流')
    expect(manualAnalysisFailureReason({ failureCode: 'analysis-provider-error', failureDetailCode: 'connect-failed', language: 'en-US' }))
      .toContain('could not be reached')
  })

  it('still answers when the cause is only known at the coarse level', () => {
    expect(manualAnalysisFailureReason({ failureCode: 'analysis-invalid-output-schema', failureDetailCode: 'shape:conclusion', language: 'zh-CN' }))
      .toContain('不符合要求')
    expect(manualAnalysisFailureReason({ failureCode: 'something-new', failureDetailCode: 'also-new', language: 'zh-CN' }))
      .toBe('这次分析没有完成')
    expect(manualAnalysisFailureReason({ failureCode: 'something-new', failureDetailCode: null, language: 'en-US' }))
      .toBe('this analysis did not finish')
  })

  it('links into the run record, where the code can be read', () => {
    const request = buildManualAnalysisFailureRequest({ ...failedRun, language: 'zh-CN' })
    expect(request.deeplink).toEqual(expect.objectContaining({
      scope: 'product', productId: 'market-intelligence', entityType: 'analysis-run', entityId: 'mi-ar-manual-1'
    }))
    // The notice opens the record through the deeplink; the labelled action waits for the copy row.
    expect(request.actions).toEqual([])
    expect(request.deeplink).toEqual(expect.objectContaining({ entityId: 'mi-ar-manual-1' }))
  })

  it('never lets a failed submission change the run outcome', async () => {
    const submit = vi.fn(async () => { throw new Error('notification store unavailable') })
    await expect(notifyManualAnalysisFailure(submit, { ...failedRun, language: 'zh-CN' })).resolves.toBeUndefined()
    expect(submit).toHaveBeenCalledOnce()
    // No submitter wired (headless): silence, not a crash.
    await expect(notifyManualAnalysisFailure(undefined, { ...failedRun, language: 'zh-CN' })).resolves.toBeUndefined()
  })
})
