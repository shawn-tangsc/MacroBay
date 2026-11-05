// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingSettingsView } from '../../shared/ipc/dailyBriefingClient'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { ConfirmProvider } from '@platform/ui/components/confirm'

import { DailyBriefingGenerationSettingsModal } from './DailyBriefingGenerationSettingsModal'

/**
 * 设置面板的生成这一块：**它只显示期列表，不再提供"改这一期的时间/窗口/语言"的入口**。
 *
 * 那四项已经是每期自己的字段，在列表里按一期编辑；面板上再留一份，就是同一个东西两个入口，
 * 而读者会相信那个不被保存的。`02` A1.1 / A10y 也在这里：入口可点、0 条时自己说话。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const view: DailyBriefingSettingsView = {
  settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
  generation: { periods: [{ id: 'default', generationTime: '08:00', generationTimeZone: 'Asia/Shanghai', generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 8 * * *' }] },
  language: { settings: { primary: 'follow-ui', additional: [] }, plan: { locales: ['zh-CN'], primary: { requested: 'zh-CN', used: 'zh-CN' }, writeCount: 1 } },
  webSearchSupported: false,
  resolved: { state: 'agent', providerId: 'p', modelId: 'm', source: 'default' }
}

let root: Root | null = null
let container: HTMLDivElement | null = null
const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  // 期配置走产品桥：读回空列表，创建返回那一条。
  invoke.mockImplementation(async (_product: string, method: string, payload: unknown) => {
    if (method.endsWith('listPeriods')) return []
    if (method.endsWith('updatePeriod')) {
      const body = payload as { id: string; draft: { generationTime: string; windowHours: number; language: string } }
      const period = { id: body.id, ...body.draft }
      return { state: 'saved', period, periods: [period] }
    }
    if (method.endsWith('createPeriod')) {
      const draft = (payload as { draft: { generationTime: string; windowHours: number; language: string } }).draft
      const period = { id: 'p-1', ...draft }
      return { state: 'saved', period, periods: [period] }
    }
    return undefined
  })
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
  delete (window as unknown as { platform?: unknown }).platform
})

async function render(settingsView: DailyBriefingSettingsView = view): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const client = {
    getSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView })),
    saveSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView }))
  }
  await act(async () => {
    root!.render(<ConfirmProvider><ShellTimeZoneProvider timeZone="Asia/Shanghai"><DailyBriefingGenerationSettingsModal open text={text} client={client} onClose={vi.fn()} /></ShellTimeZoneProvider></ConfirmProvider>)
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

const body = (): HTMLElement => document.body

describe('daily briefing generation settings', () => {
  it('is named as generation settings, and keeps the form-wide note as a question mark', async () => {
    await render()
    expect(body().textContent).toContain(text.generationSettings.title)
    expect(body().textContent).not.toContain(text.aiSettings.title)
    expect(document.querySelector('.modal__title')?.textContent).toBe(text.generationSettings.title)
    expect(body().querySelector(`[aria-label="${text.generationSettings.noteLabel}"]`)).not.toBeNull()
    expect(body().textContent).not.toContain(text.generationSettings.note)
  })

  it('offers no place to set a period\'s time, window or language any more', async () => {
    // 这四项在本版属于"每期自己的字段"，在列表里按一期编辑。面板上再出现一次，就是同一件事
    // 两个入口，而且读者会相信那个不被保存的。
    await render()
    // 表单行一个都不剩：没有"生成时间/统计窗口/生成语言"的选择器，也没有"同时生成英语版"的勾选。
    // 组标题那行不算表单行：它是这个分组的名字，不是可编辑的字段。
    expect(body().querySelectorAll('.mi-briefing-settings-form .mi-daily-briefing__settings-row:not(.mi-briefing-settings-form__group-heading)')).toHaveLength(0)
    expect(body().querySelectorAll('.mi-briefing-settings-form select')).toHaveLength(0)
    expect(body().querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    // 文案键已经被删掉了，所以这里按旧说法本身断言它不再出现在渲染输出里。
    expect(body().textContent).not.toContain('同时生成英语版')
    expect(body().textContent).not.toContain(text.settings.periods.languageFollow.replace('{language}', '中文'))
    expect(body().querySelector('[data-briefing-periods]')).not.toBeNull()
  })

  it('asks for the periods with the interface language, never with no argument', async () => {
    // 服务端要语言来决定"没有期时那条默认期用什么语言"，它不猜；少传一个参数整块就变成"没读出来"。
    await render()
    const list = invoke.mock.calls.find((call) => String(call[1]).endsWith('listPeriods'))
    expect(list).toBeDefined()
    expect((list?.[2] as { locale?: string }).locale).toBe('zh-CN')
  })

  it('explains an empty list and opens the add dialog from a pressable entry', async () => {
    await render()
    const empty = body().querySelector<HTMLElement>('[data-briefing-periods-empty]')!
    expect(empty.textContent).toContain(text.settings.periods.empty)
    // 空态里不许把人指去设置页改生成时间：那个入口本版已经拿掉了。
    expect(empty.textContent).not.toContain('设置里改')

    const add = body().querySelector<HTMLButtonElement>('[data-briefing-period-add]')!
    expect(add.disabled).toBe(false)
    expect(add.textContent).toContain(text.settings.periods.add)
    await act(async () => { add.click(); await Promise.resolve() })
    expect(body().querySelector('[data-period-dialog]')).not.toBeNull()
  })

  it('adds the period through the period client and shows it in the list', async () => {
    await render()
    const add = body().querySelector<HTMLButtonElement>('[data-briefing-period-add]')!
    await act(async () => { add.click(); await Promise.resolve() })

    // 弹框里面还套着一个弹框：取最后一个 footer，才是"添加一期"那一张的保存键。
    const footers = [...body().querySelectorAll<HTMLElement>('.ant-modal-footer')]
    const save = [...footers.at(-1)!.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.replace(/\s/g, '') === text.periodDialog.save)!
    expect(save.disabled).toBe(false)
    await act(async () => { save.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    const created = invoke.mock.calls.find((call) => String(call[1]).endsWith('createPeriod'))
    expect(created).toBeDefined()
    expect(created?.[2]).toMatchObject({ draft: { generationTime: expect.any(String), windowHours: expect.any(Number), language: expect.any(String) } })
    // 列表里立刻出现这一条：时间、窗口、语言都由这一期自己带着。
    const row = body().querySelector('[data-period-id]')
    expect(row?.textContent).toContain(text.settings.periods.label.replace('{index}', '1'))
    expect(row?.textContent).toMatch(/每天 \d{2}:00/)
    expect(row?.textContent).toContain(text.settings.languageNames['zh-CN'] as string)
  })

  it('opens that period when its row is pressed, and saves it back through the same client', async () => {
    // 一行就是一期，点它改这一期：期级动作只有"改"和"再加一期"。
    invoke.mockImplementation(async (_product: string, method: string, payload: unknown) => {
      if (method.endsWith('listPeriods')) return [{ id: 'p-1', generationTime: '08:00', windowHours: 24, language: 'zh-CN' }]
      if (method.endsWith('updatePeriod')) {
        const body = payload as { id: string; draft: { generationTime: string; windowHours: number; language: string } }
        const period = { id: body.id, ...body.draft }
        return { state: 'saved', period, periods: [period] }
      }
      return undefined
    })
    await render()

    const row = body().querySelector<HTMLButtonElement>('[data-period-id="p-1"] button')!
    expect(row).not.toBeNull()
    await act(async () => { row.click(); await Promise.resolve() })
    const dialog = body().querySelector('[data-period-dialog]')
    expect(dialog).not.toBeNull()
    // 打开的是"改这一期"，不是"再加一期"：那一期的时间已经在表单里。
    expect(dialog?.textContent).toContain('08:00')

    const footers = [...body().querySelectorAll<HTMLElement>('.ant-modal-footer')]
    const save = [...footers.at(-1)!.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.replace(/\s/g, '') === text.periodDialog.save)!
    await act(async () => { save.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    const updated = invoke.mock.calls.find((call) => String(call[1]).endsWith('updatePeriod'))
    expect(updated?.[2]).toMatchObject({ id: 'p-1' })
    expect(body().querySelector('[data-period-id]')).not.toBeNull()
  })

  it('names both row actions, and only a button edits the row', async () => {
    // 行本身不可点：编辑只从铅笔进。两个按钮都要有名字，不给没有名字的图标。
    invoke.mockImplementation(async (_product: string, method: string) => {
      if (method.endsWith('listPeriods')) return [{ id: 'p-1', generationTime: '08:00', windowHours: 24, language: 'zh-CN' }]
      return undefined
    })
    await render()
    const row = body().querySelector('[data-period-id="p-1"]')!
    expect(row.querySelectorAll('button')).toHaveLength(2)
    expect(body().querySelector('[aria-label="' + text.settings.periods.editRow.replace('{index}', '1') + '"]')).not.toBeNull()
    expect(body().querySelector('[aria-label="' + text.settings.periods.deleteRow.replace('{index}', '1') + '"]')).not.toBeNull()
  })

  it('shows a read failure as an error with a retry instead of a spinner that never stops', async () => {
    const getSettings = vi.fn()
      .mockResolvedValueOnce({ state: 'unavailable', failureCode: 'daily-briefing-request-failed' })
      .mockResolvedValue({ state: 'available', view })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<ConfirmProvider><DailyBriefingGenerationSettingsModal open text={text} client={{ getSettings, saveSettings: vi.fn(async () => ({ state: 'available' as const, view })) }} onClose={vi.fn()} /></ConfirmProvider>)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(body().textContent).not.toContain(text.generationSettings.loading)
    expect(body().querySelector('[data-state="error"]')).not.toBeNull()
    const retry = body().querySelector<HTMLButtonElement>('[data-state="error"] button')!
    await act(async () => { retry.click(); await Promise.resolve(); await Promise.resolve() })
    expect(getSettings).toHaveBeenCalledTimes(2)
    expect(body().querySelector('[data-state="error"]')).toBeNull()
  })
})
