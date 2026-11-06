import { describe, expect, it, vi } from 'vitest'

// 文案表里没有这条事件时，渲染器返回 undefined；这一条钉的正是那句兜底。用桩表模拟缺文案，
// 不拿真表：真表迟早会有这三条，而「没有文案就不发半句」必须永远成立。
vi.mock('@platform/notifications/producers/platformEventCopy', () => ({
  renderPlatformEventCopy: () => undefined
}))

import { buildAnalysisFailureNoticeRequest } from './analysisFailureNotices'

const at = '2026-11-06T12:00:00.000Z'

describe('a notice without its copy', () => {
  it('builds nothing instead of half a sentence', () => {
    expect(buildAnalysisFailureNoticeRequest({ kind: 'repeated-failure', line: 'event', failures: 6, sample: 10 }, at))
      .toBeUndefined()
    expect(buildAnalysisFailureNoticeRequest({ kind: 'attempt-abandoned', line: 'event', runId: 'run-9', abandon: 'release' }, at))
      .toBeUndefined()
    expect(buildAnalysisFailureNoticeRequest({ kind: 'recovered', line: 'event', episodeRunId: 'run-5', missingCount: 3 }, at))
      .toBeUndefined()
    // 没有决定就没有请求，这一条与文案无关，顺带钉住。
    expect(buildAnalysisFailureNoticeRequest({ kind: 'none' }, at)).toBeUndefined()
  })
})
