import { describe, expect, it } from 'vitest'

import { parseStablecoinCapitalSnapshot, parseStablecoinDailyHistory } from './stablecoinCapitalParser'

describe('parseStablecoinCapitalSnapshot', () => {
  it('derives the core USDT and USDC current, one-day, seven-day, and thirty-day values from one response', () => {
    expect(parseStablecoinCapitalSnapshot(validPayload())).toEqual({
      state: 'available',
      snapshot: {
        coreCurrentUsd: 310,
        change1dUsd: 10,
        change1dPercent: 10 / 300 * 100,
        change7dUsd: 10,
        change7dPercent: 10 / 300 * 100,
        change30dUsd: 30,
        change30dPercent: 30 / 280 * 100,
        usdStablecoinSupplyUsd: 315
      }
    })
  })

  it.each([
    ['missing core entry', { peggedAssets: [usdt()] }],
    ['duplicate core entry', { peggedAssets: [usdt(), usdt(), usdc()] }],
    ['conflicting duplicate core identity', { peggedAssets: [usdt(), usdt({ symbol: 'USDTX' }), usdc()] }],
    ['symbol drift', { peggedAssets: [usdt({ symbol: 'USDTX' }), usdc()] }],
    ['peg type drift', { peggedAssets: [usdt({ pegType: 'peggedEUR' }), usdc()] }],
    ['peg mechanism drift', { peggedAssets: [usdt({ pegMechanism: 'crypto-backed' }), usdc()] }],
    ['negative comparison value', { peggedAssets: [usdt({ circulatingPrevWeek: { peggedUSD: -1 } }), usdc()] }],
    ['zero weekly comparison basis', { peggedAssets: [usdt({ circulatingPrevWeek: { peggedUSD: 0 } }), usdc({ circulatingPrevWeek: { peggedUSD: 0 } })] }]
  ])('rejects the complete core group on %s', (_label, payload) => {
    expect(parseStablecoinCapitalSnapshot(payload)).toEqual({ state: 'unavailable', failureCode: 'core-stablecoin-invalid' })
  })

  it('does not allow optional non-core USD background entries to invalidate a verified core group', () => {
    const payload = validPayload()
    payload.peggedAssets.push({
      id: '999',
      symbol: 'BACKGROUND',
      pegType: 'peggedUSD',
      pegMechanism: 'crypto-backed',
      circulating: { peggedUSD: Number.NaN }
    })

    expect(parseStablecoinCapitalSnapshot(payload)).toMatchObject({
      state: 'available',
      snapshot: { coreCurrentUsd: 310, usdStablecoinSupplyUsd: 315 }
    })
  })

  it('keeps the latest thirty completed official daily stablecoin flow rows without retaining source rows', () => {
    const result = parseStablecoinDailyHistory(historyPayload(31), '2026-08-31T12:00:00.000Z')

    expect(result).toHaveLength(30)
    expect(result?.[0]).toEqual({ tradingDate: '2026-07-31', netFlowUsd: 1 })
    expect(result?.at(-1)).toEqual({ tradingDate: '2026-08-29', netFlowUsd: 1 })
    expect(JSON.stringify(result)).not.toMatch(/totalCirculating|peggedUSD|source/i)
  })

  it('projects official daily history rows with additional source-only fields', () => {
    const payload = historyPayload(5).map((row) => ({
      ...row,
      totalUnreleased: { peggedUSD: 1 },
      totalMintedUSD: { peggedUSD: 0 }
    }))

    expect(parseStablecoinDailyHistory(payload, '2026-08-31T12:00:00.000Z')).toEqual([
      { tradingDate: '2026-07-30', netFlowUsd: 0 },
      { tradingDate: '2026-07-31', netFlowUsd: 1 },
      { tradingDate: '2026-08-01', netFlowUsd: 1 },
      { tradingDate: '2026-08-02', netFlowUsd: 1 },
      { tradingDate: '2026-08-03', netFlowUsd: 1 }
    ])
  })

  it('uses an explicit zero flow when the selected window has no preceding total', () => {
    const result = parseStablecoinDailyHistory(historyPayload(5), '2026-08-31T12:00:00.000Z')

    expect(result?.[0]).toEqual({ tradingDate: '2026-07-30', netFlowUsd: 0 })
    expect(result?.slice(1)).toEqual([
      { tradingDate: '2026-07-31', netFlowUsd: 1 },
      { tradingDate: '2026-08-01', netFlowUsd: 1 },
      { tradingDate: '2026-08-02', netFlowUsd: 1 },
      { tradingDate: '2026-08-03', netFlowUsd: 1 }
    ])
  })

  it.each([
    ['missing day', historyPayload(30).filter((_, index) => index !== 10)],
    ['duplicate day', [...historyPayload(30), historyPayload(30)[29]]],
    ['future day', [...historyPayload(30), historyRow('2026-09-01', 999)]],
    ['too few complete days', historyPayload(4)],
    ['invalid official USD total', [{ date: '1787875200', totalCirculatingUSD: { peggedUSD: 'invalid' } }]]
  ])('fails closed for %s daily history', (_label, payload) => {
    expect(parseStablecoinDailyHistory(payload, '2026-08-31T12:00:00.000Z')).toBeUndefined()
  })
})

function historyPayload(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.parse('2026-07-30T00:00:00.000Z') + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
    return historyRow(date, 100 + index)
  })
}

function historyRow(tradingDate: string, total: number) {
  return {
    date: String(Date.parse(`${tradingDate}T00:00:00.000Z`) / 1_000),
    totalCirculating: { peggedUSD: total },
    totalCirculatingUSD: { peggedUSD: total }
  }
}

function validPayload() {
  return {
    peggedAssets: [
      usdt(),
      usdc(),
      {
        id: '3',
        symbol: 'USDE',
        pegType: 'peggedUSD',
        pegMechanism: 'crypto-backed',
        circulating: { peggedUSD: 5 }
      }
    ]
  }
}

function usdt(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    symbol: 'USDT',
    pegType: 'peggedUSD',
    pegMechanism: 'fiat-backed',
    circulating: { peggedUSD: 200 },
    circulatingPrevDay: { peggedUSD: 190 },
    circulatingPrevWeek: { peggedUSD: 190 },
    circulatingPrevMonth: { peggedUSD: 180 },
    ...overrides
  }
}

function usdc(overrides: Record<string, unknown> = {}) {
  return {
    id: '2',
    symbol: 'USDC',
    pegType: 'peggedUSD',
    pegMechanism: 'fiat-backed',
    circulating: { peggedUSD: 110 },
    circulatingPrevDay: { peggedUSD: 110 },
    circulatingPrevWeek: { peggedUSD: 110 },
    circulatingPrevMonth: { peggedUSD: 100 },
    ...overrides
  }
}
