// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingSettingsView } from '../../shared/ipc/dailyBriefingClient'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { DailyBriefingGenerationSettingsModal } from './DailyBriefingGenerationSettingsModal'
import { DailyBriefingPage } from './DailyBriefingPage'

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
    root!.render(<ShellTimeZoneProvider timeZone="Asia/Shanghai"><DailyBriefingGenerationSettingsModal open text={text} client={client} onClose={onClose} /></ShellTimeZoneProvider>)
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
    // The explanation is a question mark now, not a standing sentence: its accessible name is
    // short, and the sentence itself stays out of the panel.
    expect(document.body.querySelector(`[aria-label="${text.generationSettings.noteLabel}"]`)).not.toBeNull()
    expect(document.body.textContent).not.toContain(text.generationSettings.note)

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

  it('keeps the unsupported-language sentence in a question mark and the short status on the row', async () => {
    // The product cannot reach this state (the interface language is a closed set), so this fixture
    // is the machine evidence for it: short status visible, long sentence only inside its question.
    const sentence = text.settings.periods.languageUnsupported.replace('{language}', 'ja-JP')
    const shortStatus = text.settings.periods.languageFallback.replace('{language}', (text.settings.languageNames as Record<string, string>)['en-US'])
    await render({
      ...view,
      language: {
        settings: { primary: 'follow-ui', additional: [] },
        plan: { locales: ['en-US'], primary: { requested: 'ja-JP', used: 'en-US', fallbackReason: 'ui-language-unsupported' }, writeCount: 1 }
      }
    })

    expect(document.body.textContent).toContain(shortStatus)
    expect(document.body.textContent).not.toContain(sentence)

    const question = document.body.querySelector<HTMLElement>(`[aria-label="${sentence}"]`)
    expect(question).not.toBeNull()
    // A screen reader gets the whole sentence from the name, without opening anything.
    await act(async () => { question!.click(); await Promise.resolve(); await Promise.resolve() })
    expect(document.body.textContent).toContain(sentence)

    // The page shows the same sentence in the open: same key, two positions. Comparing the two
    // rendered strings (not just "each has a sentence") is what fails if someone copies the copy.
    const pageHost = document.createElement('div')
    document.body.append(pageHost)
    const pageRoot = createRoot(pageHost)
    const pageClient = {
      getToday: async () => ({ state: 'available' as const, document: { edition: { date: '2026-10-30', locale: 'zh-CN' as const }, status: { readingsAvailable: 4 }, data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'empty' as const } } }, news: { items: [], macro: [], notes: {} }, next: { items: [] }, conclusion: null, citations: [], provenance: {}, schemaVersion: 1, policyVersion: 'v1', lede: { text: '', source: 'template' as const, generatedAt: '2026-10-30T00:00:00.000Z' } } }),
      list: async () => ({ state: 'available' as const, result: { editions: [] } }),
      get: async () => ({ state: 'available' as const, document: {} }),
      regenerate: async () => ({ state: 'unavailable' as const, failureCode: 'x' }),
      getSettings: async () => ({ state: 'available' as const, view }),
      saveSettings: async () => ({ state: 'available' as const, view }),
      getProgress: async () => ({ state: 'idle' as const })
    }
    await act(async () => {
      pageRoot.render(createElement(DailyBriefingPage, {
        locale: 'zh-CN', text, onBack: () => undefined, onConfigureSources: () => undefined,
        client: {
          ...pageClient,
          getSettings: async () => ({ state: 'available' as const, view: { ...view, language: { settings: { primary: 'follow-ui', additional: [] }, plan: { locales: ['en-US'], primary: { requested: 'ja-JP', used: 'en-US', fallbackReason: 'ui-language-unsupported' }, writeCount: 1 } } } })
        } as never
      }))
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const pageLine = [...pageHost.querySelectorAll('[role="status"]')].find((node) => node.textContent === sentence)
    expect(pageLine, 'the page renders the same sentence').toBeDefined()
    act(() => pageRoot.unmount())
    pageHost.remove()
  })

  it('names the reader zone when the period carries none, and prints the value only once', async () => {
    // A fresh install stores no zone; the chip must still name the offset the reader is in, not a
    // bare "GMT". And the value is stated once, as its sentence — not as "08:00" plus "每天 08:00".
    await render({
      ...view,
      generation: { periods: [{ ...view.generation.periods[0]!, generationTimeZone: null }] }
    })
    const chip = document.body.querySelector('.mi-daily-briefing__settings-zone')
    expect(chip?.textContent).toBe('GMT+8')
    expect(chip?.getAttribute('data-time-zone')).toBe('Asia/Shanghai')

    const occurrences = (document.body.textContent ?? '').split(text.settings.periods.timeValue.replace('{time}', '08:00')).length - 1
    expect(occurrences).toBe(1)
    expect(document.body.textContent).not.toContain(`\n08:00`)
  })

  it('attaches the question to the control it explains, and puts the form-wide note above the fields', async () => {
    const { view: _ } = {} as { view?: unknown }
    await render()

    // D6 wires hover/focus; this DOM environment does not deliver React's synthetic mouseenter,
    // so the open-on-hover proof belongs to the window-driving script (it hovers the real button).
    // What is asserted here is the part this environment can see: the trigger is a real, focusable
    // button, and the reason is still its accessible name.
    const reason = document.body.querySelector<HTMLButtonElement>(`[aria-label="${text.settings.periods.addReason}"]`)!
    expect(reason.tagName).toBe('BUTTON')
    expect(reason.getAttribute('aria-label')).toBe(text.settings.periods.addReason)

    // D8: the reason question belongs to the disabled button, immediately beside it.
    const add = [...document.body.querySelectorAll('button')].find((button) => button.textContent === text.settings.periods.add)!
    expect(add.parentElement?.nextElementSibling?.querySelector(`[aria-label="${text.settings.periods.addReason}"]`)).not.toBeNull()

    // D11: the note explains the whole form, so its question sits at the top, above the fields.
    const note = document.body.querySelector<HTMLElement>(`[aria-label="${text.generationSettings.noteLabel}"]`)!
    const firstField = document.body.querySelector('.mi-daily-briefing__settings-row')!
    expect(note.compareDocumentPosition(firstField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('puts the language question before the label it explains', async () => {
    await render({
      ...view,
      language: {
        settings: { primary: 'follow-ui', additional: [] },
        plan: { locales: ['en-US'], primary: { requested: 'ja-JP', used: 'en-US', fallbackReason: 'ui-language-unsupported' }, writeCount: 1 }
      }
    })
    const label = [...document.body.querySelectorAll('.mi-daily-briefing__field-label')]
      .find((node) => node.textContent?.includes(text.settings.periods.language))!
    expect(label.firstElementChild?.querySelector('button')).not.toBeNull()
    expect(label.textContent).toContain(text.settings.periods.language)
  })
})
