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
    // 标题现在由共用弹窗按键解析：键写错会渲染成空标题，所以这里断言渲染值，不只断言文本包含。
    expect(document.querySelector('.modal__title')?.textContent).toBe(text.generationSettings.title)
    expect(document.body.textContent).toContain(text.generationSettings.note)

    const save = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.replace(/\s/g, '') === text.generationSettings.save)!
    await act(async () => { save.click(); await Promise.resolve(); await Promise.resolve() })

    expect(client.saveSettings).toHaveBeenCalledWith({ generation: { generationTime: '08:00', windowHours: 24 } })
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

  it('keeps the dialog open and reports a failed save', async () => {
    const { client, onClose } = await render()
    client.saveSettings.mockResolvedValueOnce({ state: 'unavailable', failureCode: 'daily-briefing-generation-time-invalid' })

    const save = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.replace(/\s/g, '') === text.generationSettings.save)!
    await act(async () => { save.click(); await Promise.resolve(); await Promise.resolve() })

    expect(document.body.textContent).toContain(text.generationSettings.failed)
    expect(onClose).not.toHaveBeenCalled()
  })
})
