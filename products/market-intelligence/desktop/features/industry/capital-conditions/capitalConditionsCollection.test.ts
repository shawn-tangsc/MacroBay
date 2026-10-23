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

    expect(capitalConditionsCollectableSourceIds).toEqual(['defillama-stablecoins'])
    expect(invoke.mock.calls).toEqual([
      ['market-intelligence', 'intelligenceSources.runNow', { sourceId: 'defillama-stablecoins' }]
    ])
  })

  it('leaves the ETF provider out, because its catalog entry does not authorize Run Now', () => {
    // `0xrouter-aggregate-provider` is the panel's ETF half, but `supportsRunNow: false` makes
    // `intelligenceSources.runNow` throw for it, which would fail the reader's click every time.
    expect(capitalConditionsCollectableSourceIds).not.toContain('0xrouter-aggregate-provider')
  })

  it('surfaces a refused collection instead of reporting a successful refresh', async () => {
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke: vi.fn(async () => { throw new Error('Source is not ready to run.') }) } }
    await expect(collectCapitalConditionsSources()).rejects.toThrow('Source is not ready to run.')
  })
})
