// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import type { DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'
import { SentimentGauge } from './SentimentGauge'

/**
 * 仪表那一列（定稿 §4.4）：只回答「落在哪一档」。
 *
 * 三种「没有读数」——读不到、确实没有、被读者关掉——都照画弧与刻度，只是不画指针、圆盘与档位词；
 * 日期、状态词、三个区间标签都**不在这里**（日期与状态词归恐惧贪婪格的读数行）。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard
const buckets = text.fearGreed.buckets
const observedAt = '2026-08-04T10:00:00.000Z'
const available: DashboardFearGreedState = { state: 'available', score: 22, bucket: 'extreme-fear', observedAt }
const openSources = { sourceLabel: '恐惧与贪婪', onOpenSources: () => undefined }

function markup(state: DashboardFearGreedState, cellOff?: typeof openSources): string {
  return renderToStaticMarkup(createElement(SentimentGauge, {
    state, buckets, titleId: 'mi-defensive-premium-fear-greed-heading',
    ...(cellOff ? { cellOff } : {})
  }))
}

describe('the gauge column', () => {
  it('keeps the arc and the five ticks in every state, and never an inline control', () => {
    const states: DashboardFearGreedState[] = [available, { state: 'stale', score: 40, bucket: 'neutral', observedAt }, { state: 'loading' }, { state: 'empty' }, { state: 'unavailable' }]
    for (const state of states) {
      for (const shown of [markup(state), markup(state, openSources)]) {
        expect(shown.split('data-gauge-segment=').length - 1).toBe(5)
        expect(shown.split('class="mi-crypto-dashboard__gauge-tick"').length - 1).toBe(5)
        // 动作统一在卡标题行（AC-31）：这一列一颗按钮都没有，也不自绘遮罩。
        expect(shown).not.toContain('<button')
        expect(shown).not.toContain('mi-source-veil')
        expect(shown).not.toContain('state-view')
      }
    }
  })

  it('draws the needle, the readout and the bucket word only when there is a reading', () => {
    const readable = markup(available)
    expect(readable).toContain('mi-crypto-dashboard__gauge-needle')
    expect(readable).toContain('mi-crypto-dashboard__gauge-readout')
    expect(readable).toContain('<strong>22</strong>')
    expect(readable).toContain(`data-gauge-bucket-text="extreme-fear"`)
    expect(readable).toContain(buckets['extreme-fear'])

    // 读不到 / 空 / 还在读：弧与刻度在，指针、圆盘、分数、档位词都不在。
    for (const state of [{ state: 'empty' as const }, { state: 'unavailable' as const }, { state: 'loading' as const }]) {
      const shown = markup(state)
      expect(shown).not.toContain('mi-crypto-dashboard__gauge-needle')
      expect(shown).not.toContain('mi-crypto-dashboard__gauge-readout')
      expect(shown).not.toContain('<strong>')
      expect(shown).not.toContain('data-gauge-bucket-text="extreme-fear"')
    }
  })

  it('drops the reading when the cell is switched off, whatever the numbers say (AC-15)', () => {
    const shown = markup(available, openSources)
    expect(shown).not.toContain('mi-crypto-dashboard__gauge-needle')
    expect(shown).not.toContain('<strong>22</strong>')
    expect(shown).not.toContain(buckets['extreme-fear'])
    // 弧与刻度照画：关掉一格不是把整张图撕掉。
    expect(shown.split('data-gauge-segment=').length - 1).toBe(5)
  })

  it('shows the date nowhere: it belongs to the fear-greed cell reading row', () => {
    for (const shown of [markup(available), markup({ state: 'loading' }), markup({ state: 'unavailable' })]) {
      expect(shown).not.toContain(text.defensivePremium.fearGreed.asOf)
      expect(shown).not.toContain('2026-08-04')
      expect(shown).not.toContain(text.sentiment.observedAt)
    }
  })

  it('announces nothing while waiting: the card allows one role=status, in the other column', () => {
    const shown = markup({ state: 'loading' })
    expect(shown).toContain('loading-spinner')
    expect(shown).not.toContain('role="status"')
    expect(shown).not.toContain('aria-live')
  })

  it('stays inside the 112px column: no width of its own on the section', () => {
    const styles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'), 'utf8')
    const rule = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selector]) => selector.trim().endsWith('.mi-defensive-premium'))
    expect(rule?.[2]).toContain('grid-template-columns: 112px minmax(0, 1fr) minmax(0, 1fr)')
    // 这一列不自己定宽：宽度由卡的三列网格给，窄了跟着缩。
    expect(styles).toContain('.mi-crypto-dashboard__sentiment-gauge svg { width: 112px; height: 80px; overflow: visible; }')
  })
})
