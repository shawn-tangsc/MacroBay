import { describe, expect, it } from 'vitest'

import { crossAssetIndexBars } from './crossAssetIndexFeed'

/**
 * The provider's real Nasdaq 100 candle shape: JSON *numbers*, an ISO UTC `openTime`, one row per bar.
 * These fixtures are the published shape, not a convenient one — a parser that only works on strings
 * would pass a made-up fixture and fail on the first real response.
 */
const at = (iso: string) => Date.parse(iso)
const row = (openTime: string, close: number, extra: Record<string, unknown> = {}) => ({
  symbolCode: 'USTEC', openTime, openPrice: close - 5, highPrice: close + 10, lowPrice: close - 10, closePrice: close, volume: 12_345,
  ...extra
})
const page = (data: unknown[]) => ({ data })
const observedAtMs = at('2026-10-14T12:00:00.000Z')

describe('cross-asset licensed index candles', () => {
  it('reads the published USTEC shape as closed bars on the five-minute grid', () => {
    const result = crossAssetIndexBars(page([
      row('2026-10-14T11:40:00.000Z', 25_240.25),
      row('2026-10-14T11:30:00.000Z', 25_234.5), // provider order is newest first
      row('2026-10-14T11:35:00.000Z', 25_238)
    ]), 200, observedAtMs)

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.bars).toEqual([
      { symbol: 'USTEC', barOpenMs: at('2026-10-14T11:30:00.000Z'), barEndMs: at('2026-10-14T11:35:00.000Z'),
        open: '25229.5', high: '25244.5', low: '25224.5', close: '25234.5', volume: '12345' },
      { symbol: 'USTEC', barOpenMs: at('2026-10-14T11:35:00.000Z'), barEndMs: at('2026-10-14T11:40:00.000Z'),
        open: '25233', high: '25248', low: '25228', close: '25238', volume: '12345' },
      { symbol: 'USTEC', barOpenMs: at('2026-10-14T11:40:00.000Z'), barEndMs: at('2026-10-14T11:45:00.000Z'),
        open: '25235.25', high: '25250.25', low: '25230.25', close: '25240.25', volume: '12345' }
    ])
    expect(result.offGrid).toBe(0)
    expect(result.forming).toBe(0)
  })

  it('refuses a bar that has not closed and never rounds an off-grid stamp onto the grid', () => {
    // 12:00 is still forming at 12:00; 11:57:30 is not a five-minute instant and must not be moved.
    const result = crossAssetIndexBars(page([
      row('2026-10-14T12:00:00.000Z', 25_250),
      row('2026-10-14T11:57:30.000Z', 25_245),
      row('2026-10-14T11:45:00.000Z', 25_241)
    ]), 200, observedAtMs)

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.forming).toBe(1)
    expect(result.offGrid).toBe(1)
    expect(result.bars.map(bar => bar.barOpenMs)).toEqual([at('2026-10-14T11:45:00.000Z')])
  })

  it('reports an index bar with no published volume as an explicit zero rather than inventing one', () => {
    const result = crossAssetIndexBars(page([row('2026-10-14T11:30:00.000Z', 25_234.5, { volume: undefined })]), 200, observedAtMs)

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.bars[0].volume).toBe('0')
  })

  it('drops a row for another symbol, a non-number price, or an impossible high/low', () => {
    const result = crossAssetIndexBars(page([
      row('2026-10-14T11:30:00.000Z', 25_234.5, { symbolCode: 'DXY' }),
      row('2026-10-14T11:35:00.000Z', 25_238, { closePrice: '25238' }),
      row('2026-10-14T11:40:00.000Z', 25_240, { highPrice: 25_230 }),
      row('2026-10-14T11:45:00.000Z', 25_241)
    ]), 200, observedAtMs)

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.bars.map(bar => bar.barOpenMs)).toEqual([at('2026-10-14T11:45:00.000Z')])
  })

  it('reports an unusable page as a failure code, never as an empty success', () => {
    expect(crossAssetIndexBars(page([]), 200, observedAtMs)).toEqual({ state: 'unavailable', failureCode: 'response-invalid' })
    expect(crossAssetIndexBars(page([row('2026-10-14T11:30:00.000Z', 25_234.5, { symbolCode: 'DXY' })]), 200, observedAtMs))
      .toEqual({ state: 'unavailable', failureCode: 'response-invalid' })
    expect(crossAssetIndexBars({ data: 'private' }, 200, observedAtMs)).toEqual({ state: 'unavailable', failureCode: 'response-invalid' })
    expect(crossAssetIndexBars(page([row('2026-10-14T11:30:00.000Z', 25_234.5)]), 401, observedAtMs))
      .toEqual({ state: 'unavailable', failureCode: 'credential-rejected' })
    expect(crossAssetIndexBars(page([row('2026-10-14T11:30:00.000Z', 25_234.5)]), 429, observedAtMs))
      .toEqual({ state: 'unavailable', failureCode: 'rate-limited' })
  })
})
