// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { intelligenceNotificationText } from './text'
import IntelligenceNotificationSettingsSection from './index'

/**
 * 这一页的判据（界面规范 §9d–§9f）：左列表四项、默认选中第一项、关着只写在状态词里；
 * 「日历事件」一项里时间线 + 一处表面选择（管两条）+ 开始前 + 发生后。
 */

const text = intelligenceNotificationText['zh-CN']
const IDS = {
  signal: 'market-intelligence.signal.triggered',
  macro: 'market-intelligence.macro.event-landed',
  briefing: 'market-intelligence.briefing.ready'
} as const

type Stubs = {
  getChannelEvents: ReturnType<typeof vi.fn>
  setChannelEvent: ReturnType<typeof vi.fn>
  getDeliverySettings: ReturnType<typeof vi.fn>
  getSurfaceSelection: ReturnType<typeof vi.fn>
  setSurfaceSelection: ReturnType<typeof vi.fn>
  productsInvoke: ReturnType<typeof vi.fn>
}

function install(overrides: Partial<Stubs> = {}): Stubs {
  const stubs: Stubs = {
    getChannelEvents: vi.fn(async () => ({ [IDS.signal]: true, [IDS.briefing]: true, [IDS.macro]: true })),
    setChannelEvent: vi.fn(async (eventId: string, enabled: boolean) => ({ eventId, enabled })),
    getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, desktopEnabled: false, pushWired: true, channels: [], lastPushFailureAt: null, lastPushFailureReason: null })),
    getSurfaceSelection: vi.fn(async () => ({ key: 'calendar-events', available: ['channel', 'toast'], selection: { channel: true, toast: true }, conflict: false })),
    setSurfaceSelection: vi.fn(async () => ({ key: 'calendar-events', available: ['channel', 'toast'], selection: { channel: true, toast: true }, conflict: false })),
    productsInvoke: vi.fn(async (_productId: string, method: string) => {
      if (String(method).includes('getCalendarReminderSettings')) {
        return { enabled: false, leadMinutes: 60, importance: ['high'], landedFilter: 'surprise-only' }
      }
      if (String(method).includes('setCalendarReminderSettings')) {
        return { enabled: true, leadMinutes: 60, importance: ['high'], landedFilter: 'surprise-only' }
      }
      return { enabled: false }
    }),
    ...overrides
  }
  ;(window as unknown as { platform: unknown }).platform = {
    notifications: {
      getChannelEvents: stubs.getChannelEvents,
      setChannelEvent: stubs.setChannelEvent,
      getDeliverySettings: stubs.getDeliverySettings,
      getSurfaceSelection: stubs.getSurfaceSelection,
      setSurfaceSelection: stubs.setSurfaceSelection
    },
    products: { invoke: stubs.productsInvoke }
  }
  return stubs
}

let root: Root | undefined
let container: HTMLDivElement | undefined

async function render(focusEntityId?: string): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <ShellLanguageProvider language="zh-CN">
        <IntelligenceNotificationSettingsSection {...(focusEntityId === undefined ? {} : { focusEntityId })} />
      </ShellLanguageProvider>
    )
  })
  await act(async () => { await Promise.resolve() })
  return container
}

function listItems(): HTMLButtonElement[] {
  return [...(container?.querySelectorAll<HTMLButtonElement>('.intelligence-notification-list-item') ?? [])]
}

async function selectItem(index: number): Promise<void> {
  await act(async () => { listItems()[index]?.click(); await Promise.resolve() })
}

beforeEach(() => {
  // 宽窗是默认形态；只有那条窄窗用例会把它改小。
  window.innerWidth = 1280
  install()
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
  delete (window as unknown as { platform?: unknown }).platform
  vi.restoreAllMocks()
})

