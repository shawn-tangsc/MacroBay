import { describe, expect, it, vi } from 'vitest'

import { createNewsSentimentAlertOutlet } from './newsSentimentAlertOutlet'
import { createNewsPushLedgerStore } from './newsPushLedgerStore'

const NOW = '2026-11-06T22:00:00.000Z'

function judgment(overrides: Record<string, unknown> = {}) {
  return {
    itemId: 'item-a',
    engine: 'model' as const,
    strength: 4,
    storyKey: 'story:2026-11-06:item-a',
    publishedAt: '2026-11-06T21:30:00.000Z',
    title: 'Bitcoin drops as midterm vote nears',
    ...overrides
  }
}

function harness(options: { enabledAt?: string; now?: string } = {}) {
  const ledger = createNewsPushLedgerStore(':memory:')
  if (options.enabledAt) ledger.enableOutlet({ at: options.enabledAt, baselineItemIds: [] })
  const deliver = vi.fn(async () => undefined)
  const outlet = createNewsSentimentAlertOutlet({
    ledger,
    deliver,
    now: () => options.now ?? NOW
  })
  return { ledger, deliver, outlet }
}

describe('newsSentimentAlertOutlet', () => {
  it('sends nothing while the reader has not switched the outlet on', async () => {
    const { deliver, outlet } = harness()
    // 默认关：没有水位就一条都不推，这是开关的默认值，不是失败态。
    expect(await outlet.onJudged(judgment())).toEqual({ outcome: 'skipped', reason: 'outlet-disabled' })
    expect(deliver).not.toHaveBeenCalled()
  })

  it('sends nothing published before the reader switched it on', async () => {
    const { deliver, outlet } = harness({ enabledAt: NOW })
    expect(await outlet.onJudged(judgment())).toEqual({ outcome: 'skipped', reason: 'before-enable' })
    expect(deliver).not.toHaveBeenCalled()
  })

  it('sends one qualifying judgement and records it in the ledger', async () => {
    const { ledger, deliver, outlet } = harness({ enabledAt: '2026-11-06T20:00:00.000Z' })
    expect(await outlet.onJudged(judgment())).toEqual({ outcome: 'pushed', tier: 'high' })
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(ledger.has('item-a')).toBe(true)
  })

  it('never sends the same item twice, however often it is rescored or the outlet re-enabled', async () => {
    const { ledger, deliver, outlet } = harness({ enabledAt: '2026-11-06T20:00:00.000Z' })
    await outlet.onJudged(judgment())
    // 重开开关：水位重置到新的一刻，账本不重置。
    ledger.enableOutlet({ at: '2026-11-06T21:45:00.000Z', baselineItemIds: [] })
    expect(await outlet.onJudged(judgment({ strength: 5 }))).toEqual({
      outcome: 'skipped',
      reason: 'already-pushed'
    })
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('does not send a rule hit even when it is loud', async () => {
    const { deliver, outlet } = harness({ enabledAt: '2026-11-06T20:00:00.000Z' })
    expect(await outlet.onJudged(judgment({ engine: 'rules', strength: 5 }))).toEqual({
      outcome: 'skipped',
      reason: 'rules-engine'
    })
    expect(deliver).not.toHaveBeenCalled()
  })

  it('resets the watermark on re-enable, so items between the two presses stay out', async () => {
    const { ledger, deliver, outlet } = harness({ enabledAt: '2026-11-06T20:00:00.000Z' })
    ledger.enableOutlet({ at: '2026-11-06T21:45:00.000Z', baselineItemIds: [] })
    expect(ledger.readWatermark()).toBe('2026-11-06T21:45:00.000Z')
    expect(await outlet.onJudged(judgment({ itemId: 'item-b' }))).toEqual({
      outcome: 'skipped',
      reason: 'before-enable'
    })
    expect(deliver).not.toHaveBeenCalled()
  })
})
