// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { SentimentPanel } from './SentimentPanel'
import type { DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'

/**
 * 搬迁等价：这一段标记是 `2026-11-11` **搬迁之前**从页面 `.mi-crypto-dashboard__sentiment`
 * 抓下来的（同样的分数 22 / 分档 extreme-fear / 观测时刻 / Asia/Shanghai 时区），原样贴在下面。
 * 组件里少一个 class、少一句话、时间格式变了，这条都红——「纯搬迁」不能只靠 diff 看着像。
 */
const BEFORE_THE_MOVE = `<section class="mi-crypto-dashboard__sentiment" aria-labelledby="mi-sentiment-heading"><h2 id="mi-sentiment-heading">市场情绪</h2><div class="mi-crypto-dashboard__sentiment-gauge" data-sentiment-gauge="true"><span class="mi-crypto-dashboard__sentiment-dial"><svg aria-hidden="true" viewBox="0 0 120 86"><path class="mi-crypto-dashboard__gauge-segment" d="M 12 60 A 48 48 0 0 1 21.17 31.79" data-gauge-segment="0" data-gauge-tone="extreme-fear"></path><path class="mi-crypto-dashboard__gauge-segment" d="M 21.17 31.79 A 48 48 0 0 1 45.17 14.35" data-gauge-segment="1" data-gauge-tone="fear"></path><path class="mi-crypto-dashboard__gauge-segment" d="M 45.17 14.35 A 48 48 0 0 1 74.83 14.35" data-gauge-segment="2" data-gauge-tone="neutral"></path><path class="mi-crypto-dashboard__gauge-segment" d="M 74.83 14.35 A 48 48 0 0 1 98.83 31.79" data-gauge-segment="3" data-gauge-tone="greed"></path><path class="mi-crypto-dashboard__gauge-segment" d="M 98.83 31.79 A 48 48 0 0 1 108 60" data-gauge-segment="4" data-gauge-tone="extreme-greed"></path><path class="mi-crypto-dashboard__gauge-tick" d="M 23 60 L 18 60"></path><path class="mi-crypto-dashboard__gauge-tick" d="M 33.84 33.84 L 30.3 30.3"></path><path class="mi-crypto-dashboard__gauge-tick" d="M 60 23 L 60 18"></path><path class="mi-crypto-dashboard__gauge-tick" d="M 86.16 33.84 L 89.7 30.3"></path><path class="mi-crypto-dashboard__gauge-tick" d="M 97 60 L 102 60"></path><g transform="rotate(-50.4 60 60)"><path class="mi-crypto-dashboard__gauge-needle" data-gauge-bucket="extreme-fear" d="M 60 43 L 60 18"></path></g><circle class="mi-crypto-dashboard__gauge-readout" data-gauge-bucket="extreme-fear" cx="60" cy="60" r="19.5"></circle></svg><strong>22</strong></span><span data-gauge-bucket-text="extreme-fear">极度恐惧</span><small>观测时间 2026-08-04 18:00 GMT+8</small><p>极恐 · 中性 · 极贪</p></div></section>`

const text = productText['zh-CN'].pages.intelligence.portal.dashboard
const dataText = productText['zh-CN'].pages.intelligence.portal.data
const observedAt = '2026-08-04T10:00:00.000Z'
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  if (typeof document !== 'undefined') document.body.replaceChildren()
})

function markup(state: DashboardFearGreedState, cellOff?: { sourceLabel: string; onOpenSources: () => void }): string {
  return renderToStaticMarkup(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(ShellTimeZoneProvider, {
      timeZone: 'Asia/Shanghai',
      children: createElement(SentimentPanel, {
        fearGreedState: state, text, onRetry: () => undefined,
        ...(cellOff ? { cellOff } : {})
      })
    })
  }))
}

const available: DashboardFearGreedState = { state: 'available', score: 22, bucket: 'extreme-fear', observedAt }

describe('the sentiment panel after the move out of the dashboard page', () => {
  it('renders exactly the markup the page produced before it moved', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const state: DashboardFearGreedState = { state: 'available', score: 22, bucket: 'extreme-fear', observedAt }
    await act(async () => root.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(ShellTimeZoneProvider, {
        timeZone: 'Asia/Shanghai',
        children: createElement(SentimentPanel, { fearGreedState: state, text, onRetry: () => undefined })
      })
    })))
    expect(container.querySelector('.mi-crypto-dashboard__sentiment')?.outerHTML).toBe(BEFORE_THE_MOVE)
    await act(async () => root.unmount())
    container.remove()
  })
})

