import { describe, expect, it, vi } from 'vitest'

import {
  buildSourceRefusalRequest,
  isPermanentRefusal,
  notifySourceRefusal,
  SOURCE_REFUSAL_SOURCE_NAME
} from './sourceRefusalNotifier'

const notice = Object.freeze({ sourceId: 'realmarketapi-market', symbols: Object.freeze(['DXY']) })
const occurredAt = '2026-11-16T11:20:00.000Z'

describe('the source refusal notice', () => {
  it('is only for permanent refusals', () => {
    // 永久错误才发这条：临时失败走 source.consecutive-failed，两件事的动作不同。
    expect(isPermanentRefusal('symbol-not-supported')).toBe(true)
    for (const code of ['response-invalid', 'rate-limited', 'plan-restricted', 'transport-unavailable'] as const) {
      expect(isPermanentRefusal(code)).toBe(false)
    }
  })

  it('builds a request whose key, variant-free body and params all come from one place', () => {
    const request = buildSourceRefusalRequest(notice, occurredAt)
    expect(request).toEqual({
      eventTypeId: 'market-intelligence.source.symbol-not-supported',
      producerId: 'realmarketapi-market',
      bodyParams: { sourceName: SOURCE_REFUSAL_SOURCE_NAME, symbols: 'DXY' },
      // 键由平台展开：这里只给参数，拼法只有平台一处。
      dedupeVars: { builder: 'sourceIssue', sourceId: 'realmarketapi-market' },
      actions: [],
      occurredAt
    })
  })

  it('merges several refused instruments into one sentence', () => {
    const request = buildSourceRefusalRequest({ sourceId: 'realmarketapi-market', symbols: ['DXY', 'USTEC'] }, occurredAt)
    expect(request.bodyParams?.symbols).toBe('DXY、USTEC')
    // 一条事件一条键：多只品种合并进同一条，不按品种拆成两条提醒。
    expect(request.dedupeVars).toEqual({ builder: 'sourceIssue', sourceId: 'realmarketapi-market' })
  })

  it('does nothing without a port or without a refused instrument, and never lets a submit failure reach the tick', async () => {
    expect(await notifySourceRefusal(undefined, notice, occurredAt)).toBeNull()
    expect(await notifySourceRefusal(vi.fn(), { sourceId: 'realmarketapi-market', symbols: [] }, occurredAt)).toBeNull()

    const submit = vi.fn(async () => { throw new Error('notification-center-down') })
    await expect(notifySourceRefusal(submit, notice, occurredAt)).resolves.toBeNull()
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
