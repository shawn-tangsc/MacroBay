// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { mockGetAgentView } = vi.hoisted(() => ({ mockGetAgentView: vi.fn() }))

vi.mock('../../shared/ipc/intelligenceSourcesClient', () => ({
  intelligenceSourcesClient: {
    getAgentView: mockGetAgentView,
    getPanelView: vi.fn(async () => undefined)
  }
}))

import { productText } from '../../shared/i18n/productText'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import IntelligencePage from './index'

/** A configured reader: one enabled dashboard provider behind the crypto card. */
const configuredView = {
  groups: [{
    groupId: 'spot-momentum',
    tier: 'required',
    sources: [{
      sourceId: 'coingecko-market', providerId: 'coingecko', displayName: 'CoinGecko',
      enabled: true, visibility: 'visible', readiness: 'live', panels: ['dashboard']
    }]
  }]
}

beforeEach(() => {
  mockGetAgentView.mockReset()
  mockGetAgentView.mockResolvedValue(configuredView)
})

let root: Root | null = null


afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function renderPage(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(
    <ShellLanguageProvider language="zh-CN">
      <IntelligencePage />
    </ShellLanguageProvider>
  ))
  return container
}

describe('crypto agent card entry flow', () => {
  // 用户 2026-11-06：点「情报」直接进看板；选择页保留。
  // 用户 2026-11-09：那颗「返回 Agent」整个去掉（那个说法已经不存在），选择页留着但没有入口。
  it('lands on the dashboard and offers no way back to the agent portal', async () => {
    const text = productText['zh-CN'].pages.intelligence.portal
    const container = await renderPage()

    expect(container.textContent).toContain(text.dashboard.title)
    // 看板自己不含智能体卡片；页头也不再有任何离开看板的入口。
    expect(container.querySelectorAll('.mi-agent-card__entry')).toHaveLength(0)
    expect(container.querySelector('.mi-crypto-dashboard__back')).toBeNull()
    // 选择页不在这一屏渲染：入口暂时没有了（正文里不会出现那三个智能体的名字）。
    expect(container.textContent).not.toContain(text.agents.crypto.name)
  })

  // 停用（`MI-1-R33`）：这三条都要先走到智能体选择页，而 2026-11-09 之后看板页头不再有那个入口
  // （选择页仍留着，暂时不可达）。等用户给出的入口定下来，去掉 `.skip` 并把这行 `backToPortal(container)`
  // 补回即可——断言本身没有改过。
  it.skip('lets the card open the dashboard even before configuration', async () => {
    const text = productText['zh-CN'].pages.intelligence.portal
    const container = await renderPage()

    const cardEntries = Array.from(container.querySelectorAll<HTMLButtonElement>('.mi-agent-card__entry'))
    expect(cardEntries).toHaveLength(3)
    expect(cardEntries[0]?.disabled).toBe(false)
    expect(cardEntries[1]?.disabled).toBe(true)
    expect(cardEntries[2]?.disabled).toBe(true)

    await act(async () => cardEntries[0]?.click())

    expect(container.textContent).toContain(text.dashboard.title)
  })

  it('keeps dashboard sources on feature barrels', () => {
    const page = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/index.tsx'), 'utf8')

    expect(page).toContain("from '../../features/macro/economic-calendar'")
    expect(page).toContain("from '../../features/industry/fear-greed'")
    expect(page).toContain("from '../../features/industry/positioning'")
    expect(page).not.toContain("shared/ipc/macroEconomicCalendarClient")
    expect(page).not.toContain("shared/ipc/intelligenceFearGreedClient")
    expect(page).not.toContain("shared/ipc/intelligenceFundingRatePairClient")
  })

  // 停用（`MI-1-R33`）：这三条都要先走到智能体选择页，而 2026-11-09 之后看板页头不再有那个入口
  // （选择页仍留着，暂时不可达）。等用户给出的入口定下来，去掉 `.skip` 并把这行 `backToPortal(container)`
  // 补回即可——断言本身没有改过。
  it.skip('opens the existing source configuration drawer from the progress action', async () => {
    const text = productText['zh-CN'].pages.intelligence.portal
    const navigation = vi.fn()
    window.addEventListener('app-shell:navigate', navigation)
    const container = await renderPage()

    await act(async () => container.querySelector<HTMLButtonElement>('.mi-agent-card__progress')?.click())

    expect(navigation).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain(text.dashboard.title)
    window.removeEventListener('app-shell:navigate', navigation)
  })

  // 停用（`MI-1-R33`）：这三条都要先走到智能体选择页，而 2026-11-09 之后看板页头不再有那个入口
  // （选择页仍留着，暂时不可达）。等用户给出的入口定下来，去掉 `.skip` 并把这行 `backToPortal(container)`
  // 补回即可——断言本身没有改过。
  it.skip('does not draw an empty setup when the activation read fails', async () => {
    const text = productText['zh-CN'].pages.intelligence.portal
    mockGetAgentView.mockRejectedValue(new Error('bridge missing'))
    const container = await renderPage()

    expect(container.textContent).toContain(text.data.temporarilyUnavailable)
    expect(container.textContent).toContain(text.data.retry)
    expect(container.textContent).not.toContain(text.data.sourcesNotConfigured)
    expect(container.querySelector('.mi-agent-card__progress')).toBeNull()
    expect(container.textContent).not.toMatch(/0\/0/)
  })
})
