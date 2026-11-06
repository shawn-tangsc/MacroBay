import { describe, expect, it } from 'vitest'

import { createNewsPushLedgerStore } from './newsPushLedgerStore'
import { createNewsPushOutletService } from './newsPushOutletService'

const NOW = '2026-11-06T22:50:00.000Z'

function harness(items: Array<{ itemId: string; publishedAt: string }>) {
  const ledger = createNewsPushLedgerStore(':memory:')
  const service = createNewsPushOutletService({ ledger, listItems: () => items })
  return { ledger, service }
}

const items = [
  { itemId: 'old-a', publishedAt: '2026-11-04T10:00:00.000Z' },
  { itemId: 'old-b', publishedAt: '2026-11-05T21:00:00.000Z' },
  { itemId: 'fresh', publishedAt: '2026-11-06T22:00:00.000Z' }
]

describe('newsPushOutletService', () => {
  it('starts switched off: no watermark means disabled, not an error', () => {
    const { service } = harness(items)
    expect(service.state()).toEqual({ enabled: false })
  })

  it('writes the watermark and the baseline together, computing the baseline on the server', () => {
    const { ledger, service } = harness(items)
    // 只传「现在」：基线候选由服务端算，调用方传不了清单，也就不会有第二处造基线的地方。
    expect(service.setEnabled(true, NOW)).toEqual({
      enabled: true,
      enabledAt: NOW,
      baselineWritten: 2
    })
    expect(service.state()).toEqual({ enabled: true, enabledAt: NOW })
    // 24 小时以内那条不进基线。
    expect(ledger.has('old-a')).toBe(true)
    expect(ledger.has('old-b')).toBe(true)
    expect(ledger.has('fresh')).toBe(false)
  })

  it('turning it off keeps the ledger intact, so nothing is pushed twice', () => {
    const { ledger, service } = harness(items)
    service.setEnabled(true, NOW)
    const before = ledger.count()
    expect(service.setEnabled(false, NOW)).toEqual({ enabled: false, baselineWritten: 0 })
    expect(service.state()).toEqual({ enabled: false })
    expect(ledger.count()).toBe(before)
  })

  it('re-enabling moves the watermark to the new moment and keeps the old baseline rows', () => {
    const { ledger, service } = harness(items)
    service.setEnabled(true, NOW)
    service.setEnabled(false, NOW)
    const later = '2026-11-06T23:30:00.000Z'
    const reopened = service.setEnabled(true, later)
    expect(reopened.enabledAt).toBe(later)
    // 再打开不叠加：候选仍是那两条旧条目，但它们已经在账本里，写入幂等 ⇒ 新增 0 行。
    expect(reopened.baselineWritten).toBe(0)
    expect(ledger.count()).toBe(2)
    // `fresh` 仍不在账本里：它是「新闻」，将来该推。
    expect(ledger.has('fresh')).toBe(false)
  })
})
