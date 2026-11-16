// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { capitalConditionsCollectableSourceIds, collectCapitalConditionsSources } from './capitalConditionsCollection'

const originalPlatform = (window as unknown as { platform?: unknown }).platform
afterEach(() => {
  if (originalPlatform === undefined) delete (window as unknown as { platform?: unknown }).platform
  else (window as unknown as { platform?: unknown }).platform = originalPlatform
  vi.restoreAllMocks()
})

describe('collectCapitalConditionsSources', () => {
  it('asks the collection layer for every source the panel reads, instead of re-reading them', async () => {
    const invoke = vi.fn(async () => ({ action: 'queued' }))
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    await collectCapitalConditionsSources()

    // 2026-11-17：ETF 那一半也能手动重采（主源打开了手动采集），点一下走的仍是产品自己的
    // ETF 刷新——同一轮里主源 + 备源合并。
    expect(capitalConditionsCollectableSourceIds).toEqual(['defillama-stablecoins', 'cryptoetf-etf-flows'])
    expect(invoke.mock.calls).toEqual([
      ['market-intelligence', 'intelligenceSources.runNow', { sourceId: 'defillama-stablecoins' }],
      ['market-intelligence', 'intelligenceSources.runNow', { sourceId: 'cryptoetf-etf-flows' }]
    ])
  })

  it('still leaves the standby out, because it is merged into the primary\'s round', () => {
    // `0xrouter-aggregate-provider` 的目录项仍是 `supportsRunNow: false`——它是被合并的一方，
    // 单独给它一颗按钮只会重复采一次；触发主源那一轮就已经把两源都取了。
    expect(capitalConditionsCollectableSourceIds).not.toContain('0xrouter-aggregate-provider')
  })

  it('surfaces a refused collection instead of reporting a successful refresh', async () => {
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke: vi.fn(async () => { throw new Error('Source is not ready to run.') }) } }
    await expect(collectCapitalConditionsSources()).rejects.toThrow('Source is not ready to run.')
  })
})
