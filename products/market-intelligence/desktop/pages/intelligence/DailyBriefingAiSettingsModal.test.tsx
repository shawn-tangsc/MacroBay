// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingAiSettingsView } from '../../shared/ipc/dailyBriefingClient'
import { DailyBriefingAiSettingsModal } from './DailyBriefingAiSettingsModal'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const view: DailyBriefingAiSettingsView = {
  settings: { editorialEnabled: true, providerId: '', modelId: '' },
  resolved: { state: 'agent', providerId: 'p', modelId: 'm', source: 'default' }
}
const disabledView: DailyBriefingAiSettingsView = {
  settings: { editorialEnabled: false, providerId: '', modelId: '' },
  resolved: { state: 'disabled' }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
  delete (window as unknown as { platform?: unknown }).platform
})

async function render(onClose = vi.fn()) {
  ;(window as unknown as { platform: unknown }).platform = {
    modelProviders: { list: async () => [] },
    settings: { get: async () => ({ modelDefaults: { assistantModelId: 'p:m' } }) }
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = {
    getSettings: vi.fn(async () => ({ state: 'available' as const, view })),
    saveSettings: vi.fn(async () => ({ state: 'available' as const, view: disabledView }))
  }
  await act(async () => {
    root!.render(<DailyBriefingAiSettingsModal open text={text} client={client} onClose={onClose} />)
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
  return { client, onClose }
}

describe('daily briefing AI settings modal', () => {
  it('loads the current preference and saves a change', async () => {
    const { client, onClose } = await render()
    expect(document.body.textContent).toContain(text.aiSettings.title)
    expect(document.body.textContent).toContain(text.aiSettings.followDefault)
    const save = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.replace(/\s/g, '') === text.aiSettings.save)!
    await act(async () => { save.click(); await Promise.resolve(); await Promise.resolve() })
    expect(client.saveSettings).toHaveBeenCalledWith({ editorialEnabled: true, providerId: '', modelId: '' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('turns the editorial layer off and reports a failed save', async () => {
    const { client, onClose } = await render()
    const toggle = document.body.querySelector<HTMLElement>('[role="switch"]')!
    await act(async () => { toggle.click(); await Promise.resolve() })
    client.saveSettings.mockResolvedValueOnce({ state: 'unavailable', failureCode: 'failed' })
    const save = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.replace(/\s/g, '') === text.aiSettings.save)!
    await act(async () => { save.click(); await Promise.resolve(); await Promise.resolve() })
    expect(client.saveSettings).toHaveBeenCalledWith({ editorialEnabled: false, providerId: '', modelId: '' })
    expect(document.body.textContent).toContain(text.aiSettings.failed)
    expect(onClose).not.toHaveBeenCalled()
  })
})