describe('intelligence notification settings', () => {
  it('lists four items, selects the first, and folds the landed notice into the calendar item', async () => {
    await render()
    const names = listItems().map((item) => item.querySelector('.intelligence-notification-list-name')?.textContent)
    expect(names).toEqual([
      text['pages.intelligence.notification.rows.signalTriggered.title'],
      text['pages.intelligence.notification.rows.briefingReady.title'],
      text['pages.intelligence.notification.rows.sentimentAlert.title'],
      text['pages.intelligence.notification.rows.calendar.title']
    ])
    // 「宏观事件落地」不再单独占一项——它就是「日历事件 → 发生后」。
    expect(names).not.toContain(text['pages.intelligence.notification.rows.macroEventLanded.title'])
    expect(listItems()[0]?.getAttribute('aria-current')).toBe('true')
  })

  it('shows the calendar detail with the timeline, one surface choice and both segments', async () => {
    await render()
    await selectItem(3)
    const body = container?.textContent ?? ''
    expect(body).toContain(text['pages.intelligence.notification.calendar.timeline'])
    expect(body).toContain(text['pages.intelligence.notification.calendar.surfaces'])
    expect(body).toContain(text['pages.intelligence.notification.surface.channel'])
    expect(body).toContain(text['pages.intelligence.notification.surface.toast'])
    expect(body).toContain(text['pages.intelligence.notification.calendar.before'])
    expect(body).toContain(text['pages.intelligence.notification.calendar.after'])
    // 桌面两条都没批 → 这一项的详情里根本不该出现桌面（页脚那句是另一件事）。
    const detail = container?.querySelector('.intelligence-notification-calendar')?.textContent ?? ''
    expect(detail).not.toContain('桌面')
  })

  it('lands on the matching item when the notification centre sends the reader here', async () => {
    // 从「去设置」进来：日历相关落「日历事件」，内容类落它自己那一项，认不出落第一项。
    await render('market-intelligence.calendar.event-upcoming')
    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.calendar.timeline'])
  })

  it('falls back to the first item when the target cannot be located', async () => {
    await render('platform.something-else')
    expect(listItems()[0]?.getAttribute('aria-current')).toBe('true')
  })

  it('turns the list into a dropdown on a narrow window, with the name and the state in the option text', async () => {
    // 窄窗下换控件而不是压缩：列表 → 下拉；名字与状态都进选项文本（图标认不出是哪一条）。
    window.innerWidth = 1000
    await render()
    expect(container?.querySelector('.intelligence-notification-list')).toBeNull()
    const select = container?.querySelector('select')
    expect(select).not.toBeNull()
    const options = [...(select?.querySelectorAll('option') ?? [])]
    expect(options).toHaveLength(4)
    expect(options[3]?.textContent).toContain(text['pages.intelligence.notification.rows.calendar.title'])
    expect(options[3]?.textContent).toContain(text['pages.intelligence.notification.status.off'])

    await act(async () => {
      if (select) { (select as HTMLSelectElement).value = 'calendar'; select.dispatchEvent(new Event('change', { bubbles: true })) }
      await Promise.resolve()
    })
    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.calendar.timeline'])
    window.innerWidth = 1280
  })

  it('collapses the lead and importance controls while the reminder is off and says what would happen', async () => {
    await render()
    await selectItem(3)
    const detail = container?.querySelector('.intelligence-notification-calendar')?.textContent ?? ''
    expect(detail).toContain(text['pages.intelligence.notification.calendar.summary'].replace('{lead}', '1 小时').replace('{importance}', '高'))
    // 关着不画禁用控件：提前量/重要性控件都不出现（文案里引用了「提前多久」这句不算）。
    expect(container?.querySelectorAll('input[name="calendar-reminder-lead"]')).toHaveLength(0)
    expect([...container!.querySelectorAll('legend')].some((legend) =>
      legend.textContent === text['pages.intelligence.notification.calendar.importance'])).toBe(false)
  })

  it('warns in place when a ticked surface has its master switch off, and never greys the checkbox', async () => {
    install({ getDeliverySettings: vi.fn(async () => ({ toastEnabled: false, desktopEnabled: false, pushWired: true, channels: [], lastPushFailureAt: null, lastPushFailureReason: null })) })
    await render()
    await selectItem(3)
    const toastBox = [...container!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.closest('label')?.textContent?.includes(text['pages.intelligence.notification.surface.toast']!))
    expect(toastBox?.checked).toBe(true)
    expect(toastBox?.disabled).toBe(false)
    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.surfaceBlocked.toast'])
  })

  it('shows the cost line only when "also matched" is chosen', async () => {
    install({
      productsInvoke: vi.fn(async (_productId: string, method: string) => {
        if (String(method).includes('getCalendarReminderSettings')) {
          return { enabled: false, leadMinutes: 60, importance: ['high'], landedFilter: 'also-matched' }
        }
        return { enabled: false }
      })
    })
    await render()
    await selectItem(3)
    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.landed.cost'])
  })
})
