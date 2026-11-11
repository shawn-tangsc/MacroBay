// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { MarketAnalysisDashboardLayout } from './MarketAnalysisDashboardLayout'

/**
 * 「最新 AI 结论」卡上的「开启 AI 分析」：**宿主给了入口就用宿主的**（页面层是打开配置抽屉
 * 「AI 分析」屏），只有单挂组件、没有宿主时才退回本地弹窗。
 *
 * 用户 2026-11-11 真机：时间轴抽屉点进去是新抽屉，结论卡点进去还是老弹窗——同一屏两个入口只改了
 * 一个（`MarketAnalysisDashboardLayout.tsx:179` 写死了本地弹窗）。
 *
 * 判据：① 点它 → 宿主回调被调用一次（页面层目标 `{ menu: 'analysis' }`）；② 宿主给了入口时本地弹窗
 * **根本没有挂载**（不是渲染了但看不见）；③ 没有宿主时仍能打开本地弹窗。
 */
const portal = productText['zh-CN'].pages.intelligence.portal
const asOf = '2026-10-07T09:06:14.792Z'
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const never = async () => ({ state: 'unavailable' })
const dashboardProps = {
  text: portal.dashboard,
  client: { queryMonth: never } as never,
  fearGreedClient: { querySnapshot: never } as never,
  fundingRateClient: { query: never } as never,
  now: () => new Date(asOf),
  onBack: () => {},
  onConfigureSources: () => {},
  onManageSource: () => {},
  onOpenCalendar: () => {}
}

/** 分析开关关着 → 卡片走「开启 AI 分析」那一支（按钮才出现）。 */
function stubPlatform(): void {
  const invoke = vi.fn(async (_product: string, method: string) => {
    if (method === 'marketAnalysis.getSettings') return { enabled: false, providerId: '', modelId: '', updatedAt: asOf }
    if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, nextCursor: null, items: [] }
    if (method === 'marketAnalysis.getLatestAttempt') return null
    return []
  })
  vi.stubGlobal('platform', {
    products: { invoke },
    settings: { get: async () => ({ modelDefaults: {} }) },
    agents: { getState: async () => ({ agents: [], sessions: [], messagesBySessionId: {} }), onStateChanged: () => () => {} }
  })
}

async function mount(onOpenAnalysisSettings?: () => void): Promise<HTMLElement> {
  stubPlatform()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(MarketAnalysisDashboardLayout, {
      text: portal,
      ...(onOpenAnalysisSettings === undefined ? {} : { onOpenAnalysisSettings }),
      children: createElement(CryptoIntelligenceDashboard, { ...dashboardProps } as never)
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

function enableButton(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')]
    .find((button) => button.textContent === portal.analysisTimeline.enableAnalysis)
}

describe('结论卡「开启 AI 分析」走宿主的入口', () => {
  it('calls the host callback once and never mounts the local dialog', async () => {
    const onOpen = vi.fn()
    const container = await mount(onOpen)
    const button = enableButton(container)
    if (button === undefined) throw new Error(`no button; text=${container.textContent?.slice(0, 400)}`)
    await act(async () => { button.click() })
    expect(onOpen).toHaveBeenCalledTimes(1)
    // 宿主给了入口 → 本地弹窗**根本不挂载**（不是渲染了但看不见）。
    expect(document.querySelector('.ant-modal')).toBeNull()
  })

  it('still opens the local dialog when no host entry is provided', async () => {
    const container = await mount()
    const button = enableButton(container)
    expect(button).toBeTruthy()
    await act(async () => { button!.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(document.querySelector('.ant-modal')).not.toBeNull()
  })
})
