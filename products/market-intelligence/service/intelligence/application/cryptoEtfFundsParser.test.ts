import { describe, expect, it } from 'vitest'

import { parseCryptoEtfFundsResponse } from './cryptoEtfFundsParser'

function fund(ticker: string, netFlowUsdM: number) {
  return { ticker, issuer: 'Issuer', netFlowUsdM }
}

function day(date: string, totalUsdM: number, funds: readonly unknown[]) {
  return { date, totalUsdM, funds }
}

function payload(days: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    symbol: 'BTC',
    asset: 'bitcoin',
    windowDays: 30,
    days,
    updatedAt: '2026-11-12T20:14:24.534Z',
    ...overrides
  })
}

describe('parseCryptoEtfFundsResponse', () => {
  it('keeps only weekdays that carry per-fund detail and converts millions to integer USD', () => {
    const parsed = parseCryptoEtfFundsResponse(payload([
      day('2026-10-15', 175.7, [fund('IBIT', 65.9), fund('FBTC', 109.8)]),
      day('2026-10-16', -82.4, [fund('IBIT', -82.4)]),
      // 周末即使带了基金明细也不是交易日
      day('2026-10-17', 0, [fund('IBIT', 0)]),
      day('2026-10-18', 0, []),
      // 逐基金为空 = 未定稿/占位，绝不能变成 0
      day('2026-10-19', 0, []),
      // 已定稿、合计正好是 0、但有基金非零（进出抵消）= 真的是 0
      day('2026-10-20', 0, [fund('IBIT', 50), fund('FBTC', -50)])
    ]), 'btc')

    expect(parsed.state).toBe('available')
    if (parsed.state !== 'available') return
    expect(parsed.days.map((row) => row.tradingDate)).toEqual(['2026-10-15', '2026-10-16', '2026-10-20'])
    expect(parsed.days.map((row) => row.netFlowUsd)).toEqual([175_700_000, -82_400_000, 0])
    expect(parsed.audit).toMatchObject({
      symbol: 'BTC', windowDays: 30, rows: 6, settledRows: 3,
      droppedWeekendRows: 2, droppedRowsWithoutFunds: 1, droppedUndecidableZeroRows: 0, fundSumMismatches: 0,
      latestTradingDate: '2026-10-20'
    })
  })

  it('drops a zero total whose funds are all zero: a holiday and a real zero are indistinguishable', () => {
    const parsed = parseCryptoEtfFundsResponse(payload([
      day('2026-09-07', 0, [fund('IBIT', 0), fund('FBTC', 0)]),
      day('2026-09-08', -29.5, [fund('IBIT', -29.5)])
    ]), 'btc')

    expect(parsed.state).toBe('available')
    if (parsed.state !== 'available') return
    expect(parsed.days.map((row) => row.tradingDate)).toEqual(['2026-09-08'])
    expect(parsed.audit.droppedUndecidableZeroRows).toBe(1)
  })

  it('uses totalUsdM as the reading and only counts a per-fund mismatch', () => {
    const parsed = parseCryptoEtfFundsResponse(payload([
      day('2026-11-09', -201.1, [fund('IBIT', -201.0)]),
      day('2026-11-10', 100, [fund('IBIT', 60), fund('FBTC', 30)])
    ]), 'btc')

    expect(parsed.state).toBe('available')
    if (parsed.state !== 'available') return
    expect(parsed.days.map((row) => row.netFlowUsd)).toEqual([-201_100_000, 100_000_000])
    expect(parsed.audit.fundSumMismatches).toBe(1)
  })

  it('rejects a response whose symbol does not match the requested asset', () => {
    const parsed = parseCryptoEtfFundsResponse(payload([day('2026-11-10', 1, [fund('IBIT', 1)])], { symbol: 'ETH', asset: 'ethereum' }), 'btc')
    expect(parsed).toEqual({ state: 'unavailable', reason: 'response-shape-invalid' })
  })

  it('rejects a duplicate trading date instead of picking one revision', () => {
    const parsed = parseCryptoEtfFundsResponse(payload([
      day('2026-11-10', 1, [fund('IBIT', 1)]),
      day('2026-11-10', 2, [fund('IBIT', 2)])
    ]), 'btc')
    expect(parsed).toEqual({ state: 'unavailable', reason: 'response-shape-invalid' })
  })

  it('rejects unknown fields, malformed fund rows and non-canonical dates', () => {
    expect(parseCryptoEtfFundsResponse(payload([day('2026-11-10', 1, [fund('IBIT', 1)])], { extra: true }), 'btc').state).toBe('unavailable')
    expect(parseCryptoEtfFundsResponse(payload([{ date: '2026-11-10', totalUsdM: 1, funds: [{ ticker: 'IBIT' }] }]), 'btc').state).toBe('unavailable')
    expect(parseCryptoEtfFundsResponse(payload([day('2026-02-30', 1, [fund('IBIT', 1)])]), 'btc').state).toBe('unavailable')
  })

  it('reports no-settled-rows when every row is a placeholder or a weekend', () => {
    const parsed = parseCryptoEtfFundsResponse(payload([
      day('2026-11-07', 0, []),
      day('2026-11-08', 0, []),
      day('2026-11-09', 0, [])
    ]), 'btc')
    expect(parsed).toEqual({ state: 'unavailable', reason: 'no-settled-rows' })
  })

  it('returns response-shape-invalid for a body that is not JSON at all', () => {
    expect(parseCryptoEtfFundsResponse('<html>404</html>', 'btc')).toEqual({ state: 'unavailable', reason: 'response-shape-invalid' })
  })
})
