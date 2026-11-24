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
import { CHART_HEIGHT, GAUGE_CHART_HEIGHT } from './DefensivePremiumCharts'

/**
 * 仪表那一列：只回答「落在哪一档」。
 *
 * 读数里的分数在盘里（画布内容）；档位词**不再在这一列**——用户 2026-11-24 把它抬到头栏中轨
 * （卡片 `__topbar-mid`，用例在 cryptoDashboard.test 那边），这一列只剩图，所以画布能占满 168、
 * 与两侧走势图等高居中。图本身是装饰（aria-hidden）。
 * 日期、状态词、三个区间标签都不在这里——日期归恐惧贪婪格。
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
    state, titleId: 'mi-defensive-premium-fear-greed-heading',
    ...(cellOff ? { cellOff } : {})
  })))
  await act(async () => { await Promise.resolve() })
  return container.querySelector<HTMLElement>('[data-sentiment-gauge]')!
}

describe('the gauge column', () => {
  it('carries no words at all: the bucket word moved to the card’s topbar (user 2026-11-24)', async () => {
    const gauge = await render(available)
    // 档位词抬到头栏中轨之后，这一列里一个文字节点都不该剩——剩了就是又占了图位、把仪表挤小。
    expect(gauge.querySelector('[data-gauge-reading]')).toBeNull()
    expect(gauge.querySelector('[data-gauge-bucket-text]')).toBeNull()
    expect(gauge.querySelector('.mi-defensive-premium__gauge-bucket')).toBeNull()
    // 画布里只许有分数（用 `graphic` 的 text 画，某些环境渲染成空文本），不许有一句界面文案。
    expect(['', '22']).toContain(gauge.textContent)
    // 这一列也没有读数行（用户 2026-11-22 删掉整条读数行）：DOM 里不留空节点。
    expect(gauge.querySelector('.mi-defensive-premium__reading')).toBeNull()
    // 图是装饰：读屏念的是头栏那一句，不是画布。
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
      // 没有读数时整行不渲染（不是一行空字）。
      expect(gauge.querySelector('[data-gauge-reading]')).toBeNull()
    }
    // 被关掉时连旧读数也不画：档位词不出现，弧还在。
    const off = await render(available, openSources)
    expect(off.querySelector('[data-gauge-reading]')).toBeNull()
    expect(off.querySelector('[data-chart="gauge"]')).not.toBeNull()
  })

  it('announces nothing while waiting: the card allows one role=status, in the other column', async () => {
    const gauge = await render({ state: 'loading' })
    expect(gauge.querySelector('.loading-spinner')).not.toBeNull()
    expect(gauge.querySelectorAll('[role="status"]')).toHaveLength(0)
    expect(gauge.querySelector('[aria-live]')).toBeNull()
  })

  it('sits vertically centred with a full disk on the arc centre, and the score on top of it (user 2026-11-24)', () => {
    // 界面 2026-11-24：整块（弧顶→盘底）在 168 里上下各留 26，圆心 = 盘心 = 67.3%（y = 113）。
    // 盘是整圆、半径 = 弧半径 × 0.35（184 列下 82 → 29）；分数画在盘心、且在盘之上
    // （`anchor` 那版会把数字盖没，所以盘与分数都走 `graphic`）。
    // 护栏：盘底 113 + 29 = 142 不许低于两侧轴底 168 − 24 = 144。
    expect(GAUGE_CHART_HEIGHT).toBe(CHART_HEIGHT)
    // 只对真实的中列宽（184）验护栏：盘径随弧半径变，240 那种宽度已经不用了。
    for (const width of [184]) {
      const option = gaugeChartOption({ score: 22, width, height: GAUGE_CHART_HEIGHT, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
      const series = (option.series as Array<{ center: [string, string]; radius: number; pointer: { length: number }; detail: { show: boolean } }>)[0]!
      expect(series.center).toEqual(['50%', '67.3%'])
      const centerY = 0.673 * GAUGE_CHART_HEIGHT
      expect(series.radius).toBe(Math.max(24, Math.min(width / 2 - 10, GAUGE_CHART_HEIGHT - 22)))
      // 指针从盘缘 29 画到弧内缘 72。
      expect(series.pointer.length).toBe(series.radius - 10)
      // 分数不再由 detail 画（会被盘盖住）。
      expect(series.detail.show).toBe(false)
      const diskRadius = Math.round(series.radius * 0.35)
      const graphic = option.graphic as Array<Record<string, unknown>>
      const disk = graphic.find(item => item.type === 'circle') as { shape: { cx: number; cy: number; r: number } }
      const score = graphic.find(item => item.type === 'text') as { x: number; y: number; style: { text: string } }
      expect(disk.shape).toEqual({ cx: width / 2, cy: centerY, r: diskRadius })
      expect(score.x).toBe(width / 2)
      expect(score.y).toBe(centerY)
      expect(score.style.text).toBe('22')
      // 盘心与弧心同一点、盘底不入轴底线以下。
      expect(centerY + diskRadius).toBeLessThanOrEqual(GAUGE_CHART_HEIGHT - 24)
    }
    // 184 列把三个数钉住：半径 82、盘半径 29、指针 72。
    const wide = gaugeChartOption({ score: 22, width: 184, height: GAUGE_CHART_HEIGHT, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
    const wideSeries = (wide.series as Array<{ radius: number; pointer: { length: number } }>)[0]!
    const wideDisk = (wide.graphic as Array<{ type: string; shape?: { r: number } }>).find(item => item.type === 'circle')!
    expect(wideSeries.radius).toBe(82)
    expect(wideSeries.pointer.length).toBe(72)
    expect(wideDisk.shape!.r).toBe(29)
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
    // 三行一列（2026-11-23 删掉卡头、格名上到头栏）：图 168 / 说明 / 列尾留白。仪表列也用这一套，图底与另两列齐平。
    expect(styles).toContain('grid-template-rows: var(--mi-defensive-premium-chart-height) auto minmax(0, 1fr)')
    // 默认 240（用户 2026-11-22 把仪表放到中间后加的宽）；940–995 那档才退回 184。
    // 两处分开断言：只写一个 `toContain(184px)` 会被窄档那条规则满足，主档写错也不红。
    expect(styles).toContain('--mi-defensive-premium-gauge-width: 184px')
    // 184 成了所有宽度的默认，960 那一档的覆盖规则随之删掉。
    expect(styles).not.toContain('@container (min-width: 940px) and (max-width: 995px)')
  })
})