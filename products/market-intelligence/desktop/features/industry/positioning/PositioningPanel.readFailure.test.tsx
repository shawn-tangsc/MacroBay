// @vitest-environment happy-dom
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
 * 中线牌子上「读不到」的样子：一句话 + 「能重试才给按钮」。
 *
 * 单独一个文件，只为这条判据服务。那份完整的卡片测试文件里有别的历史类型偏移（`MI-11-R199`
 * 的 `desktop/features` 那批在办），把这条判据混进去会被淹掉，也会逼着顺手重写不该在这一笔动的
 * 夹具。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.positioning
const at = (minutesAgo: number): string => new Date(Date.UTC(2026, 9, 29, 0, 0) - minutesAgo * 60_000).toISOString()

const funding: DashboardFundingRateHistoryState = {
  state: 'available',
  btc: [24, 16, 8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: 0.01, paymentDirection: 'long-pays-short' as const })),
  eth: [24, 16, 8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: 0.002, paymentDirection: 'long-pays-short' as const }))
}

function positioning(signal: Extract<DashboardPositioningViewState, { state: 'available' }>['signal']): DashboardPositioningViewState {
  return { state: 'available', window: '7d', btc: [], eth: [], signal, onReload: () => undefined }
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

describe('a failed signal read on the positioning chip', () => {
  it('marks the failure with one icon instead of a line of text', () => {
    const markup = render(positioning({ state: 'unreadable', failureCode: 'query-failed', onReload: () => undefined }))
    // 正面上只有标记：一句话在悬停/聚焦里。整行排障话不许上牌位。
    expect(markup).toContain('mi-signal-read-issue')
    expect(markup).toContain('这项数据读取失败')
    expect(markup).not.toContain('判定记录没拿到')
    // 一处一个：同一个失败在同一张卡上只挂一个。
    expect(markup.split('mi-signal-read-issue').length - 1).toBe(1)
    // 牌子是「有这条信号」的陈述：读不到时一条都不许出现，连灰牌也不行。
    // 没有牌子本体：不是 alert 按钮，也不是灰牌。读不到就不许有「有这条信号」的陈述。
    expect(markup).not.toContain('data-state="alert"')
    expect(markup).not.toContain('疑似强平')
    expect(markup).not.toContain('数据不齐')
  })

  it('never offers a retry: this is not something the reader can do', () => {
    const markup = render(positioning({ state: 'unreadable', failureCode: 'invalid-as-of', onReload: () => undefined }))
    // 标记仍在（我们确实出错了），但正面与浮层里都不许出现「重试」：这件事不用读者动手。
    expect(markup).toContain('mi-signal-read-issue')
    expect(markup).not.toContain('重试')
    expect(markup).not.toContain('retry')
  })
})
