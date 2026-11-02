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
  generation: {
    generationTime: '08:00',
    generationTimeZone: 'Asia/Shanghai',
    windowHours: 24,
    periods: [{ id: 'default', generationTime: '08:00', generationTimeZone: 'Asia/Shanghai', generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 8 * * *' }]
  },
  language: {
    settings: { primary: 'follow-ui', additional: [] },
    plan: { locales: ['zh-CN'], primary: { requested: 'zh-CN', used: 'zh-CN' }, writeCount: 1 }
  },
  webSearchSupported: false,
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
    // The "applies from the next brief" sentence lives in a question mark, not on the panel: its
    // accessible name is what a screen reader gets without opening anything.
    expect(document.body.querySelector(`[aria-label="${text.generationSettings.noteLabel}"]`)).not.toBeNull()
    expect(document.body.textContent).not.toContain(text.generationSettings.note)

    await act(async () => { saveButton().click(); await Promise.resolve(); await Promise.resolve() })

    // One call, both halves: a second call could save the schedule and drop the model choice.
    expect(client.saveSettings).toHaveBeenCalledWith({
      generation: { generationTime: '08:00', windowHours: 24 },
      language: { additional: [] },
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
      language: { additional: [] },
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

  it('keeps the add-edition control disabled and gives the reason as its accessible name', async () => {
    const { client } = await render()
    const add = [...document.body.querySelectorAll('button')].find((button) => button.textContent === text.settings.periods.add)!
    // Disabled is the behaviour, not the styling: a control that reads as disabled but still saves
    // would pass a "the text says it is disabled" check and fail this one.
    expect(add.disabled).toBe(true)
    expect(add.getAttribute('aria-label')).toBe(text.settings.periods.addReason)
    await act(async () => { add.click(); await Promise.resolve() })
    expect(client.saveSettings).not.toHaveBeenCalled()
  })

  it('offers the second edition only when ticked and states the cost the plan reports', async () => {
    const { client } = await render()
    const costTrigger = (): HTMLElement | null => document.body.querySelector(`[aria-label="${text.settings.periods.costLabel}"]`)
    // No extra edition ticked, no cost question at all.
    expect(costTrigger()).toBeNull()

    const tick = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => { tick.click(); await Promise.resolve() })
    // Ticking adds the question; the sentence inside it carries the writing count from the plan.
    const trigger = costTrigger()!
    expect(trigger).not.toBeNull()
    await act(async () => { trigger.click(); await Promise.resolve(); await Promise.resolve() })
    expect(document.body.textContent).toContain('写作 2 次')
    // Pinned open; close it again so the next assertions see the settled page.
    await act(async () => { trigger.click(); await Promise.resolve() })

    await act(async () => { saveButton().click(); await Promise.resolve(); await Promise.resolve() })
    expect(client.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: { additional: ['en-US'] } }))

    await act(async () => { tick.click(); await Promise.resolve() })
    // Unticking removes the question and its sentence with it.
    expect(costTrigger()).toBeNull()
    expect(document.body.textContent).not.toContain('写作 2 次')
  })

  it('shows a read failure as an error with a retry instead of a spinner that never stops', async () => {
    ;(window as unknown as { platform: unknown }).platform = {
      modelProviders: { list: async () => [] },
      settings: { get: async () => ({}) }
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const getSettings = vi.fn()
      .mockResolvedValueOnce({ state: 'unavailable', failureCode: 'daily-briefing-request-failed' })
      .mockResolvedValue({ state: 'available', view })
    const client = { getSettings, saveSettings: vi.fn(async () => ({ state: 'available' as const, view })) }

    await act(async () => {
      root!.render(<DailyBriefingSettingsModal open text={text} client={client} onClose={vi.fn()} />)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    // A failed read must not look like work in progress: the reader is told and can act.
    expect(document.body.textContent).not.toContain(text.generationSettings.loading)
    expect(document.body.querySelector('[data-state="error"]')).not.toBeNull()

    const retry = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.replace(/\s/g, '') === text.generationSettings.retry)!
    await act(async () => { retry.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(getSettings).toHaveBeenCalledTimes(2)
    expect(document.body.querySelector('[data-state="error"]')).toBeNull()
    expect(document.body.textContent).toContain(text.settings.generation)
  })
})
