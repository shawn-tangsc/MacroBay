import { describe, expect, it } from 'vitest'

import { sourceHealthState } from '../../../service/intelligence/application/sourceProjection'
import { catalogMarkerKind, sourceHealthTone } from './sourceHealthTone'

describe('sourceHealthTone', () => {
  it('gives the healthy state the only green', () => {
    expect(sourceHealthTone('healthy')).toBe('ok')
    // 「没有健康读数」不等于健康：五态里它落 off，色调是灰。
    expect(sourceHealthTone(sourceHealthState({ enabled: true, health: undefined }))).toBe('muted')
    // 没启用也是灰，不是绿。
    expect(sourceHealthTone(sourceHealthState({ enabled: false, health: { runtimeStatus: 'healthy', consecutiveFailures: 0 } }))).toBe('muted')
  })

  it('gives red only to a failure that can still be fixed', () => {
    expect(sourceHealthTone(sourceHealthState({ enabled: true, health: { runtimeStatus: 'failed', consecutiveFailures: 1 } }))).toBe('bad')
    expect(sourceHealthTone(sourceHealthState({ enabled: true, health: { runtimeStatus: 'degraded', consecutiveFailures: 3 } }))).toBe('bad')
    // 「不可用」不是失败：不画红（BLS 403 那种）。
    expect(sourceHealthTone(sourceHealthState({ enabled: true, unavailable: true, health: { runtimeStatus: 'failed', consecutiveFailures: 9 } }))).toBe('muted')
  })

  it('separates "data is old" from "it keeps failing"', () => {
    expect(sourceHealthTone(sourceHealthState({ enabled: true, health: { runtimeStatus: 'degraded', consecutiveFailures: 1 } }))).toBe('warn')
    expect(sourceHealthTone(sourceHealthState({ enabled: true, health: { runtimeStatus: 'degraded', consecutiveFailures: 2 } }))).toBe('warn')
    expect(sourceHealthTone(sourceHealthState({ enabled: true, health: { runtimeStatus: 'degraded', consecutiveFailures: 3 } }))).toBe('bad')
  })

  it('draws the catalog marker by shape: ring only for "enabled but unavailable"', () => {
    expect(catalogMarkerKind('stale', false)).toBe('warn')
    expect(catalogMarkerKind('failed', false)).toBe('bad')
    expect(catalogMarkerKind('repeated-failures', false)).toBe('bad')
    expect(catalogMarkerKind('healthy', false)).toBeUndefined()
    // muted 是个桶（未启用 / 没数据 / 不可用）：只有「已启用且不可用」才画空心环。
    expect(catalogMarkerKind('off', true)).toBe('muted')
    expect(catalogMarkerKind('off', false)).toBeUndefined()
  })
})
