// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { macroRatesSnapshotPublicPolicy } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import type { MacroRatesReading, MacroRatesSnapshotView } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import { resolveProductTextKey } from '../../../shared/i18n/productTextKey'
import { UstYieldCurveCard } from './UstYieldCurveCard'

const series = macroRatesSnapshotPublicPolicy.series
const copy = (key: string): string => resolveProductTextKey('zh-CN', key)
const t = (key: string): string => copy(`pages.intelligence.portal.dashboard.ustCurve.${key}`)

function window(count: number, valueAt: (index: number) => number, start = '2026-01-02') {
  const days: string[] = []
  const cursor = new Date(`${start}T00:00:00.000Z`)
  while (days.length < count) {
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days.map((period, index) => ({ period, value: valueAt(index) }))
}

function reading(seriesId: string, points = window(30, (index) => 4 + index / 100)): MacroRatesReading {
  const last = points[points.length - 1]!
  return {
    seriesId,
    metricKey: (macroRatesSnapshotPublicPolicy.metricKeys as Record<string, string>)[seriesId]!,
    actual: last.value,
    period: last.period,
    window: points
  }
}

type AvailableView = Extract<MacroRatesSnapshotView, { state: 'available' | 'empty' }>

function fullSnapshot(overrides: Partial<AvailableView> = {}): MacroRatesSnapshotView {
  return {
    state: 'available', asOf: '2026-11-22T00:00:00.000Z', caveats: ['official-daily-close'], spreads: [],
    readings: [
      reading(series.us3m, window(30, () => 4.3)),
      reading(series.us2y, window(30, () => 4.1)),
      reading(series.us5y, window(30, () => 4.2)),
      reading(series.us10y, window(30, (index) => 4 + index / 100)),
      reading(series.us30y, window(30, () => 4.5)),
      reading(series.real10y, window(30, () => 1.9)),
      reading(series.breakeven10y, window(30, () => 2.4))
    ],
    ...overrides
  }
}

function mount(overrides: Partial<Parameters<typeof UstYieldCurveCard>[0]> = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const element = (next: Partial<Parameters<typeof UstYieldCurveCard>[0]>) => createElement(UstYieldCurveCard, {
    snapshot: fullSnapshot(), state: 'ready' as const, resolveText: copy, timeZone: 'Asia/Shanghai',
    onRefresh: () => undefined, onEnableSource: () => undefined, ...next
  })
  act(() => root.render(element(overrides)))
  return {
    host,
    rerender: (next: Partial<Parameters<typeof UstYieldCurveCard>[0]>) => act(() => root.render(element(next))),
    unmount: () => act(() => root.unmount())
  }
}

const cells = (host: HTMLElement, selector: string) => [...host.querySelectorAll<HTMLElement>(selector)]
const text = (node: Element | null | undefined) => node?.textContent ?? ''

describe('国债收益率卡', () => {
  it('draws the nine-row table with the newest column plus four change windows', () => {
    const { host, unmount } = mount()
    const table = host.querySelector('table')
    expect(table?.getAttribute('aria-label')).toBe(t('tableAria'))

    const headers = cells(host, 'thead th').map(text)
    expect(headers).toEqual([t('colName'), t('colLatest'), t('colChange'), t('windows.d1'), t('windows.w1'), t('windows.m1'), t('windows.y1')])
    expect(cells(host, 'tbody th').map((cell) => text(cell.firstChild as Element | null))).toEqual([
      '3M', '2Y', '5Y', '10Y', '30Y', '10Y−2Y', '10Y−3M', '10Y 实际利率', '10Y 通胀补偿'
    ])

    // 变化格里只有数字与符号：没有 %、没有 bp。
    const change = cells(host, 'tbody td[data-direction]')
    expect(change.length).toBeGreaterThan(0)
    for (const cell of change) expect(text(cell)).toMatch(/^(0|[+−]\d+)$/)
    // 最新列一律中性：它不带方向属性。
    const latest = cells(host, 'tbody tr > td:nth-child(2)')
    expect(latest.length).toBe(9)
    for (const cell of latest) expect(cell.hasAttribute('data-direction')).toBe(false)
    unmount()
  })

  it('colours a change by direction and leaves zero uncoloured', () => {
    const { host, unmount } = mount()
    const directions = cells(host, 'tbody td[data-direction]').map((cell) => cell.getAttribute('data-direction'))
    expect(new Set(directions)).toEqual(new Set(['1', '0']))
    unmount()
  })

  it('says 未接入 only when the series is not admitted, and 暂时读不到 when it is admitted but absent', () => {
    const { host, unmount } = mount({
      snapshot: fullSnapshot({ readings: [reading(series.us10y)] }),
      admittedSeriesIds: [series.us10y, series.us2y]
    })
    const table = text(host.querySelector('table'))
    expect(table).toContain(t('unreadableOne'))
    expect(table).toContain(t('notConnected'))
    unmount()
  })

  it('leaves a spread empty with the reason in its accessible name', () => {
    const { host, unmount } = mount({ snapshot: fullSnapshot({ readings: [reading(series.us10y), reading(series.us2y)] }) })
    const rowFor = (name: string) => cells(host, 'tbody tr').find((row) => text(row.querySelector('th')) === name)!
    // 10Y−2Y：两条腿都在、但没有共同交易日 → 日期不一致。
    const spread2y = cells(rowFor('10Y−2Y'), 'td[aria-label]')
    expect(spread2y.length).toBe(5)
    expect(spread2y[0]?.getAttribute('aria-label')).toBe(t('dashLegsDiffer'))
    // 10Y−3M：这次没有 3M 那条腿 → 原因点名那条腿。
    const spread3m = cells(rowFor('10Y−3M'), 'td[aria-label]')
    expect(spread3m.length).toBe(5)
    expect(spread3m[0]?.getAttribute('aria-label')).toBe(t('dashLegMissing').replace('{leg}', '3M'))
    expect(text(spread3m[0])).toBe(t('dash'))
    unmount()
  })

  it('marks a row whose observation date is older, and writes the range in the footer', () => {
    const slow = reading(series.breakeven10y, window(3, () => 2.4, '2026-02-02'))
    const base = fullSnapshot() as AvailableView
    const { host, unmount } = mount({
      snapshot: fullSnapshot({ readings: base.readings.filter((entry) => entry.seriesId !== series.breakeven10y).concat([slow]) })
    })
    const body = text(host)
    expect(body).toContain(t('templates.asOf').replace('{date}', slow.period.slice(5)))
    expect(body).toContain(t('templates.footRange').replace('{from}', '').slice(0, 3))
    unmount()
  })

  it('writes a dash for a window the series is too short for, and says why in the accessible name', () => {
    const { host, unmount } = mount()
    const short = cells(host, 'tbody td[data-unavailable="true"][aria-label]')
      .filter((cell) => cell.getAttribute('aria-label') === t('dashShort'))
    expect(short.length).toBeGreaterThan(0)
    expect(text(short[0])).toBe(t('dash'))
    unmount()
  })

  it('draws five tenor lines, never the spreads or the real yield, and offers both axis readings', () => {
    const { host, unmount } = mount()
    expect(cells(host, 'path.mi-ust__line').map((path) => path.getAttribute('data-tenor')))
      .toEqual(['3m', '2y', '5y', '10y', '30y'])
    expect(host.querySelector('.mi-ust__zero')).toBeNull()

    const normalized = cells(host, '.segmented__item').find((item) => text(item) === t('mode.normalized'))
    expect(normalized).toBeTruthy()
    act(() => { normalized!.click() })
    // 归一模式必有 0 线，图的读屏名换成「起点归一」那一句。
    expect(host.querySelector('.mi-ust__zero')).not.toBeNull()
    expect(host.querySelector('svg.mi-ust__svg')?.getAttribute('aria-label')).toBe(t('ariaNormalized'))
    unmount()
  })

  it('switches the curve window without touching a single table cell', () => {
    const { host, unmount } = mount()
    const before = text(host.querySelector('tbody'))
    const week = cells(host, '.segmented__item').find((item) => text(item) === t('periods.1w'))
    act(() => { week!.click() })
    expect(text(host.querySelector('tbody'))).toBe(before)
    unmount()
  })

  it('shows the platform states: loading, unreadable with retry, disabled with enable, empty without a fake action', () => {
    const loading = mount({ state: 'loading' })
    expect(loading.host.querySelector('[aria-busy="true"]')).not.toBeNull()
    loading.unmount()

    const failed = mount({ snapshot: { state: 'unavailable' }, state: 'unavailable' })
    expect(cells(failed.host, 'button').map(text)).toContain(resolveProductTextKey('zh-CN', 'ui.state.action.retry'))
    failed.unmount()

    const disabled = mount({ sourceDisabled: true })
    expect(cells(disabled.host, 'button').map(text)).toContain(resolveProductTextKey('zh-CN', 'ui.state.action.enable'))
    disabled.unmount()

    const empty = mount({ snapshot: fullSnapshot({ state: 'empty', readings: [], spreads: [] }) })
    const emptyBlock = empty.host.querySelector('[data-state="empty"]')
    expect(emptyBlock).not.toBeNull()
    // 空态里不给假按钮（标题行的刷新与说明是卡级的，不算空态的出口）。
    expect(cells(emptyBlock as HTMLElement, 'button')).toHaveLength(0)
    empty.unmount()
  })

  it('asks the page to re-read the same snapshot from the refresh control', () => {
    const onRefresh = vi.fn()
    const { host, unmount } = mount({ onRefresh })
    const refresh = cells(host, 'button').find((button) => button.getAttribute('aria-label') === t('refresh'))
    expect(refresh).toBeTruthy()
    act(() => { refresh!.click() })
    expect(onRefresh).toHaveBeenCalledTimes(1)
    unmount()
  })
})
