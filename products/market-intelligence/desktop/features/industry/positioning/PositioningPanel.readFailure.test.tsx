// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import type { DashboardFundingRateHistoryState } from '../../../pages/intelligence/dashboardFundingRateHistoryModel'
import type { DashboardPositioningViewState } from '../../../pages/intelligence/dashboardOpenInterestModel'
import { PositioningPanel } from './PositioningPanel'

/**
 * 「读不到」那一条脚注：一句话 + 平台既有那枚重试。
 *
 * 这里原先钉的是一条相反的规矩——「读不到只给一枚 16px 感叹号，卡片正面不留整行排障话、不给按钮」。
 * 它在「必须让读者分清 没命中 / 读不到 / 数据不齐」这个要求下不成立了：一枚感叹号说不出是哪一种，
 * 而区分这三种正是用户反复要求的（界面设计 v2、产品 2026-11-08）。改的是这一处和下面这几条用例；
 * 共享的 `SignalReadIssue` 与其他卡一行未动。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.positioning
const at = (minutesAgo: number): string => new Date(Date.UTC(2026, 9, 29, 0, 0) - minutesAgo * 60_000).toISOString()

const funding: DashboardFundingRateHistoryState = {
  state: 'available',
  btc: [24, 16, 8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: 0.01, paymentDirection: 'long-pays-short' as const })),
  eth: [24, 16, 8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: 0.002, paymentDirection: 'long-pays-short' as const }))
}

function positioning(signal: Extract<DashboardPositioningViewState, { state: 'available' }>['signal']): DashboardPositioningViewState {
  return { state: 'available', window: '7d', btc: [], eth: [], hints: [], hiddenHits: 0, signal, onReload: () => undefined }
}

function render(state: DashboardPositioningViewState): string {
  return renderToStaticMarkup(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(ShellTimeZoneProvider, {
      timeZone: 'UTC',
      children: createElement(PositioningPanel, { funding, positioning: state, window: '7d', onWindowChange: () => undefined, text })
    })
  }))
}

describe('the liquidation note when the rule could not be read', () => {
  const noteOf = (markup: string): string =>
    markup.match(/<p class="mi-positioning-panel__liquidation-note"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''

  it('says it in one line, and offers the retry the card already had', () => {
    const markup = render(positioning({ state: 'unreadable', failureCode: 'query-failed', onReload: () => undefined }))
    const line = noteOf(markup)
    expect(line).toContain(text.liquidationNoteUnreadable)
    expect(line).toContain('重试')
    // 一处一个：同一张卡上这行只出现一次。
    expect(markup.split('data-liquidation-note').length - 1).toBe(1)
    // 牌子是「有这条信号」的陈述：读不到时一条都不许出现，连灰牌也不行。
    expect(markup).not.toContain('data-state="alert"')
    expect(markup).not.toContain('疑似强平')
    // 另外两种说法不许顶上来。
    expect(markup).not.toContain(text.liquidationNoteNoHit)
    expect(markup).not.toContain(text.liquidationNoteInsufficient)
    // 那枚感叹号标记换成了这一行。
    expect(markup).not.toContain('mi-signal-read-issue')
  })

  it('keeps the internal vocabulary off the line', () => {
    const markup = render(positioning({ state: 'unreadable', failureCode: 'contract-invalid', onReload: () => undefined }))
    // 内部词不上屏——只对**这一行**断言，不对整张卡跑宽泛正则：卡片别处正常出现「记录」两个字时，
    // 宽断言会误红，然后有人为了变绿去删断言。
    expect(noteOf(markup)).not.toMatch(/contract|invalid|状态|记录|通道/)
  })
})

describe('making room for the marker', () => {
  it('reserves a corner only while the marker is there', () => {
    const css = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/industry/shared/SignalReadIssue.css'), 'utf8')
    // 有标记才让位：`:has(...)` 让这条规则在没有标记时不生效，布局与改动前完全一样；只挪横向。
    expect(css).toMatch(/:has\(\.mi-signal-read-issue\)[\s\S]*padding-inline-end: 24px/)
  })
})
