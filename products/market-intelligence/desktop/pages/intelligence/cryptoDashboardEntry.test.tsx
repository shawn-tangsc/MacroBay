// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { productText } from '../../shared/i18n/productText'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import IntelligencePage from './index'

let root: Root | null = null

globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe('crypto dashboard entry flow', () => {
  it('enters the dashboard from crypto, opens the macro calendar, opens the local source drawer by default, and returns to the portal', async () => {
    const text = productText['zh-CN'].pages.intelligence.portal
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const navigation = vi.fn()
    window.addEventListener('app-shell:navigate', navigation)

    await act(async () => root?.render(
      <ShellLanguageProvider language="zh-CN">
        <IntelligencePage />
      </ShellLanguageProvider>
    ))

    const cardEntries = Array.from(container.querySelectorAll<HTMLButtonElement>('.mi-agent-card__entry'))
    expect(cardEntries).toHaveLength(3)
    expect(cardEntries[0]?.disabled).toBe(false)
    expect(cardEntries[1]?.disabled).toBe(true)
    expect(cardEntries[2]?.disabled).toBe(true)

    await act(async () => cardEntries[0]?.click())
    expect(container.textContent).toContain(text.dashboard.title)
    expect(container.querySelector('[data-cross-asset-workspace]')).not.toBeNull()
    expect(container.querySelector('[data-cross-asset-workspace]')?.getAttribute('aria-label')).toBe(text.dashboard.crossAsset.title)
    const sections = [...container.querySelector('.mi-crypto-dashboard')!.children]
    // The macro release strip was removed, so the conclusion slot follows the dashboard header and
    // the cross-asset workspace follows the slot.
    const headerIndex = sections.findIndex(element => element.classList.contains('mi-crypto-dashboard__header'))
    expect(headerIndex).toBeGreaterThanOrEqual(0)
    expect(sections[headerIndex + 1]?.hasAttribute('data-dashboard-conclusion-slot')).toBe(true)
    expect(sections.findIndex(element => element.hasAttribute('data-cross-asset-workspace'))).toBe(headerIndex + 2)

    // The macro release strip — and with it this button — was removed; the calendar now opens from
    // the right column card's header, so this flow starts on the dashboard.
    expect(container.querySelector('.mi-crypto-dashboard__release-dynamics')).toBeNull()
    expect(container.textContent).toContain(text.dashboard.title)

    await act(async () => findButton(container, text.dashboard.configureSources).click())
    const drawer = document.body.querySelector('[role="dialog"]')
    expect(navigation).not.toHaveBeenCalled()
    expect(drawer).not.toBeNull()
    expect(drawer?.textContent).toContain(productText['zh-CN'].settings.intelligenceSources.sourceNames['macro-calendar-fed'])
    expect(drawer?.textContent).not.toContain(text.drawer.title)

    await act(async () => findButton(container, text.dashboard.backToAgents).click())
    expect(container.textContent).toContain(text.moduleLabel)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    window.removeEventListener('app-shell:navigate', navigation)
  })

  it('keeps dashboard sources on feature barrels and leaves the static drawer outside the integration', () => {
    const page = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/index.tsx'), 'utf8')
    const drawerText = productText['en-US'].pages.intelligence.portal.drawer

    expect(page).toContain("from '../../features/macro/economic-calendar'")
    expect(page).toContain("from '../../features/industry/fear-greed'")
    expect(page).toContain("from '../../features/industry/funding-rates'")
    expect(page).not.toContain("shared/ipc/macroEconomicCalendarClient")
    expect(page).not.toContain("shared/ipc/intelligenceFearGreedClient")
    expect(page).not.toContain("shared/ipc/intelligenceFundingRatePairClient")
    expect(drawerText.subtitle).toBe('This is a static source preset. It does not save or start collection.')
  })

  it('opens the local drawer on the Economic Calendar source row with Federal Reserve selected and without shell navigation', async () => {
    const text = productText['zh-CN'].pages.intelligence.portal
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const navigation = vi.fn()
    window.addEventListener('app-shell:navigate', navigation)

    await act(async () => root?.render(<ShellLanguageProvider language="zh-CN"><IntelligencePage /></ShellLanguageProvider>))
    await act(async () => container.querySelector<HTMLButtonElement>('.mi-agent-card__entry')?.click())
    await act(async () => findButton(container, text.dashboard.macroReleaseDynamics.manageSettings).click())

    expect(navigation).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(productText['zh-CN'].settings.intelligenceSources.sourceNames['macro-calendar-fed'])
    expect(document.body.querySelector('[role="dialog"]')?.textContent).not.toContain(text.drawer.title)
    window.removeEventListener('app-shell:navigate', navigation)
  })
})

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((entry) => entry.textContent === label)
  if (!button) throw new Error(`button not found: ${label}`)
  return button
}
