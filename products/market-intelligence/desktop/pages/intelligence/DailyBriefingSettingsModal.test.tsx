// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingSettingsView } from '../../shared/ipc/dailyBriefingClient'
import { DailyBriefingSettingsModal } from './DailyBriefingSettingsModal'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const view: DailyBriefingSettingsView = {
  settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
  generation: { generationTime: '08:00', generationTimeZone: 'Asia/Shanghai', generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 8 * * *' },
  resolved: { state: 'agent', providerId: 'p', modelId: 'm', source: 'default' }
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

async function render() {
  ;(window as unknown as { platform: unknown }).platform = {
    modelProviders: { list: async () => [] },
    settings: { get: async () => ({ modelDefaults: { agentModelId: 'p:m' } }) }
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = {
    getSettings: vi.fn(async () => ({ state: 'available' as const, view })),
    saveSettings: vi.fn(async () => ({ state: 'available' as const, view }))
  }
  const onClose = vi.fn()
  await act(async () => {
    root!.render(<DailyBriefingSettingsModal open text={text} client={client} onClose={onClose} />)
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
  return { client, onClose }
}

const saveButton = (): HTMLButtonElement => [...document.body.querySelectorAll('button')]
  .find((button) => button.textContent?.replace(/\s/g, '') === text.generationSettings.save)!

describe('daily briefing settings modal', () => {
  it('is one panel with both sections, and one save writes both halves', async () => {
    const { client, onClose } = await render()

    expect(document.querySelector('.modal__title')?.textContent).toBe(text.settings.title)
    // Two sections, not two dialogs: schedule rules and the model preference.
    expect(document.body.textContent).toContain(text.settings.generation)
    expect(document.body.textContent).toContain(text.settings.ai)
    expect(document.body.textContent).toContain(text.generationSettings.note)

    await act(async () => { saveButton().click(); await Promise.resolve(); await Promise.resolve() })

    // One call, both halves: a second call could save the schedule and drop the model choice.
    expect(client.saveSettings).toHaveBeenCalledWith({
      generation: { generationTime: '08:00', windowHours: 24 },
      editorialEnabled: true,
      providerId: '',
      modelId: '',
      webSearchEnabled: false
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('says which zone the time belongs to', async () => {
    await render()
    const capsule = document.body.querySelector('.mi-daily-briefing__settings-zone')
    expect(capsule?.textContent).toBe('GMT+8')
    expect(capsule?.getAttribute('data-time-zone')).toBe('Asia/Shanghai')
  })

  it('saves the schedule together with a change to the AI switch', async () => {
    const { client } = await render()
    const toggle = document.body.querySelector<HTMLElement>('[role="switch"]')!
    await act(async () => { toggle.click(); await Promise.resolve() })

    await act(async () => { saveButton().click(); await Promise.resolve(); await Promise.resolve() })

    expect(client.saveSettings).toHaveBeenCalledWith({
      generation: { generationTime: '08:00', windowHours: 24 },
      editorialEnabled: false,
      providerId: '',
      modelId: '',
      webSearchEnabled: false
    })
  })

  it('keeps the dialog open and reports a failed save', async () => {
    const { client, onClose } = await render()
    client.saveSettings.mockResolvedValueOnce({ state: 'unavailable', failureCode: 'failed' })

    await act(async () => { saveButton().click(); await Promise.resolve(); await Promise.resolve() })

    expect(document.body.textContent).toContain(text.generationSettings.failed)
    expect(onClose).not.toHaveBeenCalled()
  })
})
