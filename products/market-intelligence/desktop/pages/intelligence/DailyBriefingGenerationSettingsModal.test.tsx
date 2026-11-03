// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingSettingsView } from '../../shared/ipc/dailyBriefingClient'
import { DailyBriefingGenerationSettingsModal } from './DailyBriefingGenerationSettingsModal'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const view: DailyBriefingSettingsView = {
  settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
  // The generation block is the period list only: the dialog edits the first period, so the values
  // it shows have to come from that entry — a flat copy at this level does not exist on the wire.
  generation: { periods: [{ id: 'default', generationTime: '08:00', generationTimeZone: 'Asia/Shanghai', generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 8 * * *' }] },
  language: { settings: { primary: 'follow-ui', additional: [] }, plan: { locales: ['zh-CN'], primary: { requested: 'zh-CN', used: 'zh-CN' }, writeCount: 1 } },
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
})

async function render(settingsView: DailyBriefingSettingsView = view) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = {
    getSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView })),
    saveSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView }))
  }
  const onClose = vi.fn()
  await act(async () => {
    root!.render(<DailyBriefingGenerationSettingsModal open text={text} client={client} onClose={onClose} />)
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return { client, onClose }
}

describe('daily briefing generation settings modal', () => {
  it('is named as generation settings, not AI settings, and saves the loaded values', async () => {
    const { client, onClose } = await render()
    expect(document.body.textContent).toContain(text.generationSettings.title)
    expect(document.body.textContent).not.toContain(text.aiSettings.title)
    // 标题现在由共用弹窗按键解析：键写错会渲染成空标题，所以这里断言渲染值，不只断言文本包含。
    expect(document.querySelector('.modal__title')?.textContent).toBe(text.generationSettings.title)
    expect(document.body.textContent).toContain(text.generationSettings.note)

    const save = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.replace(/\s/g, '') === text.generationSettings.save)!
    await act(async () => { save.click(); await Promise.resolve(); await Promise.resolve() })

    expect(client.saveSettings).toHaveBeenCalledWith({
      generation: { generationTime: '08:00', windowHours: 24 },
      language: { additional: [] }
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('says which zone the time belongs to, and which saved value is not a zone', async () => {
    // The time alone is ambiguous: 08:00 means 08:00 in the zone beside it. When that zone cannot be
    // read, the panel names it rather than letting the reader guess why nothing runs.
    await render()
    const capsule = document.body.querySelector('.mi-daily-briefing__settings-zone')
    expect(capsule?.textContent).toBe('GMT+8')
    expect(capsule?.getAttribute('data-time-zone')).toBe('Asia/Shanghai')
    expect(document.body.querySelector('.mi-daily-briefing__settings-warning')).toBeNull()
  })

  it('names the saved value that is not a zone, read from the period it edits', async () => {
    // The verdict lives only on the period entry. Reading it from a flat field left the warning
    // silently dead: the dialog would run with a zone it never told the reader about.
    await render({
      ...view,
      generation: { periods: [{ ...view.generation.periods[0]!, generationTimeZone: null, generationTimeZoneInvalid: 'Asia/Shangai' }] }
    })
    expect(document.body.querySelector('.mi-daily-briefing__settings-zone')).toBeNull()
    expect(document.body.querySelector('.mi-daily-briefing__settings-warning')?.textContent)
      .toBe(text.generationSettings.invalidTimeZone.replace('{zone}', 'Asia/Shangai'))
  })

  it('keeps the dialog open and reports a failed save', async () => {
    const { client, onClose } = await render()
    client.saveSettings.mockResolvedValueOnce({ state: 'unavailable', failureCode: 'daily-briefing-generation-time-invalid' })

    const save = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.replace(/\s/g, '') === text.generationSettings.save)!
    await act(async () => { save.click(); await Promise.resolve(); await Promise.resolve() })

    expect(document.body.textContent).toContain(text.generationSettings.failed)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the add-edition control disabled and gives the reason as its accessible name', async () => {
    const { client } = await render()
    const add = [...document.body.querySelectorAll('button')].find((button) => button.textContent === text.settings.periods.add)!
    // Behaviour, not styling: a control that reads as disabled but still saves would pass a
    // "the sentence is there" check and fail this one.
    expect(add.disabled).toBe(true)
    expect(add.getAttribute('aria-label')).toBe(text.settings.periods.addReason)
    await act(async () => { add.click(); await Promise.resolve() })
    expect(client.saveSettings).not.toHaveBeenCalled()
  })

  it('offers the second edition only when ticked and states the cost the plan reports', async () => {
    const { client } = await render()
    const costTrigger = (): HTMLElement | null => document.body.querySelector(`[aria-label="${text.settings.periods.costLabel}"]`)
    expect(costTrigger()).toBeNull()
    // The field values carry their meaning, and the default time is the policy's, not a literal here.
    expect(document.body.textContent).toContain(text.settings.periods.timeValue.replace('{time}', '08:00'))
    expect(document.body.textContent).toContain(text.settings.periods.windowValue.replace('{hours}', '24'))

    const tick = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => { tick.click(); await Promise.resolve() })
    const trigger = costTrigger()!
    await act(async () => { trigger.click(); await Promise.resolve(); await Promise.resolve() })
    expect(document.body.textContent).toContain('写作 2 次')

    await act(async () => { trigger.click(); await Promise.resolve() })
    await act(async () => {
      const save = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.replace(/\s/g, '') === text.generationSettings.save)!
      save.click(); await Promise.resolve(); await Promise.resolve()
    })
    expect(client.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: { additional: ['en-US'] } }))

    await act(async () => { tick.click(); await Promise.resolve() })
    expect(costTrigger()).toBeNull()
  })

  it('shows a read failure as an error with a retry instead of a spinner that never stops', async () => {
    const getSettings = vi.fn()
      .mockResolvedValueOnce({ state: 'unavailable', failureCode: 'daily-briefing-request-failed' })
      .mockResolvedValue({ state: 'available', view })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<DailyBriefingGenerationSettingsModal open text={text} client={{ getSettings, saveSettings: vi.fn(async () => ({ state: 'available' as const, view })) }} onClose={vi.fn()} />)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(document.body.textContent).not.toContain(text.generationSettings.loading)
    expect(document.body.querySelector('[data-state="error"]')).not.toBeNull()
    const retry = document.body.querySelector<HTMLButtonElement>('[data-state="error"] button')!
    await act(async () => { retry.click(); await Promise.resolve(); await Promise.resolve() })
    expect(getSettings).toHaveBeenCalledTimes(2)
    expect(document.body.querySelector('[data-state="error"]')).toBeNull()
  })
})
