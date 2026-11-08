// @vitest-environment happy-dom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import type { DashboardFundingRateHistoryState } from '../../../pages/intelligence/dashboardFundingRateHistoryModel'
import type { DashboardPositioningViewState } from '../../../pages/intelligence/dashboardOpenInterestModel'
import type { SignalAnalysisStateView } from '../../../../service/intelligence/analysis/signalAnalysisState'
import { PositioningPanel } from './PositioningPanel'

/**
 * 「分析到哪一步」那句话说得出、也**上得了屏**。
 *
 * 只测句子怎么拼是不够的：文案键挂错一层时解析成空串，句子照样“拼得对”，卡片上一个字都没有。
 * 这条从卡片渲染进去，点开牌子看详情里到底有没有那句话。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.positioning
const at = (minutesAgo: number): string => new Date(Date.UTC(2026, 9, 29, 0, 0) - minutesAgo * 60_000).toISOString()

const funding: DashboardFundingRateHistoryState = {
  state: 'available',
  btc: [24, 16, 8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: 0.01, paymentDirection: 'long-pays-short' as const })),
  eth: [24, 16, 8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: 0.002, paymentDirection: 'long-pays-short' as const }))
}

function positioning(analysis: SignalAnalysisStateView): DashboardPositioningViewState {
  return {
    state: 'available',
    window: '7d',
    btc: [{ observedAt: at(15), notionalUsd: 8.9e9 }],
    eth: [{ observedAt: at(15), notionalUsd: 2.4e9 }],
    hints: [],
    signal: { state: 'alert', asset: 'btc', direction: 'long', dropPct: -1.9, volumeMultiple: 3.4, observedAt: at(15) },
    signalAnalysis: analysis,
    onReload: () => undefined
  }
}

async function openDetails(state: DashboardPositioningViewState): Promise<string> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(ShellTimeZoneProvider, {
        timeZone: 'UTC',
        children: createElement(PositioningPanel, { funding, positioning: state, window: '7d', onWindowChange: () => undefined, text })
      })
    }))
  })
  const chip = [...container.querySelectorAll('button')].find(button => button.getAttribute('data-state') === 'alert')
  await act(async () => { chip?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await act(async () => { await Promise.resolve() })
  // 读数搬进了弹层，而弹层 portal 到 `<body>`：卡片的 innerHTML 里已经看不到它了。
  const markup = document.querySelector('[role="dialog"]')?.innerHTML ?? ''
  act(() => root.unmount())
  return markup
}

describe('the analysis state on the card', () => {
  it('puts the sentence on screen when the analysis is out', async () => {
    const markup = await openDetails(positioning({ analysisOffByReader: false, analysisState: 'published' }))
    // 这句必须真的出现在详情里——只测拼装、不测上屏，等于没测到读者看到的东西。
    expect(markup).toContain('分析已出，可以在时间轴里看到')
  })

  it('shows nothing at all while it is still waiting', async () => {
    const queued = await openDetails(positioning({ analysisOffByReader: false, analysisState: 'queued' }))
    expect(queued).not.toContain('分析已出')
    expect(queued).not.toContain('已排上队')
  })
})
