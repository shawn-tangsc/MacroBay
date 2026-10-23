import { describe, expect, it } from 'vitest'

import type { CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import { parseDashboardFeedStatus, type DashboardFeedSourceId, type DashboardFeedSourceStatus, type DashboardFeedStatusView } from '../../../contracts/macro/dashboardFeedStatusContracts'
import type { MacroMarketSnapshotReading, MacroMarketSnapshotView } from '../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroRatesSnapshotView } from '../../../contracts/macro/macroRatesSnapshotContracts'
import { productText } from '../../shared/i18n/productText'
import { dashboardFeedRowText, printableFailureCode, projectDashboardFeedRows, relativeTime, type DashboardFeedInput, type DashboardFeedRow } from './dashboardFeedStatusModel'

const zh = productText['zh-CN'].pages.intelligence.portal.dashboard
const en = productText['en-US'].pages.intelligence.portal.dashboard
const asOf = '2026-09-14T12:00:00.000Z'
const asOfMs = Date.parse(asOf)

/** The row as the reader sees it, in one locale. `status` is exactly what the strip prints. */
function textOf(row: DashboardFeedRow, locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  const dashboard = productText[locale].pages.intelligence.portal.dashboard
  return dashboardFeedRowText(row, dashboard.feedStatus, {
    synthetic: dashboard.crossAsset.syntheticTag,
    proxy: dashboard.crossAsset.proxyTag,
    realIndex: dashboard.crossAsset.indexNames.real
  }, asOfMs)
}

const project = (over: Partial<DashboardFeedInput>) =>
  projectDashboardFeedRows({ macroClient: true, macroState: 'ready', indexLoading: false, ...over })

function macroSnapshot(readings: readonly MacroMarketSnapshotReading[], source: Readonly<{ enabled: boolean; hasCredential: boolean }> = { enabled: true, hasCredential: true }): MacroMarketSnapshotView {
  return { state: readings.length > 0 ? 'available' : 'empty', asOf, source, readings, caveats: [] }
}

const dxyReal = (atMs: number): MacroMarketSnapshotReading => ({ seriesId: 'dxy-real', level: 98.21, atMs, returns: {} })
const dxySynthetic = (atMs: number): MacroMarketSnapshotReading => ({ seriesId: 'dxy-synthetic', level: 101.42, atMs, returns: {}, synthetic: true })
const goldReading = (atMs: number): MacroMarketSnapshotReading => ({ seriesId: 'xau-usd', level: 3413.9, atMs, returns: {} })

const ratesSnapshot = (readings: Readonly<{ seriesId: string; actual: number; period: string }>[]): MacroRatesSnapshotView =>
  ({ state: readings.length > 0 ? 'available' : 'empty', asOf, readings: readings.map(reading => ({ ...reading, metricKey: 'US_10Y_YIELD' })), caveats: [] })

/** Only the three fields these rows read; the chart's curves and correlations are not this model's business. */
const indexSnapshot = (indexSource: 'real' | 'proxy' | 'unavailable', over: Readonly<{ sourceState?: string; lastClosedAt?: string }> = {}): CrossAssetSnapshot =>
  ({
    indexSource,
    ...(over.sourceState ? { sourceState: over.sourceState } : {}),
    ...(over.lastClosedAt ? { lastClosed: { index: { at: over.lastClosedAt, close: 23_100 } } } : {})
  }) as unknown as CrossAssetSnapshot

const feedSource = (sourceId: DashboardFeedSourceId, over: Partial<DashboardFeedSourceStatus> = {}): DashboardFeedSourceStatus =>
  ({ sourceId, enabled: true, hasCredential: true, ...over })
const feedFor = (sources: readonly DashboardFeedSourceStatus[]): DashboardFeedStatusView => ({ state: 'available', sources })

const rowOf = (rows: readonly DashboardFeedRow[], id: DashboardFeedRow['id']): DashboardFeedRow => rows.find(row => row.id === id)!

describe('dashboard feed rows', () => {
  it('gives every feed that feeds the board its own row, in reading order', () => {
    const rows = project({
      macro: macroSnapshot([dxySynthetic(asOfMs), goldReading(asOfMs)]),
      rates: ratesSnapshot([{ seriesId: 'DGS10', actual: 4.12, period: '2026-09-12' }]),
      index: indexSnapshot('proxy')
    })
    expect(rows.map(row => row.id)).toEqual(['dollar', 'gold', 'rates', 'index'])
    // One row per feed, each naming the source its reason came from and the source it can configure.
    expect(rows.map(row => textOf(row).sourceId)).toEqual([
      'realmarketapi-market', 'twelve-data-market', 'fred-rates-liquidity', 'binance-futures-positioning'
    ])
    expect(rows.map(row => row.manageSourceId)).toEqual([
      'realmarketapi-market', 'twelve-data-market', 'fred-rates-liquidity', 'realmarketapi-market'
    ])
    for (const row of rows) expect(textOf(row).name.length).toBeGreaterThan(0)
  })

  it('says 未配置 and states what is being used instead, in both locales', () => {
    const rows = project({ macro: macroSnapshot([dxySynthetic(asOfMs)]), feed: feedFor([feedSource('realmarketapi-market', { hasCredential: false })]) })
    const dollar = rowOf(rows, 'dollar')
    expect(dollar.state).toBe('unconfigured')
    expect(dollar.fallback).toBe('synthetic')
    const zhText = textOf(dollar)
    expect(zhText.status).toContain(zh.feedStatus.states.unconfigured)
    expect(zhText.status).toContain('合成值')
    expect(zhText.status).toContain('RealMarketAPI')
    // The reason already carries the state word, so the row does not print it twice.
    expect(zhText.status.startsWith(zh.feedStatus.states.unconfigured)).toBe(true)
    expect(zhText.status).not.toContain(`${zh.feedStatus.states.unconfigured} · ${zh.feedStatus.states.unconfigured}`)
    const enText = textOf(dollar, 'en-US')
    expect(enText.status).toContain(en.feedStatus.states.unconfigured)
    expect(enText.status).toContain(`${en.crossAsset.syntheticTag} value`)
    // The honesty rule: an unconfigured real source is never reported as a working one.
    expect(zhText.status).not.toContain(zh.feedStatus.states.ok)
  })

  it('separates 已配置未启用 from 未配置', () => {
    const rows = project({
      macro: macroSnapshot([dxySynthetic(asOfMs)]),
      feed: feedFor([feedSource('realmarketapi-market', { enabled: false, hasCredential: true })])
    })
    expect(rowOf(rows, 'dollar').state).toBe('configured-disabled')
    expect(textOf(rowOf(rows, 'dollar')).status).toContain('已配置未启用')
  })

  it('prints the last collection time when the real feed is the one answering', () => {
    const rows = project({ macro: macroSnapshot([dxyReal(asOfMs - 5 * 60_000)]) })
    const dollar = rowOf(rows, 'dollar')
    expect(dollar.state).toBe('ok')
    expect(dollar.fallback).toBeUndefined()
    expect(textOf(dollar).status).toBe(`${zh.feedStatus.states.ok} · ${zh.feedStatus.detail.recent.replace('{time}', '5 分钟前')}`)
    expect(textOf(dollar, 'en-US').status).toContain('5 min ago')
  })

  /** The state most easily lost: the real point is stale, so the synthesis answers. It is never 正常. */
  it('states an aged-out real dollar as 已回退 and keeps the panel\'s own 合成 wording', () => {
    const rows = project({
      macro: macroSnapshot([dxyReal(asOfMs - 30 * 60_000), dxySynthetic(asOfMs)]),
      feed: feedFor([feedSource('realmarketapi-market')])
    })
    const dollar = rowOf(rows, 'dollar')
    expect(dollar.state).toBe('stale-fallback')
    expect(dollar.fallback).toBe('synthetic')
    expect(dollar.staleMinutes).toBe(30)
    const status = textOf(dollar).status
    expect(status).toContain('已回退')
    expect(status).toContain('30 分钟')
    // The word the strip uses is the tag the 市场状态 row prints beside the same level.
    expect(status).toContain(`${zh.crossAsset.syntheticTag}值`)
    expect(status).not.toContain(zh.feedStatus.states.ok)
    expect(textOf(dollar, 'en-US').status).toContain(`${en.crossAsset.syntheticTag} value`)
  })

  /** 真实那条在行上，不代表来源是好的：源失败/被关掉时仍然要说出来（读者 2026-10-17 的周末口径）。 */
  it('still names the source failure while the licensed index is the one on the row', () => {
    const rows = project({
      macro: macroSnapshot([dxyReal(asOfMs - 30 * 60_000)]),
      feed: feedFor([feedSource('realmarketapi-market', { failureCode: 'credential-rejected' })])
    })
    const dollar = rowOf(rows, 'dollar')
    expect(dollar.state).toBe('failed')
    expect(textOf(dollar).status).toContain('采集失败')
    expect(textOf(dollar).status).not.toContain(zh.feedStatus.states.ok)
  })

  it('prints the licensed index\u2019s last collection time when the source is healthy but the market is closed', () => {
    // 周末：真实那条的最后一根是周五 20:55，来源本身一切正常 —— 「采集正常 · 最近 …」，不换仪器。
    const rows = project({
      macro: macroSnapshot([dxyReal(asOfMs - 6 * 60 * 60_000)]),
      feed: feedFor([feedSource('realmarketapi-market')])
    })
    const dollar = rowOf(rows, 'dollar')
    expect(dollar.state).toBe('ok')
    expect(dollar.fallback).toBeUndefined()
    expect(textOf(dollar).status).toContain('6 小时前')
  })

  it('names the failure code and carries no key or URL into the printed line', () => {
    const rows = project({
      macro: macroSnapshot([dxySynthetic(asOfMs)]),
      feed: feedFor([feedSource('realmarketapi-market', { failureCode: 'credential-rejected' })])
    })
    const dollar = rowOf(rows, 'dollar')
    expect(dollar.state).toBe('failed')
    expect(textOf(dollar).status).toContain('credential-rejected')
    expect(textOf(dollar).status).toContain('合成值')
  })

  /** The second lock: even a row handed straight to the model prints a code and nothing else. */
  it('keeps a failure code printable, dropping anything URL-shaped or credential-shaped', () => {
    expect(printableFailureCode('credential-rejected')).toBe('credential-rejected')
    expect(printableFailureCode('Credential Rejected')).toBe('Credential-Rejected')
    expect(printableFailureCode('https://api.realmarketapi.com/price?apikey=SECRET0123456789')).toBe('unreadable')
    expect(printableFailureCode('apikey=SECRET0123456789')).toBe('unreadable')
    expect(printableFailureCode('https://a.example.com/x rate-limit')).toBe('rate-limit')
    expect(printableFailureCode('   ')).toBe('unreadable')
    for (const code of ['https://a.example.com/x?key=SECRET', 'apikey=SECRET', 'www.example.com/price']) {
      const printed = printableFailureCode(code)
      for (const fragment of ['http', 'www.', '=', 'apikey', 'SECRET']) expect(printed).not.toContain(fragment)
    }
  })

  it('falls back to the unreadable-status line when the boundary refuses the source\'s own notes', () => {
    // A store that holds a URL or a key where a code belongs fails the boundary outright, so the row
    // says it fell back and cannot name the reason — it never repeats the material.
    const refused = parseDashboardFeedStatus({
      state: 'available',
      sources: [feedSource('realmarketapi-market', { failureCode: 'https://api.realmarketapi.com/price?apikey=SECRET0123456789' as never })]
    })
    expect(refused).toBeUndefined()
    const dollar = rowOf(project({ macro: macroSnapshot([dxySynthetic(asOfMs)]) }), 'dollar')
    expect(dollar.state).toBe('stale-fallback')
    const status = textOf(dollar).status
    expect(status).toContain('合成值')
    for (const fragment of ['http', 'apikey', 'SECRET', 'realmarketapi.com']) expect(status).not.toContain(fragment)
  })

  it('reads the index row from the leg that is actually answering', () => {
    const proxy = rowOf(project({ index: indexSnapshot('proxy') }), 'index')
    expect(proxy.state).toBe('proxy')
    expect(textOf(proxy).status).toContain(`${zh.crossAsset.proxyTag}值`)
    expect(textOf(proxy).status).toContain('QQQUSDT')

    const real = rowOf(project({ index: indexSnapshot('real', { lastClosedAt: new Date(asOfMs - 90 * 60_000).toISOString() }) }), 'index')
    expect(real.state).toBe('ok')
    expect(textOf(real).status).toContain(zh.crossAsset.indexNames.real)
    expect(textOf(real).status).toContain('1 小时前')

    expect(rowOf(project({ index: indexSnapshot('unavailable') }), 'index').state).toBe('unavailable')
    expect(rowOf(project({ index: indexSnapshot('unavailable', { sourceState: 'disabled' }) }), 'index').state).toBe('configured-disabled')
  })

  it('prints a daily FRED close as its observation date, never as "now"', () => {
    const reading = rowOf(project({ rates: ratesSnapshot([{ seriesId: 'DGS10', actual: 4.12, period: '2026-09-12' }]) }), 'rates')
    expect(reading.state).toBe('ok')
    expect(textOf(reading).status).toBe(`${zh.feedStatus.states.ok} · ${zh.feedStatus.detail.asOf.replace('{date}', '2026-09-12')}`)
  })

  it('names the gold source\'s own state when gold has no point yet', () => {
    const cases = [
      [macroSnapshot([], { enabled: true, hasCredential: false }), 'unconfigured'],
      [macroSnapshot([], { enabled: false, hasCredential: true }), 'configured-disabled'],
      [macroSnapshot([], { enabled: true, hasCredential: true }), 'awaiting-collection']
    ] as const
    for (const [macro, expected] of cases) {
      const row = rowOf(project({ macro }), 'gold')
      expect(row.state).toBe(expected)
      expect(textOf(row).status).toContain(zh.feedStatus.states[expected])
    }
    const loaded = rowOf(project({ macro: macroSnapshot([goldReading(asOfMs - 60_000)]) }), 'gold')
    expect(loaded.state).toBe('ok')
    expect(textOf(loaded).status).toContain('1 分钟前')
  })

  it('ages a point in the reader\'s own units', () => {
    const text = zh.feedStatus
    expect(relativeTime(asOfMs, text, asOfMs)).toBe(text.relative.justNow)
    expect(relativeTime(asOfMs - 5 * 60_000, text, asOfMs)).toBe('5 分钟前')
    expect(relativeTime(asOfMs - 3 * 3_600_000, text, asOfMs)).toBe('3 小时前')
    expect(relativeTime(asOfMs - 2 * 86_400_000, text, asOfMs)).toBe('2 天前')
    expect(relativeTime(undefined, text, asOfMs)).toBeUndefined()
    expect(relativeTime(Number.NaN, text, asOfMs)).toBeUndefined()
  })
})