describe('the three non-data states keep the figure and put the sentence under it', () => {
  const openSources = { sourceLabel: '恐惧与贪婪', onOpenSources: () => undefined }
  /** 没有读数的三态：图还在，指针与圆盘不在。 */
  const withoutReading = [{ state: 'empty' as const }, { state: 'unavailable' as const }] as const

  it('keeps the arcs, ticks and the three labels in every state, and never draws a needle or a score', () => {
    // 「没启用」由宿主给（cellOff），下面单独覆盖；这里先过读数自己的两态。
    for (const state of withoutReading) {
      const shown = markup(state)
      // 图还在：弧线五段 + 五个刻度 + 三个标签（缺的只是读数，不是整张图）。
      expect(shown.split('data-gauge-segment=').length - 1).toBe(5)
      expect(shown.split('class="mi-crypto-dashboard__gauge-tick"').length - 1).toBe(5)
      expect(shown).toContain(text.sentiment.gaugeMarkers.fear)
      expect(shown).toContain(text.sentiment.gaugeMarkers.neutral)
      expect(shown).toContain(text.sentiment.gaugeMarkers.greed)
      // 不画指针、不画读数圆盘：那是指向一个不存在的分数。
      expect(shown).not.toContain('mi-crypto-dashboard__gauge-needle')
      expect(shown).not.toContain('mi-crypto-dashboard__gauge-readout')
      expect(shown).not.toContain('<strong>')
    }
    // 有数据时才画指针与圆盘（同一条判据的另一半）。
    expect(markup(available)).toContain('mi-crypto-dashboard__gauge-needle')
    expect(markup(available)).toContain('mi-crypto-dashboard__gauge-readout')
  })

  it('names the state in one row under the figure, with exactly the actions that exist', () => {
    const disabled = markup({ state: 'loading' }, openSources)
    expect(disabled).toContain('data-sentiment-state="disabled"')
    expect(disabled).toContain(`${dataText.sourcesNotEnabled}（恐惧与贪婪）`)
    expect(disabled).toContain(dataText.enableSources)

    const unreadable = markup({ state: 'unavailable' })
    expect(unreadable).toContain('data-sentiment-state="unreadable"')
    expect(unreadable).toContain(dataText.temporarilyUnavailable)
    expect(unreadable).toContain(dataText.retry)

    const empty = markup({ state: 'empty' })
    expect(empty).toContain('data-sentiment-state="empty"')
    expect(empty).toContain(text.fearGreed.empty)

    // 那一行恰一处、在图之后、并且**不在**图容器里（不进图、不居中盖图）。
    for (const shown of [disabled, unreadable, empty]) {
      expect(shown.split('data-sentiment-state=').length - 1).toBe(1)
      const gaugeEnd = shown.indexOf('data-sentiment-gauge')
      expect(shown.indexOf('data-sentiment-state=')).toBeGreaterThan(gaugeEnd)
    }
    // 有数据时没有这一行。
    expect(markup(available)).not.toContain('data-sentiment-state=')
  })

  it('offers one action at most: enable, retry, and nothing to press when there is simply no reading yet', () => {
    expect((markup({ state: 'loading' }, openSources).match(/<button\b/g) ?? [])).toHaveLength(1)
    expect((markup({ state: 'unavailable' }).match(/<button\b/g) ?? [])).toHaveLength(1)
    expect((markup({ state: 'empty' }).match(/<button\b/g) ?? [])).toHaveLength(0)
    // 旧的两套壳都作废：读不到不再整块画 `StateView`，也不再自绘遮罩。
    for (const shown of [markup({ state: 'loading' }, openSources), markup({ state: 'unavailable' }), markup({ state: 'empty' })]) {
      expect(shown).not.toContain('state-view')
      expect(shown).not.toContain('mi-source-veil')
    }
  })

  it('lets the cell state win over the reading, so a closed cell never shows a score', () => {
    for (const state of [{ state: 'loading' as const }, { state: 'empty' as const }, available]) {
      const shown = markup(state, openSources)
      expect(shown).toContain('data-sentiment-state="disabled"')
      expect(shown).not.toContain('data-sentiment-state="unreadable"')
      expect(shown).not.toContain('mi-crypto-dashboard__gauge-needle')
    }
  })

  it('never claims a source is unconfigured, in any state', () => {
    for (const state of [available, ...withoutReading, { state: 'loading' as const }]) {
      expect(markup(state)).not.toContain(dataText.sourcesNotConfigured)
      expect(markup(state, openSources)).not.toContain(dataText.sourcesNotConfigured)
    }
  })

  it('routes the row action to its own handler', async () => {
    const open = vi.fn()
    const retry = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const render = async (state: DashboardFearGreedState, cellOff?: typeof openSources): Promise<HTMLButtonElement> => {
      await act(async () => root?.render(createElement(ShellLanguageProvider, {
        language: 'zh-CN',
        children: createElement(ShellTimeZoneProvider, {
          timeZone: 'Asia/Shanghai',
          children: createElement(SentimentPanel, {
            fearGreedState: state, text, onRetry: retry,
            ...(cellOff ? { cellOff: { ...cellOff, onOpenSources: open } } : {})
          })
        })
      })))
      return container.querySelector<HTMLButtonElement>('[data-sentiment-state] button')!
    }
    const enable = await render({ state: 'loading' }, openSources)
    await act(async () => enable.click())
    expect(open).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
    const again = await render({ state: 'unavailable' })
    await act(async () => again.click())
    expect(retry).toHaveBeenCalledTimes(1)
  })
})

describe('the card width cannot be decided by its content', () => {
  const styles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'), 'utf8')
  const sentimentRules = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.includes('mi-crypto-dashboard__sentiment'))

  it('pins the card root and the gauge to the card content width', () => {
    const root = sentimentRules.find(([, selector]) => /^\.mi-crypto-dashboard__sentiment\s*,?$/.test(selector.trim()))
    expect(root?.[2]).toContain('width: 100%')
    expect(root?.[2]).toContain('min-width: 0')
    const gauge = sentimentRules.find(([, selector]) => selector.trim() === '.mi-crypto-dashboard__sentiment-gauge')
    expect(gauge?.[2]).toContain('width: 100%')
  })

  it('never sizes any part of it from its content', () => {
    // 空态缩水的成因都在这三类里：内容宽（fit-content）、行内网格（inline-grid）、
    // 反推 SVG 固有宽。一条都不许回来。
    for (const [, selector, body] of sentimentRules) {
      expect(`${selector}${body}`).not.toMatch(/fit-content|inline-grid|inline-block/)
    }
  })
})
