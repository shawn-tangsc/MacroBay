// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { MARKET_ANALYSIS_COMPACT_MAX_WIDTH, MarketAnalysisDashboardLayout } from './MarketAnalysisDashboardLayout'

/**
 * pad 竖屏：看板是底盘，会话入口常驻右下（用户 2026-11-24 拍板，原型
 * `docs-private/05-desktop/ui-audit/prototypes/2026-11-24-pad-agent-drawer.html`）。
 *
 * 这一组钉的是**入口在哪儿、会不会被藏起来**——不是样式细节：
 * ① 那排「市场看板 / 数字货币解读」切换已经撤掉，没有东西能把看板换走；
 * ② 会话圆钮挂在布局根上，不在 agent 栏里（窄档那栏是隐藏的，挂进去就等于没有入口）。
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
  fundingRateClient: { query: never } as never,
  now: () => new Date(asOf),
  onBack: () => {},
  onConfigureSources: () => {},
  onManageSource: () => {},
  onOpenCalendar: () => {}
}

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

async function mount(): Promise<HTMLElement> {
  stubPlatform()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(MarketAnalysisDashboardLayout, {
      text: portal,
      children: createElement(CryptoIntelligenceDashboard, { ...dashboardProps } as never)
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

describe('pad 竖屏的会话入口', () => {
  it('没有「市场看板 / 数字货币解读」切换行，看板换不走', async () => {
    const container = await mount()
    expect(container.querySelector('.mi-analysis-dashboard-layout__switch')).toBeNull()
    // 撤干净了：样式表里也不该再留着这一行（留着就会被下一个人当回退路径加回来）。
    const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')
    expect(css).not.toContain('.mi-analysis-dashboard-layout__switch')
    const narrow = css.slice(css.indexOf('@container mi-analysis-dashboard (max-width: 1303px)'))
    expect(narrow).toContain('.mi-analysis-agent-workspace { display: none; }')
  })

  it('会话圆钮挂在布局根上，不在窄档会被隐藏的 agent 栏里', async () => {
    const container = await mount()
    const button = container.querySelector('[data-agent-floating-button]')
    expect(button).not.toBeNull()
    const host = container.querySelector('[data-agent-control-host]')
    expect(host).not.toBeNull()
    expect(host!.contains(button!)).toBe(true)
    // 窄档那一栏整体隐藏（只是隐藏、不卸载）；圆钮挂在里面就永远看不见。
    expect(container.querySelector('.mi-analysis-agent-workspace')?.contains(button!)).toBe(false)
    expect(button!.getAttribute('aria-expanded')).toBe('false')
  })
})
it('量窄档用的数字，与样式表那条容器查询同值', async () => {
  // 两个来源会漂：CSS 改了数、JS 还按老数切，抽屉就出现在「两栏其实已经并排」的宽度上。
  const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')
  const cssMax = Number(/@container mi-analysis-dashboard \(max-width: (\d+)px\)/.exec(css)?.[1])
  expect(cssMax).toBeGreaterThan(0)
  expect(MARKET_ANALYSIS_COMPACT_MAX_WIDTH).toBe(cssMax)
})
