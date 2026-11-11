// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { clearAllWriteFailures } from './channelEventWriteFailures'
import { NotificationDrawerScreen } from './NotificationDrawerScreen'
import { intelligenceNotificationText } from './text'

/**
 * 换位置不是减功能（用户 2026-11-11）：平台通知页撤掉之前，抽屉必须补上两档——
 *
 * 1. **日历关着时**：抽屉仍显示已存值摘要（关闭 + 提前量 + 重要性），并且「测试发生后」**仍可点**
 *    （平台 `calendarDetail.tsx` 只按 `reminder.value === undefined` 禁用，不看组开关）；
 * 2. **舆情关着时**：抽屉仍能选到「最低强度」那一项（灰着 + 一句「先打开舆情提醒」），
 *    不能只留给「已经打开」的人。
 *
 * 反向判据：把这两块改回「关着就整块不出现」，两条用例都红。
 */
const text = intelligenceNotificationText['zh-CN']
let root: Root | undefined

beforeEach(() => { clearAllWriteFailures() })
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  vi.restoreAllMocks()
})

type Stubs = {
  sendTest: Mock<(payload?: unknown) => Promise<unknown>>
  setThreshold: ReturnType<typeof vi.fn>
}

function install(input: Readonly<{ calendarEnabled: boolean; outletEnabled: boolean }>): Stubs {
  const sendTest = vi.fn(async (_payload: unknown) => ({ state: 'sent' as const, channelId: 'slack', channelName: 'Slack' }))
  const setThreshold = vi.fn(async (_payload: unknown) => ({ pushThreshold: 'medium' }))
  ;(window as unknown as { platform: unknown }).platform = {
    notifications: {
      getChannelEvents: vi.fn(async () => ({})),
      setChannelEvent: vi.fn(async (eventId: string, enabled: boolean) => ({ eventId, enabled })),
      getDeliverySettings: vi.fn(async () => ({
        toastEnabled: true,
        desktopEnabled: false,
        pushWired: true,
        channels: [{ deliverable: true }],
        lastPushFailureAt: null,
        lastPushFailureReason: null,
        lastDelivery: null
      })),
      getSurfaceSelection: vi.fn(async () => ({
        key: 'calendar-events',
        available: ['channel', 'toast'],
        selection: { channel: true },
        conflict: false
      })),
      setSurfaceSelection: vi.fn(async () => undefined)
    },
    products: {
      invoke: vi.fn(async (_productId: string, method: string, payload?: unknown) => {
        if (String(method).includes('sendTestNotification')) return sendTest(payload)
        if (String(method).includes('getNewsPushThreshold')) return { pushThreshold: 'medium' }
        if (String(method).includes('saveNewsPushThreshold')) return setThreshold(payload)
        if (String(method).includes('getNewsPushOutletState')) return { enabled: input.outletEnabled }
        if (String(method).includes('getCalendarReminderSettings')) {
          return {
            enabled: input.calendarEnabled,
            leadMinutes: 60,
            importance: ['high'],
            landedFilter: 'surprise-only'
          }
        }
        return { enabled: false }
      })
    }
  }
  return { sendTest, setThreshold }
}

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <NotificationDrawerScreen />
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

function buttonWithText(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === label)
}

describe('抽屉 · 日历关着也不丢「看已存值」和「测试发生后」', () => {
  it('shows the stored summary and keeps the landed test clickable while the group is off', async () => {
    const { sendTest } = install({ calendarEnabled: false, outletEnabled: false })
    const container = await render()

    // 摘要 = 关闭 + 提前量 + 重要性，与平台那一屏同一句（同一批键，不另写一份）。
    const summary = container.querySelector<HTMLElement>('[data-calendar-summary="true"]')
    expect(summary?.textContent).toBe([
      text['pages.intelligence.notification.status.off'],
      text['pages.intelligence.notification.leads.60'],
      text['pages.intelligence.notification.importance.high']
    ].join(text['pages.intelligence.notification.joiner']))

    // 「测试发生后」仍可点：平台的判据只有「读不到设置」，不看组开关。
    const landed = buttonWithText(container, text['pages.intelligence.notification.test.calendarLanded'] ?? '')
    expect(landed).toBeDefined()
    expect(landed?.disabled).toBe(false)
    await act(async () => { landed?.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(sendTest).toHaveBeenCalledWith({ kind: 'calendar-landed' })
  })

  it('does not print the summary while the group is on', async () => {
    install({ calendarEnabled: true, outletEnabled: false })
    const container = await render()
    expect(container.querySelector('[data-calendar-summary="true"]')).toBeNull()
  })
})

/** 点开某一行标签旁的 ⓘ，读**它自己**指向的浮层内容（浮层挂在 body 的 overlay 容器里）。 */
async function openRowInfo(ariaLabel: string): Promise<string> {
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.getAttribute('aria-label') === ariaLabel)
  expect(trigger, `row info trigger: ${ariaLabel}`).toBeDefined()
  await act(async () => { trigger!.click() })
  await act(async () => { await Promise.resolve() })
  const describedBy = trigger!.getAttribute('aria-describedby') ?? ''
  const node = describedBy.split(' ').map((id) => document.getElementById(id)).find((each) => each !== null)
  return node?.textContent ?? ''
}

describe('抽屉 · 舆情关着也能选到最低强度', () => {
  it('keeps the threshold row and disables it, with the reason behind the row ⓘ, not in the body', async () => {
    install({ calendarEnabled: false, outletEnabled: false })
    const container = await render()

    const row = container.querySelector<HTMLElement>('[data-setting-key="setting:notifications.push-threshold"]')
    expect(row).not.toBeNull()
    // 只看分段控件本身（行里还有一颗 ⓘ，不是这一项的控件）。
    const choices = [...(row?.querySelectorAll<HTMLButtonElement>('.segmented button') ?? [])]
    expect(choices.length).toBeGreaterThan(0)
    for (const choice of choices) expect(choice.disabled).toBe(true)

    // 正文只留字段名与控件：那句解释不进正文，进这一行的 ⓘ（用户口径，`check:body-prose` 守的就是它）。
    const note = text['pages.intelligence.notification.threshold.disabledNote']!
    expect(row?.textContent).not.toContain(note)
    expect(await openRowInfo(text['pages.intelligence.notification.threshold.aria']!)).toContain(note)
  })

  it('keeps the threshold editable while the alert is on', async () => {
    install({ calendarEnabled: false, outletEnabled: true })
    const container = await render()
    const row = container.querySelector<HTMLElement>('[data-setting-key="setting:notifications.push-threshold"]')
    const choices = [...(row?.querySelectorAll<HTMLButtonElement>('.segmented button') ?? [])]
    expect(choices.length).toBeGreaterThan(0)
    expect(choices.some((choice) => choice.disabled)).toBe(false)
    // 关着才成立的那句解释，开着时连 ⓘ 里也不该出现（否则它就变成一句常驻的假前提）。
    const note = text['pages.intelligence.notification.threshold.disabledNote']!
    expect(row?.textContent).not.toContain(note)
    expect(await openRowInfo(text['pages.intelligence.notification.threshold.aria']!)).not.toContain(note)
  })
})
