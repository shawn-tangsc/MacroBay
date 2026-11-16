import { describe, expect, it } from 'vitest'

import * as mergeModule from './etfSourceMerge'
import { buildEtfCurrentStateWindow } from './etfCurrentStateWindow'

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

/**
 * 2026-11-17 那次「备源一接进来就再也不写库」的判据：窗口契约的 `allowedSourceIds`
 * 认的是**窗口 id**（`'0xrouter'`），不是注册表 id（`'0xrouter-aggregate-provider'`）。
 * 一行带上注册表 id，整窗 fail-closed，而且失败被 catch 吞掉——库既不写、也不记拒绝。
 */
describe('tagging source rows with the window source id', () => {
  it('tags the aggregate provider rows with the window id, not the registry id', () => {
    const tag = (mergeModule as unknown as {
      tagEtfSourceRows?: (rows: readonly { date: number; changeUsd: number }[], sourceId: string) => readonly { date: number; changeUsd: number; source?: string }[] | undefined
    }).tagEtfSourceRows
    expect(typeof tag).toBe('function')
    const tagged = tag!([{ date: day('2026-11-13'), changeUsd: 1 }], '0xrouter-aggregate-provider')!
    expect(tagged[0]!.source).toBe('0xrouter')
  })

  it('keeps the primary rows on the id both the registry and the window contract use', () => {
    const tag = (mergeModule as unknown as {
      tagEtfSourceRows?: (rows: readonly { date: number; changeUsd: number }[], sourceId: string) => readonly { date: number; changeUsd: number; source?: string }[] | undefined
    }).tagEtfSourceRows!
    expect(tag([{ date: day('2026-11-13'), changeUsd: 1 }], 'cryptoetf-etf-flows')![0]!.source).toBe('cryptoetf-etf-flows')
  })

  it('refuses a source id it cannot project instead of writing a row the window rejects', () => {
    const tag = (mergeModule as unknown as {
      tagEtfSourceRows?: (rows: readonly { date: number; changeUsd: number }[], sourceId: string) => readonly { date: number; changeUsd: number; source?: string }[] | undefined
    }).tagEtfSourceRows!
    expect(tag([{ date: day('2026-11-13'), changeUsd: 1 }], 'unknown-provider')).toBeUndefined()
  })

  it('shows why the mapping is required: a registry-tagged row fails the whole window', () => {
    const dates = ['2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-31']
    const flows = (source: string) => dates.map((tradingDate) => ({
      asset: 'BTC', tradingDate, netFlowUsd: 1,
      observedAt: `${tradingDate}T00:00:00.000Z`, fetchedAt: '2026-08-31T12:00:00.000Z', source
    }))
    const build = (source: string) => buildEtfCurrentStateWindow({
      asOf: '2026-08-31T12:00:00.000Z',
      completeThrough: '2026-08-31',
      completeDates: dates,
      btc: flows(source) as never,
      eth: flows(source).map((flow) => ({ ...flow, asset: 'ETH' })) as never
    }).state
    expect(build('0xrouter')).toBe('available')
    expect(build('0xrouter-aggregate-provider')).toBe('unavailable')
  })
})
