// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { CapitalConditionsPanel } from './CapitalConditionsPanel'
import type { DashboardCapitalConditionsState } from './capitalConditionsModel'

/**
 * 窗口那句的措辞与它的 ⓘ（产品 2026-11-16 定稿）。
 *
 * 标题**只报范围**：「最近 7 天」/「Last 7 days」。为什么不写「交易日」——这 7 格是按日历排的
 * 连续 7 天，也不保证每格都有数；不写括号、不写星号、不写「缺数」——那些解释进 ⓘ，进正文就是
 * 把一句说明塞进标题。
 */
const zh = productText['zh-CN'].pages.intelligence.portal.dashboard.capitalConditions
const en = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
const ui = productText['zh-CN'].pages.intelligence.portal

const available: DashboardCapitalConditionsState = {
  state: 'available',
  conclusion: 'partial',
  observedAt: '2026-08-18T07:00:00.000Z',
  currentUsd: '$1B',
  change1dUsd: '$0',
  change1dPercent: '0.00%',
  change7dUsd: '$0',
  change7dPercent: '0.00%',
  change30dUsd: '$0',
  change30dPercent: '0.00%',
  flowHistory: { state: 'available', rows: [{ tradingDate: '2026-08-18', funds: 95_000_000, btc: -95_000_000, eth: -1_300_000 }] },
  etfReading: {
    state: 'available',
    comparison: { state: 'aligned' },
    coverage: [],
    verifiedAt: '2026-08-18T07:00:00.000Z',
    btc: { asset: 'BTC', latestNetFlowUsd: '-$95M', observedAt: '2026-08-18T07:00:00.000Z', cumulative: [], rows: [] },
    eth: { asset: 'ETH', latestNetFlowUsd: '-$1.3M', observedAt: '2026-08-18T07:00:00.000Z', cumulative: [], rows: [] }
  }
}

function markup(state: DashboardCapitalConditionsState, language: 'zh-CN' | 'en-US'): string {
  return renderToStaticMarkup(createElement(ShellLanguageProvider, {
    language,
    children: createElement(ShellTimeZoneProvider, {
      timeZone: 'UTC',
      children: createElement(CapitalConditionsPanel, {
        text: productText[language].pages.intelligence.portal.dashboard.capitalConditions,
        state,
        onRefresh: () => undefined
      })
    })
  }))
}

describe('the flow window label', () => {
  it('states the range only — no trading-day wording, no brackets, no asterisk', () => {
    for (const text of [zh, en]) {
      expect(text.chartWindow).not.toContain('交易日')
      expect(text.chartWindow.toLowerCase()).not.toContain('session')
      expect(text.chartWindow).not.toMatch(/[()（）*＊]/)
      expect(text.chartWindow).not.toContain('缺数')
    }
    expect(zh.chartWindow.startsWith('最近 7 天')).toBe(true)
    expect(en.chartWindow.startsWith('Last 7 days')).toBe(true)
  })

  it('keeps the explanation in the ⓘ, never in the body', () => {
    const zhMarkup = markup(available, 'zh-CN')
    expect(zhMarkup).toContain(zh.chartWindow)
    // 说明只进浮层：正文里没有那句。
    expect(zhMarkup).not.toContain(zh.chartWindowHelp)
    expect(markup(available, 'en-US')).not.toContain(en.chartWindowHelp)
    // 窗口那句旁边有 ⓘ：平台 `helpTrigger` 给的是平台那句读屏名（「查看说明」），
    // 图上口径那颗仍用它自己的产品键（`infoAria`）——两个入口，两种名字，各自说各自的事。
    expect([...zhMarkup.matchAll(/aria-label="查看说明"/g)]).toHaveLength(1)
    expect(zhMarkup).toContain(`aria-label="${zh.infoAria}"`)
  })

  it('shows the explanation when the ⓘ is opened', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(ShellTimeZoneProvider, {
        timeZone: 'UTC',
        children: createElement(CapitalConditionsPanel, { text: zh, state: available, onRefresh: () => undefined })
      })
    })))
    const helpButtons = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="查看说明"]')]
    const windowHelp = helpButtons.at(-1)!
    expect(windowHelp).not.toBeUndefined()
    await act(async () => windowHelp.click())
    expect(document.body.textContent).toContain(zh.chartWindowHelp)
    await act(async () => root.unmount())
    container.remove()
  })
})
