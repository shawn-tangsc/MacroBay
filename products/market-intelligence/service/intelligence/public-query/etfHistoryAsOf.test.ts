import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { cryptoEtfFlowFundsUrl } from '../application/cryptoEtfSourcePolicy'
import { createEtfHistoryAsOf, etfHistoryAsOfPolicy, type EtfHistoryApiWindow } from './etfHistoryAsOf'

const cutoff = '2026-10-30T00:00:00.000Z'
const later = '2026-10-30T04:48:00.000Z'

function midnight(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`)
}

/**
 * 夹具直接按读取器的入参造（`{ date, changeUsd }`）。
 *
 * **不再借旧源的 flow-history 客户端**：那条链 2026-11-13 已切到 CryptoETF、生产调用点为零，
 * 留着它当夹具等于让一条死链继续决定这个读取器的用例怎么写。`'refused'` 表示该资产这一窗
 * 读不到（原来是 503 响应），读取器对它的行为与本用例断言的一致：说清 gap，不编值。
 */
type WindowRows = readonly Readonly<{ date: number; changeUsd: number }>[]

function envelope(rows: readonly { tradingDate: string; changeUsd: number }[]): WindowRows {
  return rows.map((row) => Object.freeze({ date: midnight(row.tradingDate), changeUsd: row.changeUsd }))
}

function windowWith([btc, eth]: readonly [WindowRows | 'refused', WindowRows | 'refused']) {
  return {
    reader: createEtfHistoryAsOf({
      requestWindow: async () => {
        if (btc === 'refused' && eth === 'refused') return Object.freeze({ state: 'unavailable' as const })
        return Object.freeze({ state: 'available' as const,
          btc: btc === 'refused' ? [] : btc, eth: eth === 'refused' ? [] : eth })
      },
      now: () => Date.parse(later)
    })
  }
}

describe('ETF flow history as of an instant', () => {
  it('takes the newest trading day that had ended, through the provider client and the platform fetch', async () => {
    const { reader } = windowWith([
      envelope([
        { tradingDate: '2026-10-28', changeUsd: -10 },
        { tradingDate: '2026-10-29', changeUsd: 250_000_000 },
        { tradingDate: '2026-10-30', changeUsd: 999 }
      ]),
      envelope([
        { tradingDate: '2026-10-28', changeUsd: 5 },
        { tradingDate: '2026-10-29', changeUsd: -30_000_000 },
        { tradingDate: '2026-10-30', changeUsd: 777 }
      ])
    ])

    await expect(reader.read({ asset: 'btc', asOf: cutoff })).resolves.toEqual({
      state: 'available',
      asset: 'btc',
      asOf: cutoff,
      value: 250_000_000,
      tradingDate: '2026-10-29',
      observedAt: '2026-10-29T00:00:00.000Z',
      sourceUrl: cryptoEtfFlowFundsUrl('btc'),
      method: 'historical-api'
    })
    await expect(reader.read({ asset: 'eth', asOf: cutoff })).resolves.toMatchObject({
      state: 'available', asset: 'eth', value: -30_000_000,
      sourceUrl: cryptoEtfFlowFundsUrl('eth')
    })
  })

  it('does not touch the network for a future instant', async () => {
    const { reader } = windowWith([envelope([]), envelope([])])
    await expect(reader.read({ asset: 'btc', asOf: '2026-10-30T04:48:00.001Z' }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'future-as-of' })
  })

  it('never reports a trading day that had not ended by the instant', async () => {
    const { reader } = windowWith([
      envelope([{ tradingDate: '2026-10-30', changeUsd: 999 }]),
      envelope([{ tradingDate: '2026-10-30', changeUsd: 999 }])
    ])
    const result = await reader.read({ asset: 'btc', asOf: cutoff })
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'historical-as-of-unavailable' })
    expect('value' in result).toBe(false)
  })

  it('skips a trading day the provider contradicts itself about', async () => {
    const { reader } = windowWith([
      envelope([
        { tradingDate: '2026-10-28', changeUsd: -10 },
        { tradingDate: '2026-10-29', changeUsd: 250_000_000 },
        { tradingDate: '2026-10-29', changeUsd: -250_000_000 }
      ]),
      envelope([{ tradingDate: '2026-10-28', changeUsd: 5 }])
    ])
    await expect(reader.read({ asset: 'btc', asOf: cutoff })).resolves.toMatchObject({
      state: 'available', value: -10, tradingDate: '2026-10-28'
    })
  })

  it('answers historical-api-unavailable when no provider client is configured', async () => {
    const unwired = createEtfHistoryAsOf({ now: () => Date.parse(later) })
    const unwiredResult = await unwired.read({ asset: 'btc', asOf: cutoff })
    expect(unwiredResult).toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
    expect('value' in unwiredResult).toBe(false)

    const uncredentialed = createEtfHistoryAsOf({
      requestWindow: async () => Object.freeze({ state: 'not-configured' as const }),
      now: () => Date.parse(later)
    })
    await expect(uncredentialed.read({ asset: 'eth', asOf: cutoff }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
  })

  it('keeps the gap when the provider request is refused or fails', async () => {
    const { reader } = windowWith(['refused', 'refused'])
    const refused = await reader.read({ asset: 'btc', asOf: cutoff })
    expect(refused).toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
    expect('value' in refused).toBe(false)

    const throwing = createEtfHistoryAsOf({
      requestWindow: async () => { throw new Error('socket closed') },
      now: () => Date.parse(later)
    })
    await expect(throwing.read({ asset: 'btc', asOf: cutoff }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })

    // A failed window is not cached as an answer; a later read asks again.
    const retried = vi.fn<() => Promise<EtfHistoryApiWindow>>()
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce(Object.freeze({ state: 'unavailable' as const }))
    const retrying = createEtfHistoryAsOf({ requestWindow: retried, now: () => Date.parse(later) })
    await expect(retrying.read({ asset: 'btc', asOf: cutoff })).resolves.toMatchObject({ gapCode: 'query-unavailable' })
    await expect(retrying.read({ asset: 'btc', asOf: cutoff })).resolves.toMatchObject({ gapCode: 'query-unavailable' })
    expect(retried).toHaveBeenCalledTimes(2)

    // A partial window answers the asset that responded and reports the other as a failed request.
    const partial = createEtfHistoryAsOf({
      requestWindow: async () => Object.freeze({
        state: 'partial' as const,
        btc: [Object.freeze({ date: midnight('2026-10-29'), changeUsd: 1 })]
      }),
      now: () => Date.parse(later)
    })
    await expect(partial.read({ asset: 'eth', asOf: cutoff }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
    await expect(partial.read({ asset: 'btc', asOf: cutoff }))
      .resolves.toMatchObject({ state: 'available', value: 1, tradingDate: '2026-10-29' })
  })

  it('names the CryptoETF urls it actually asks, and no longer the retired source', () => {
    // 反向红：把来源改回旧源（0xRouter flow-history）→ 这两条立刻红。
    expect(etfHistoryAsOfPolicy.sourceUrl.btc).toBe(cryptoEtfFlowFundsUrl('btc'))
    expect(etfHistoryAsOfPolicy.sourceUrl.eth).toBe(cryptoEtfFlowFundsUrl('eth'))
    expect(etfHistoryAsOfPolicy.sourceUrl.btc).not.toContain('0xrouter')
    expect(etfHistoryAsOfPolicy.sourceUrl.eth).not.toContain('0xrouter')
    expect(etfHistoryAsOfPolicy.method).toBe('historical-api')
  })

  it('reports a cutoff outside the 30-day retention as a stated gap — never a zero, never the newest day', async () => {
    // 免费档只保留最近 30 天：更早的时间点必须「说清为什么没有」，不许拿 0 或最近一天顶上。
    const rows = ['2026-10-01', '2026-10-02', '2026-10-03'].map(day => Object.freeze({ date: midnight(day), changeUsd: 5_000_000 }))
    const reader = createEtfHistoryAsOf({
      requestWindow: async () => Object.freeze({ state: 'available' as const, btc: rows, eth: rows }),
      now: () => Date.parse(later)
    })
    const outside = await reader.read({ asset: 'btc', asOf: '2026-08-01T00:00:00.000Z' })
    expect(outside.state).toBe('unavailable')
    expect(outside.state === 'unavailable' ? outside.gapCode : undefined).toBe('historical-as-of-unavailable')
    expect(outside.state === 'unavailable' ? outside.detail : '').toContain('30 days')
    expect(JSON.stringify(outside)).not.toContain('"value"')
  })
})

describe('the retired ETF source has no read point left', () => {
  it('keeps the old 0xRouter flow-history URL out of the reader and the backfill provenance', () => {
    // 用户 2026-11-13：日报回溯改读 CryptoETF。旧源**先不删**（它自己的注册数据还在），但
    // 读取点与 provenance 里不许再出现旧地址。反向红：把 sourceUrl 改回旧源 → 这段立刻红。
    const readPathFiles = [
      'products/market-intelligence/service/intelligence/public-query/etfHistoryAsOf.ts',
      'products/market-intelligence/service/intelligence/public-query/dailyBriefBackfill.ts'
    ]
    const offenders: string[] = []
    for (const file of readPathFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')
      if (source.includes('0xrouter.app')) offenders.push(file)
    }
    expect(offenders).toHaveLength(0)
    expect(etfHistoryAsOfPolicy.sourceUrl.btc.startsWith('https://api.cryptoetf.today/')).toBe(true)
    expect(etfHistoryAsOfPolicy.sourceUrl.eth.startsWith('https://api.cryptoetf.today/')).toBe(true)
  })
})
