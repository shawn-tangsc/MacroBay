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
  it('lets the card open the dashboard even before configuration', async () => {
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

  it('opens the existing source configuration drawer from the progress action', async () => {
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
})
