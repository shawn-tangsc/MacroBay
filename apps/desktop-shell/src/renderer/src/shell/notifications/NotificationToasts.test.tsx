// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NotificationCenterItem } from '@platform/notifications/contracts/notificationContracts'

import { platformText } from '../../i18n/platformText'

import { NotificationToasts, TOAST_VISIBLE_MS, type DeliveredNotification } from './NotificationToasts'

const labels = platformText['zh-CN'].notifications

let root: Root | undefined

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  vi.useRealTimers()
  document.body.replaceChildren()
  // 用例里临时装过 `window.platform`：不还原会漏到同进程的下一个测试文件，
  // 表现成「单跑全绿、一起跑红」，查起来最费时间。
  Reflect.deleteProperty(window, 'platform')
})

function record(overrides: Partial<NotificationCenterItem> & { id: string }): NotificationCenterItem {
  return {
    owner: 'platform',
    sourceId: 'platform.test',
    title: `任务失败：${overrides.id}`,
    body: '',
    severity: 'warning',
    priority: 'normal',
    channels: ['center', 'toast'],
    state: 'unread',
    actions: [],
    occurrenceCount: 1,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...overrides
  } as NotificationCenterItem
}

/** 手动推送投递事件：横幅只认事件，不轮询列表。 */
let emit: (delivery: DeliveredNotification) => void
let onOpen = vi.fn()

async function mount(): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <NotificationToasts
        labels={labels}
        onOpen={onOpen}
        subscribe={(callback) => {
          emit = callback
          return () => undefined
        }}
      />
    )
  })
}

function toasts(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('[data-notification-toast]')]
}

describe('右上角横幅', () => {
  it('投递事件一到就出现，画的是主进程已解析的那一句', async () => {
    await mount()
    expect(toasts()).toHaveLength(0)

    await act(async () => {
      emit({ channel: 'toast', record: record({ id: 't1', title: '任务失败：央行采集' }) })
    })

    expect(toasts()).toHaveLength(1)
    // 载荷里就是句子：横幅没有表可查，也就印不出 `notification.taskFailed.title`。
    expect(document.body.textContent).toContain('央行采集')
    expect(document.body.textContent).not.toContain('notification.')
  })

  it('读屏区是 polite 的：横幅不抢当前焦点', async () => {
    await mount()
    const region = document.body.querySelector('[data-notification-toasts]')
    expect(region?.getAttribute('aria-live')).toBe('polite')
    expect(region?.getAttribute('role')).toBe('status')
  })

  it('只画应用内提示这一档，弹窗那档不在这里冒充', async () => {
    await mount()

    await act(async () => {
      emit({ channel: 'popup', record: record({ id: 'p1' }) })
    })

    expect(toasts()).toHaveLength(0)
  })

  it('最多同时三条，超出先丢最旧的', async () => {
    await mount()

    await act(async () => {
      for (const id of ['a', 'b', 'c', 'd']) emit({ channel: 'toast', record: record({ id }) })
    })

    expect(toasts().map((node) => node.getAttribute('data-notification-toast'))).toEqual(['b', 'c', 'd'])
  })

  it('到时间自己消失；手动关也立刻消失', async () => {
    await mount()

    await act(async () => {
      emit({ channel: 'toast', record: record({ id: 'auto' }) })
    })
    expect(toasts()).toHaveLength(1)

    await act(async () => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS + 10)
    })
    expect(toasts()).toHaveLength(0)

    await act(async () => {
      emit({ channel: 'toast', record: record({ id: 'manual' }) })
    })
    const close = document.body.querySelector<HTMLButtonElement>('[data-notification-toast="manual"] button[aria-label]')
    expect(close).not.toBeNull()
    await act(async () => {
      close!.click()
      await Promise.resolve()
    })
    expect(toasts()).toHaveLength(0)
  })

  it('点条体打开通知中心：横幅消失不代表那条记录没了', async () => {
    await mount()

    await act(async () => {
      emit({ channel: 'toast', record: record({ id: 'open' }) })
    })
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-notification-toast="open"] .notification-toast-body')!.click()
      await Promise.resolve()
    })

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('点击横幅同时打开中心并标已读：弹过就算看过', async () => {
    const markRead = vi.fn(async () => undefined)
    const bridge = { markRead } as unknown as { markRead: (id: string) => Promise<unknown> }
    Object.defineProperty(window, 'platform', {
      value: { notifications: bridge },
      configurable: true
    })
    await mount()
    await act(async () => {
      emit({ channel: 'toast', record: record({ id: 't9' }) })
    })

    const body = document.querySelector<HTMLButtonElement>('.notification-toast-body')
    expect(body).not.toBeNull()
    await act(async () => {
      body!.click()
    })
    await act(async () => { await Promise.resolve() })

    // 两个效果都要有：开中心 + 标读；只开不标会让用户「弹过了还得再点开才算看过」。
    expect(onOpen).toHaveBeenCalled()
    expect(markRead).toHaveBeenCalledWith('t9')
  })
})
