import { describe, expect, it } from 'vitest'

import { mergeEtfAssetDays } from './etfSourceMerge'

const day = (iso: string): number => Date.parse(`${iso}T00:00:00.000Z`)
const row = (iso: string, changeUsd: number, source: string) => ({ date: day(iso), changeUsd, source })

describe('merging the primary and standby ETF flow rows', () => {
  it('keeps the old row when both sources agree, so nothing churns', () => {
    const standby = [row('2026-11-12', -284_200_000, '0xrouter'), row('2026-11-13', 2_300_000, '0xrouter')]
    const primary = [row('2026-11-12', -284_200_000, 'cryptoetf-etf-flows'), row('2026-11-13', 2_300_000, 'cryptoetf-etf-flows')]
    const merged = mergeEtfAssetDays(primary, standby)!
    // 值相同 → 保留旧行：来源仍是备源，日期与顺序不动。
    expect(merged.map((entry) => [new Date(entry.date).toISOString().slice(0, 10), entry.source]))
      .toEqual([['2026-11-12', '0xrouter'], ['2026-11-13', '0xrouter']])
  })

  it('lets the primary override only the days whose value changed', () => {
    const standby = [row('2026-11-12', -284_200_000, '0xrouter'), row('2026-11-13', 2_300_000, '0xrouter')]
    const primary = [row('2026-11-13', 9_000_000, 'cryptoetf-etf-flows')]
    const merged = mergeEtfAssetDays(primary, standby)!
    expect(merged.map((entry) => [new Date(entry.date).toISOString().slice(0, 10), entry.changeUsd, entry.source]))
      .toEqual([['2026-11-12', -284_200_000, '0xrouter'], ['2026-11-13', 9_000_000, 'cryptoetf-etf-flows']])
  })

  it('fills the days only the standby has, and keeps the days only the primary has', () => {
    const standby = [row('2026-11-10', -1, '0xrouter'), row('2026-11-11', -2, '0xrouter')]
    const primary = [row('2026-11-13', 3, 'cryptoetf-etf-flows')]
    const merged = mergeEtfAssetDays(primary, standby)!
    expect(merged.map((entry) => new Date(entry.date).toISOString().slice(0, 10)))
      .toEqual(['2026-11-10', '2026-11-11', '2026-11-13'])
  })

  it('returns undefined when neither side has a row', () => {
    expect(mergeEtfAssetDays(undefined, undefined)).toBeUndefined()
  })
})
