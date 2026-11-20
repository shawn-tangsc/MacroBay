import { describe, expect, it, vi } from 'vitest'

import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { buildStablecoinCapitalUpdateRequest, notifyStablecoinCapitalUpdate } from './stablecoinCapitalUpdateNotifier'

describe('the stablecoin capital update notice', () => {
  it('states the total supply and the one-day change, with the direction as a word', () => {
    const request = buildStablecoinCapitalUpdateRequest({ totalSupplyUsd: 244_700_000_000, change1dUsd: 58_200_000 }, '2026-11-18T00:30:00.000Z', 'Asia/Shanghai')
    expect(request).toMatchObject({
      eventTypeId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.capitalFlowStablecoinUpdated,
      // 键里是**读者日**：上海 08:30 收到的那条归 11-18。
      dedupeVars: { builder: 'template', vars: { day: '2026-11-18' } },
      occurredAt: '2026-11-18T00:30:00.000Z'
    })
    expect(request!.rendered!['zh-CN']!.body).toContain('总供给')
    expect(request!.rendered!['zh-CN']!.body).toContain('2447 亿美元')
    expect(request!.rendered!['zh-CN']!.body).toContain('净流入')
    expect(request!.rendered!['zh-CN']!.body).toContain('5820 万美元')
    expect(request!.rendered!['en-US']!.body).toContain('inflow')
  })

  it('swallows a failed submission and skips when there is no outlet', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(notifyStablecoinCapitalUpdate(submit, { totalSupplyUsd: 1, change1dUsd: 1 }, '2026-11-18T00:30:00.000Z', 'UTC')).resolves.toBeNull()
    await expect(notifyStablecoinCapitalUpdate(undefined, { totalSupplyUsd: 1, change1dUsd: 1 }, '2026-11-18T00:30:00.000Z', 'UTC')).resolves.toBeNull()
  })
})
