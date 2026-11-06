import { describe, expect, it } from 'vitest'

import { createNewsPushLedgerStore } from './newsPushLedgerStore'

describe('newsPushLedgerStore', () => {
  it('answers "pushed already" for a plain push and for a baseline row alike', () => {
    const ledger = createNewsPushLedgerStore(':memory:')
    expect(ledger.has('item-a')).toBe(false)
    ledger.markPushed({
      itemId: 'item-a',
      storyKey: 'story:2026-11-06:item-a',
      eventTypeId: 'market-intelligence.sentiment.alert',
      pushedAt: '2026-11-06T22:00:00.000Z'
    })
    ledger.markBaseline(['item-b'], '2026-11-06T22:00:00.000Z')
    // 账本闸只有一种读法：`item_id` 存在即视为推过，不区分基线行与真实推送。
    expect(ledger.has('item-a')).toBe(true)
    expect(ledger.has('item-b')).toBe(true)
    expect(ledger.count()).toBe(2)
  })

  it('is idempotent: reopening the outlet writes each baseline row once', () => {
    const ledger = createNewsPushLedgerStore(':memory:')
    const ids = ['item-a', 'item-b', 'item-c']
    expect(ledger.markBaseline(ids, '2026-11-06T22:00:00.000Z')).toBe(3)
    expect(ledger.markBaseline(ids, '2026-11-06T23:00:00.000Z')).toBe(0)
    expect(ledger.count()).toBe(3)
  })

  it('writes the watermark and the baseline in the same call, and never resets the ledger', () => {
    const ledger = createNewsPushLedgerStore(':memory:')
    expect(ledger.readWatermark()).toBeUndefined()
    expect(ledger.enableOutlet({ at: '2026-11-06T22:00:00.000Z', baselineItemIds: ['old-a', 'old-b'] })).toEqual({
      baselineWritten: 2
    })
    expect(ledger.readWatermark()).toBe('2026-11-06T22:00:00.000Z')
    expect(ledger.count()).toBe(2)

    // 关掉再打开：水位换到新的一刻，账本（含基线行）一行不少。
    ledger.enableOutlet({ at: '2026-11-06T23:30:00.000Z', baselineItemIds: ['old-a'] })
    expect(ledger.readWatermark()).toBe('2026-11-06T23:30:00.000Z')
    expect(ledger.count()).toBe(2)
  })

  it('records a rescore of an already pushed item as no change', () => {
    const ledger = createNewsPushLedgerStore(':memory:')
    ledger.markPushed({
      itemId: 'item-a',
      storyKey: 'story:2026-11-06:item-a',
      eventTypeId: 'market-intelligence.sentiment.alert',
      pushedAt: '2026-11-06T22:00:00.000Z'
    })
    ledger.markPushed({
      itemId: 'item-a',
      storyKey: 'story:2026-11-06:item-z',
      eventTypeId: 'market-intelligence.sentiment.alert',
      pushedAt: '2026-11-07T02:00:00.000Z'
    })
    expect(ledger.count()).toBe(1)
  })
})
