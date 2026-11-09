import { describe, expect, it } from 'vitest'

import {
  isFailingHealthState,
  panelView,
  providerHealthState,
  sourceHealthState,
  type SourceHealthState
} from './sourceProjection'

/**
 * 五态只在这一处派生（C6，2026-11-10）。三条要钉的事：
 * 1. 五种状态各自的边界（健康 / 多次失败 / 偏旧 / 失败 / 不亮）；
 * 2. 「不可用」与「没有健康读数」都不画成健康，也都不画红；
 * 3. 三个消费面（两个目录点、agent 的「哪些源坏了」）读的是同一个结论。
 */
describe('sourceHealthState', () => {
  const cases: ReadonlyArray<{ name: string; input: Parameters<typeof sourceHealthState>[0]; state: SourceHealthState }> = [
    { name: 'healthy', input: { enabled: true, health: { runtimeStatus: 'healthy', consecutiveFailures: 0 } }, state: 'healthy' },
    { name: 'degraded below the threshold is stale data, not repeated failures', input: { enabled: true, health: { runtimeStatus: 'degraded', consecutiveFailures: 2 } }, state: 'stale' },
    { name: 'degraded at the threshold is repeated failures', input: { enabled: true, health: { runtimeStatus: 'degraded', consecutiveFailures: 3 } }, state: 'repeated-failures' },
    { name: 'a failed read is failed', input: { enabled: true, health: { runtimeStatus: 'failed', consecutiveFailures: 0 } }, state: 'failed' },
    { name: 'never enabled', input: { enabled: false, health: { runtimeStatus: 'healthy', consecutiveFailures: 0 } }, state: 'off' },
    { name: 'no health reading is not health', input: { enabled: true }, state: 'off' },
    // 「取不到」不是「失败」：BLS 403 那种落不亮，不画红。
    { name: 'declared unavailable is not a failure', input: { enabled: true, unavailable: true, health: { runtimeStatus: 'failed', consecutiveFailures: 9 } }, state: 'off' }
  ]

  for (const entry of cases) {
    it(entry.name, () => { expect(sourceHealthState(entry.input)).toBe(entry.state) })
  }

  it('calls only the two red states "failing"', () => {
    expect(isFailingHealthState('failed')).toBe(true)
    expect(isFailingHealthState('repeated-failures')).toBe(true)
    for (const quiet of ['healthy', 'stale', 'off'] as const) expect(isFailingHealthState(quiet)).toBe(false)
  })
})

describe('providerHealthState', () => {
  it('takes the worst enabled state, and ignores disabled sources', () => {
    expect(providerHealthState([
      { enabled: true, healthState: 'healthy' },
      { enabled: true, healthState: 'stale' },
      { enabled: false, healthState: 'failed' }
    ])).toBe('stale')
    expect(providerHealthState([
      { enabled: true, healthState: 'stale' },
      { enabled: true, healthState: 'repeated-failures' }
    ])).toBe('repeated-failures')
    expect(providerHealthState([{ enabled: false, healthState: 'healthy' }])).toBe('off')
    expect(providerHealthState([])).toBe('off')
  })
})

describe('the projection carries the one state every surface reads', () => {
  it('derives healthState in panelView from the same health facts', () => {
    const view = panelView('dashboard', {
      enabledById: { 'fred-rates-liquidity': true, 'defillama-stablecoins': true },
      healthById: {
        'fred-rates-liquidity': { runtimeStatus: 'degraded', consecutiveFailures: 3 },
        'defillama-stablecoins': { runtimeStatus: 'healthy', consecutiveFailures: 0 }
      }
    })
    const states = view!.providers.flatMap((provider) => provider.sources.map((source) => [source.sourceId, source.healthState] as const))
    expect(states).toContainEqual(['fred-rates-liquidity', 'repeated-failures'])
    expect(states).toContainEqual(['defillama-stablecoins', 'healthy'])
    // 没有任何健康读数的源落不亮，不会被当成健康。
    expect(states.filter(([, state]) => state === 'healthy')).toHaveLength(1)
  })
})
