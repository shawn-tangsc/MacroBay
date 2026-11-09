import { describe, expect, it } from 'vitest'

import { sourceHealthTone } from './sourceHealthTone'

describe('sourceHealthTone', () => {
  it('lights green only for an enabled source whose health is healthy', () => {
    expect(sourceHealthTone({ enabled: true, unavailable: false, health: { runtimeStatus: 'healthy' } })).toBe('ok')
    // 「没有健康数据」不等于健康：这条以前画过绿的 healthy，而 BLS 正是这种源。
    expect(sourceHealthTone({ enabled: true, unavailable: false, health: undefined })).toBe('muted')
    expect(sourceHealthTone({ enabled: false, unavailable: false, health: { runtimeStatus: 'healthy' } })).toBe('muted')
  })

  it('keeps red for a failure this reading can be retried, and mutes "unavailable"', () => {
    expect(sourceHealthTone({ enabled: true, unavailable: false, health: { runtimeStatus: 'failed' } })).toBe('bad')
    // 不可用是「现在取不到」，不是失败——用红会让人以为点重试就好。
    expect(sourceHealthTone({ enabled: true, unavailable: true, health: { runtimeStatus: 'failed' } })).toBe('muted')
  })

  it('turns degraded into a warning, and into red only after repeated failures', () => {
    expect(sourceHealthTone({ enabled: true, unavailable: false, health: { runtimeStatus: 'degraded' } })).toBe('warn')
    expect(sourceHealthTone({ enabled: true, unavailable: false, health: { runtimeStatus: 'degraded', consecutiveFailures: 1 } })).toBe('warn')
    // 阈值与 `healthBadgeView` 共用同一个常量（今天是 3），不是另写一个数字。
    expect(sourceHealthTone({ enabled: true, unavailable: false, health: { runtimeStatus: 'degraded', consecutiveFailures: 3 } })).toBe('bad')
  })

  it('mutes a paused source: its word is "off", not "broken"', () => {
    expect(sourceHealthTone({ enabled: true, unavailable: false, health: { runtimeStatus: 'paused' } })).toBe('muted')
  })
})
