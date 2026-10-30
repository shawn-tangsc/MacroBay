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
  generation: { generationTime: '08:00', windowHours: 24, cronExpression: '0 8 * * *' },
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

async function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = {
    getSettings: vi.fn(async () => ({ state: 'available' as const, view })),
    saveSettings: vi.fn(async () => ({ state: 'available' as const, view }))
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
    expect(document.body.textContent).toContain(text.generationSettings.note)

    const save = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.replace(/\s/g, '') === text.generationSettings.save)!
    await act(async () => { save.click(); await Promise.resolve(); await Promise.resolve() })

    expect(client.saveSettings).toHaveBeenCalledWith({ generation: { generationTime: '08:00', windowHours: 24 } })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the dialog open and reports a failed save', async () => {
    const { client, onClose } = await render()
    client.saveSettings.mockResolvedValueOnce({ state: 'unavailable', failureCode: 'daily-briefing-generation-time-invalid' })

    const save = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.replace(/\s/g, '') === text.generationSettings.save)!
    await act(async () => { save.click(); await Promise.resolve(); await Promise.resolve() })

    expect(document.body.textContent).toContain(text.generationSettings.failed)
    expect(onClose).not.toHaveBeenCalled()
  })
})
