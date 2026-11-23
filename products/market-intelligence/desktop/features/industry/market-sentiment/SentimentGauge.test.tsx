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
 * 读数里的分数在盘里（画布内容），档位词是**文字**，落在整个仪表下面那一行（图位底部）；
 * 图是 ECharts 画的装饰（aria-hidden），所以档位词那一行自带读屏名「22 极度恐惧」。
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
  it('puts the bucket word under the whole gauge, with the score carried by its accessible name', async () => {
    const gauge = await render(available)
    const reading = gauge.querySelector('[data-gauge-reading]')!
    // 视觉只有档位词；分数在盘里（画布），读屏名把两段合成一句。
    expect(reading.textContent).toBe(buckets['extreme-fear'])
    expect(reading.getAttribute('aria-label')).toBe(`22 ${buckets['extreme-fear']}`)
    expect(reading.getAttribute('data-gauge-bucket-text')).toBe('extreme-fear')
    // 位置：档位词在图位里（图位带 position:relative，词按 inset-inline/bottom 绝对定位在图下方）。
    expect(reading.closest('.mi-defensive-premium__chart-slot')).not.toBeNull()
    expect(reading.parentElement?.querySelector('[data-chart="gauge"]')).not.toBeNull()
    // 这一列没有读数行（用户 2026-11-22 删掉整条读数行）：DOM 里不留空节点。
    expect(gauge.querySelector('.mi-defensive-premium__reading')).toBeNull()
    // 图是装饰：读屏念的是档位词那一行的名字，不是画布。
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

  it('keeps the arc above the bucket word: 127-high canvas, center 92%, radius formula untouched', () => {
    // 168 的图位里给档位词留 41（词高 18 + 词底距 23，词与两侧日期同一条底线），所以弧只画在上面 127 里：
    // 圆心 92% → y = 116.8，弧下沿就在这条线上、描边到约 121.8；词的盒顶在 127，中间留 5。
    // 圆心再往下压（92 → 95）锚点就会压到词上；词与弧太挤则往上抬（92 → 90）。
    expect(GAUGE_CHART_HEIGHT).toBe(CHART_HEIGHT - 41)
    for (const width of [184, 240]) {
      const option = gaugeChartOption({ score: 22, width, height: GAUGE_CHART_HEIGHT, palette: CHART_PALETTE_FIXTURE, fonts: CHART_FONTS_FALLBACK })
      const series = (option.series as Array<{ center: [string, string]; radius: number }>)[0]!
      expect(series.center).toEqual(['50%', '92%'])
      const centerY = 0.92 * GAUGE_CHART_HEIGHT
      expect(centerY + 5).toBeLessThan(GAUGE_CHART_HEIGHT)
      expect(series.radius).toBe(Math.max(24, Math.min(width / 2 - 10, GAUGE_CHART_HEIGHT - 22)))
    }
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
    expect(styles).toContain('--mi-defensive-premium-gauge-width: 240px')
    expect(styles).toContain('@container (min-width: 940px) and (max-width: 995px)')
  })
})