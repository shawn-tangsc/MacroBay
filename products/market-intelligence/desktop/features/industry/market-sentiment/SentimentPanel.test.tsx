// @vitest-environment happy-dom
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

describe('the sentiment card speaks two source states, through a veil over the reading', () => {
  const openSources = { sourceLabel: '恐惧与贪婪', onOpenSources: () => undefined }

  it('keeps the card and its title, and veils only the reading', () => {
    // 卡不许被换掉（用户 2026-11-11：「不是隐藏掉，是要让客户知道」）：标题照常在。
    for (const state of [{ state: 'unavailable' as const }, { state: 'empty' as const }]) {
      expect(markup(state)).toContain(text.sentiment.title)
    }
    const disabled = markup({ state: 'loading' }, openSources)
    expect(disabled).toContain(text.sentiment.title)
    expect(disabled).toContain('mi-source-veil-host')
    expect(disabled).toContain('mi-source-veil')
    // 图例留在遮罩外面：它回答「缺的是哪张图」。
    expect(disabled).toContain(text.sentiment.gaugeMarkers.fear)
  })

  it('says "not enabled" with one action, and names the source', () => {
    const veiled = markup({ state: 'loading' }, openSources)
    expect(veiled).toContain(`data-state="disabled"`)
    expect(veiled).toContain(`${dataText.sourcesNotEnabled}（恐惧与贪婪）`)
    // 遮罩里恰一颗按钮：去启用。
    expect((veiled.match(/<button\b/g) ?? [])).toHaveLength(1)
    expect(veiled).toContain(dataText.enableSources)
    // 没有读数，也没有转圈：关掉一格时这一次根本不去读。
    expect(veiled).not.toContain('mi-crypto-dashboard__gauge-segment')
    expect(veiled).not.toContain(text.fearGreed.loading)
  })

  it('says "temporarily unreadable" with one retry, and no longer draws a state view', () => {
    const veiled = markup({ state: 'unavailable' })
    expect(veiled).toContain('data-state="unreadable"')
    expect(veiled).toContain(dataText.temporarilyUnavailable)
    expect((veiled.match(/<button\b/g) ?? [])).toHaveLength(1)
    expect(veiled).toContain(dataText.retry)
    // 旧的整块 `StateView` 作废：卡内三态一律遮罩，遮罩里不再嵌状态面。
    expect(veiled).not.toContain('state-view')
  })

  it('lets the cell state win over the reading, so a closed cell never shows a spinner', () => {
    // 结构优先：宿主说这一格关着，就先画那一态，不看读数（关掉时读数会停在等待态）。
    for (const state of [{ state: 'loading' as const }, { state: 'empty' as const }, { state: 'available' as const, score: 22, bucket: 'extreme-fear' as const, observedAt }]) {
      const veiled = markup(state, openSources)
      expect(veiled).toContain('data-state="disabled"')
      expect(veiled).not.toContain('data-state="unreadable"')
    }
  })

  it('never claims a source is unconfigured, in any state', () => {
    // 这张卡的源是注册表里的固定条目：读者没有「配一个源」的动作，所以不画那一态（死分支不写）。
    for (const state of [available, { state: 'empty' as const }, { state: 'unavailable' as const }, { state: 'loading' as const }]) {
      expect(markup(state)).not.toContain(dataText.sourcesNotConfigured)
      expect(markup(state, openSources)).not.toContain(dataText.sourcesNotConfigured)
    }
  })

  it('routes the veil action to its own handler', async () => {
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
      return container.querySelector<HTMLButtonElement>('.mi-source-veil button')!
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
