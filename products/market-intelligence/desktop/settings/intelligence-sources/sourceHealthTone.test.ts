import { describe, expect, it } from 'vitest'

import { sourceHealthState } from '../../../service/intelligence/application/sourceProjection'
import { catalogMarkerClass, sourceHealthTone } from './sourceHealthTone'

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

  it('maps the projected marker tier to a class, and never decides it again', () => {
    // 纯映射：判据在 `sourceProjection.sourceHealthMarker`，这里不接收第二个输入。
    expect(catalogMarkerClass('warn')).toBe('is-warn')
    expect(catalogMarkerClass('bad')).toBe('is-bad')
    expect(catalogMarkerClass('ring')).toBe('is-muted')
    expect(catalogMarkerClass('none')).toBeUndefined()
  })
})
