// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

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
const observedAt = '2026-08-04T10:00:00.000Z'

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
