// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import type { DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'
import { SentimentGauge } from './SentimentGauge'
import { CHART_PALETTE_FIXTURE } from './defensivePremiumChartPalette.fixture'
import { CHART_FONTS_FALLBACK, gaugeChartOption } from './defensivePremiumChartOptions'
import { CHART_HEIGHT } from './DefensivePremiumCharts'

/**
 * 仪表那一列：只回答「落在哪一档」。
 *
 * 读数（分数 + 档位词）是**文字**，出现在这一列的读数行上；图是 ECharts 画的装饰（aria-hidden），
 * 日期、状态词、三个区间标签都不在这里——日期与状态词归恐惧贪婪格的读数行。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard
const buckets = text.fearGreed.buckets
const observedAt = '2026-08-04T10:00:00.000Z'
const available: DashboardFearGreedState = { state: 'available', score: 22, bucket: 'extreme-fear', observedAt }
const openSources = { sourceLabel: '恐惧与贪婪', onOpenSources: () => undefined }
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function render(state: DashboardFearGreedState, cellOff?: typeof openSources): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(createElement(SentimentGauge, {
    state, buckets, titleId: 'mi-defensive-premium-fear-greed-heading',
    ...(cellOff ? { cellOff } : {})
  })))
  await act(async () => { await Promise.resolve() })
  return container.querySelector<HTMLElement>('[data-sentiment-gauge]')!
}

describe('the gauge column', () => {
  it('shows the score and the bucket word as text, with the chart as decoration', async () => {
    const gauge = await render(available)
    expect(gauge.querySelector('[data-gauge-reading]')?.textContent).toBe('22极度恐惧')
    expect(gauge.querySelector('[data-gauge-bucket-text]')?.getAttribute('data-gauge-bucket-text')).toBe('extreme-fear')
    // 图是装饰：读屏念的是上面那行文字，不是画布。
    const chart = gauge.querySelector('[data-chart="gauge"]')!
    expect(chart.getAttribute('aria-hidden')).toBe('true')
    expect(chart.hasAttribute('role')).toBe(false)
    expect(chart.querySelector('svg')).not.toBeNull()
  })

  it('keeps the column free of dates, band markers and controls', async () => {
    const states: DashboardFearGreedState[] = [
      available,
      { state: 'stale', score: 40, bucket: 'neutral', observedAt },
      { state: 'loading' }, { state: 'empty' }, { state: 'unavailable' }
    ]
    for (const state of states) {
      for (const cellOff of [undefined, openSources]) {
        const gauge = await render(state, cellOff)
        expect(gauge.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/)
        expect(gauge.textContent).not.toContain(text.sentiment.observedAt)
        expect(gauge.querySelector('button')).toBeNull()
        expect(gauge.querySelector('[data-sentiment-state]')).toBeNull()
      }
    }
  })

  it('draws the arcs in every state and drops the reading when the cell is switched off (AC-15)', async () => {
    for (const state of [{ state: 'empty' } as const, { state: 'unavailable' } as const, { state: 'loading' } as const]) {
      const gauge = await render(state)
      // 弧照画（图一直在），但没有读数。
      expect(gauge.querySelector('[data-chart="gauge"]')).not.toBeNull()
      expect(gauge.querySelector('[data-gauge-reading]')?.textContent).toBe('')
    }
    // 被关掉时连旧读数也不画：分数与档位词都不出现，弧还在。
    const off = await render(available, openSources)
    expect(off.querySelector('[data-gauge-reading]')?.textContent).toBe('')
    expect(off.querySelector('[data-chart="gauge"]')).not.toBeNull()
  })

  it('announces nothing while waiting: the card allows one role=status, in the other column', async () => {
    const gauge = await render({ state: 'loading' })
    expect(gauge.querySelector('.loading-spinner')).not.toBeNull()
    expect(gauge.querySelectorAll('[role="status"]')).toHaveLength(0)
    expect(gauge.querySelector('[aria-live]')).toBeNull()
  })

  it('gives the needle a value only when there is a score', () => {
    const size = { width: 184, height: CHART_HEIGHT }
    const withScore = gaugeChartOption({ score: 22, ...size, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    const series = (withScore.series as Array<{ pointer: { show: boolean }; detail: { show: boolean }; data: Array<{ value: number }> }>)[0]!
    expect(series.pointer.show).toBe(true)
    expect(series.data[0]!.value).toBe(22)
    const without = gaugeChartOption({ score: undefined, ...size, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    expect((without.series as Array<{ pointer: { show: boolean } }>)[0]!.pointer.show).toBe(false)
  })

  it('is the card’s middle column: no width of its own, rows come from the shared template', () => {
    const styles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'), 'utf8')
    // 列宽由卡的三列网格给（一个变量），这一列不自己定宽；行模板三列共用。
    // 五行一列：标题 20（h3 实际行高）/ 读数 / 说明 / 留白 / 图。仪表列也用这一套，图底与另两列齐平。
    expect(styles).toContain('grid-template-rows: 20px 24px auto minmax(0, 1fr) calc(var(--mi-defensive-premium-chart-height) + 10px)')
    // 默认 240（用户 2026-11-22 把仪表放到中间后加的宽）；940–995 那档才退回 184。
    // 两处分开断言：只写一个 `toContain(184px)` 会被窄档那条规则满足，主档写错也不红。
    expect(styles).toContain('--mi-defensive-premium-gauge-width: 240px')
    expect(styles).toContain('@container (min-width: 940px) and (max-width: 995px)')
  })
})