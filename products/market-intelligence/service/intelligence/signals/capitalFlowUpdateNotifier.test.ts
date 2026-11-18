import { describe, expect, it, vi } from 'vitest'

import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS } from '../../../contracts/notificationEventKeys'
import {
  buildEtfCapitalFlowUpdateRequest,
  notifyEtfCapitalFlowUpdates,
  renderEtfCapitalFlowSentence
} from './capitalFlowUpdateNotifier'

/**
 * R42 的成品句：改数那条**必须同时给旧值与新值**——只说「数据已更新」等于让读者自己猜哪变了。
 */
describe('the ETF capital-flow update notice', () => {
  it('says which trading day arrived, with its direction and amount', () => {
    const rendered = renderEtfCapitalFlowSentence({ kind: 'arrived', asset: 'BTC', tradingDate: '2026-11-16', netFlowUsd: 7_900_000 })
    expect(rendered).toBeDefined()
    expect(rendered!['zh-CN'].title).toContain('ETF 资金流')
    expect(rendered!['zh-CN'].title).toContain('BTC')
    expect(rendered!['zh-CN'].body).toContain('2026-11-16')
    // 金额走平台的统一格式化（与信号通知同一个实现）：中文是「万美元」，英文才是 `$7.9M`。
    expect(rendered!['zh-CN'].body).toContain('净流入')
    expect(rendered!['zh-CN'].body).toContain('790 万美元')
    expect(rendered!['en-US'].body).toContain('inflow')
    expect(rendered!['en-US'].body).toContain('$7.9M')
  })

  it('carries both the old and the new number when a settled day is revised', () => {
    const rendered = renderEtfCapitalFlowSentence({
      kind: 'revised', asset: 'ETH', tradingDate: '2026-11-16', netFlowUsd: -8_400_000, previousUsd: -46_500_000
    })
    expect(rendered!['zh-CN'].title).toContain('改了')
    expect(rendered!['zh-CN'].body).toContain('从')
    // 符号由「净流出」这个词表达，数字只印绝对值——与资金面表同一个读法。
    expect(rendered!['zh-CN'].body).toContain('净流出 4650 万美元')
    expect(rendered!['zh-CN'].body).toContain('净流出 840 万美元')
    expect(rendered!['en-US'].body).toContain('$46.5M')
    expect(rendered!['en-US'].body).toContain('$8.4M')
  })

  it('refuses a half sentence: a revision with no previous value is not submitted', () => {
    expect(renderEtfCapitalFlowSentence({ kind: 'revised', asset: 'BTC', tradingDate: '2026-11-16', netFlowUsd: 1 })).toBeUndefined()
    expect(buildEtfCapitalFlowUpdateRequest({ kind: 'revised', asset: 'BTC', tradingDate: '2026-11-16', netFlowUsd: 1 })).toBeUndefined()
  })

  it('lets the platform build the dedupe key from asset and trading day', () => {
    const request = buildEtfCapitalFlowUpdateRequest({ kind: 'arrived', asset: 'BTC', tradingDate: '2026-11-16', netFlowUsd: 1 })
    expect(request).toMatchObject({
      eventTypeId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.capitalFlowEtfUpdated,
      dedupeVars: { builder: 'template', vars: { asset: 'BTC', tradingDate: '2026-11-16' } },
      occurredAt: '2026-11-16T00:00:00.000Z',
      actions: []
    })
  })

  it('never turns a failed submission into a failed refresh', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(notifyEtfCapitalFlowUpdates(submit, [
      { kind: 'arrived', asset: 'BTC', tradingDate: '2026-11-16', netFlowUsd: 1 }
    ])).resolves.toEqual([])
    expect(submit).toHaveBeenCalledTimes(1)
    await expect(notifyEtfCapitalFlowUpdates(undefined, [{ kind: 'arrived', asset: 'BTC', tradingDate: '2026-11-16', netFlowUsd: 1 }])).resolves.toEqual([])
  })
})
