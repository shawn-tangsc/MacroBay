// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IntelligenceNotificationText } from './text'
import { clearAllWriteFailures } from './channelEventWriteFailures'
import { INTELLIGENCE_CHANNEL_EVENT_ROWS, useChannelEventSettings } from './useChannelEventSettings'

/**
 * 「这一行没存上」的记录必须活到写成功——抽屉里没有「取消」，读者反悔只能关抽屉；
 * 提示要是关一次就没了，读者连退路都看不见。
 *
 * 它是**模块级表**，所以测试之间会串：每个用例前清空，另有一条用例专门证明清空之后
 * 不会把上一例的失败带到下一例。
 */
const EVENT_ID = INTELLIGENCE_CHANNEL_EVENT_ROWS[0]!.eventId

let root: Root | undefined
let latest: ReturnType<typeof useChannelEventSettings> | undefined

function Probe(): null {
  latest = useChannelEventSettings()
  return null
}

function install(channelEvents: Record<string, boolean>, setChannelEvent: (eventId: string, enabled: boolean) => Promise<unknown>): void {
  ;(window as unknown as { platform: unknown }).platform = {
    notifications: {
      getChannelEvents: vi.fn(async () => channelEvents),
      getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, desktopEnabled: false, pushWired: true, channels: [{ deliverable: true }], lastPushFailureAt: null, lastPushFailureReason: null })),
      setChannelEvent: vi.fn(setChannelEvent)
    },
    products: { invoke: vi.fn(async () => undefined) }
  }
}

async function mount(): Promise<void> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root?.render(<Probe />) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

async function unmount(): Promise<void> {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  latest = undefined
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

beforeEach(() => {
  clearAllWriteFailures()
})

afterEach(async () => {
  await unmount()
  Reflect.deleteProperty(window, 'platform')
  vi.restoreAllMocks()
})

describe('a failed notification write survives leaving the screen', () => {
  it('keeps the failed row after the screen is unmounted and opened again', async () => {
    install({ [EVENT_ID]: false }, async () => { throw new Error('ipc failed') })
    await mount()
    await act(async () => { latest?.toggle(EVENT_ID, true) })
    await flush()
    expect(latest?.failedEventIds.has(EVENT_ID)).toBe(true)

    await unmount()
    // 重新进来：平台的读还是旧值（写没成功），提示不能因此消失。
    await mount()
    expect(latest?.failedEventIds.has(EVENT_ID)).toBe(true)
  })

  it('clears the row once the platform already reports the value the reader wanted', async () => {
    install({ [EVENT_ID]: false }, async () => { throw new Error('ipc failed') })
    await mount()
    await act(async () => { latest?.toggle(EVENT_ID, true) })
    await flush()
    expect(latest?.failedEventIds.has(EVENT_ID)).toBe(true)

    await unmount()
    // 平台读回来的值已经等于当时想写的值 ⇒ 那次写其实生效了，别让不存在的失败挂着。
    install({ [EVENT_ID]: true }, async () => undefined)
    await mount()
    expect(latest?.failedEventIds.has(EVENT_ID)).toBe(false)
  })

  it('clears the row after a successful retry', async () => {
    let fail = true
    install({ [EVENT_ID]: false }, async () => {
      if (fail) throw new Error('ipc failed')
      return undefined
    })
    await mount()
    await act(async () => { latest?.toggle(EVENT_ID, true) })
    await flush()
    expect(latest?.failedEventIds.has(EVENT_ID)).toBe(true)

    fail = false
    await act(async () => { latest?.toggle(EVENT_ID, true) })
    await flush()
    expect(latest?.failedEventIds.has(EVENT_ID)).toBe(false)
  })

  it('does not leak a failure into the next case once the table is cleared', async () => {
    install({ [EVENT_ID]: false }, async () => { throw new Error('ipc failed') })
    await mount()
    await act(async () => { latest?.toggle(EVENT_ID, true) })
    await flush()
    expect(latest?.failedEventIds.has(EVENT_ID)).toBe(true)

    // 下一个用例开始前的清法（就是 `beforeEach` 那一行）：清完之后新挂载不该看到任何失败。
    clearAllWriteFailures()
    await unmount()
    await mount()
    expect(latest?.failedEventIds.has(EVENT_ID)).toBe(false)
  })
})

// 让类型检查知道这份文案表在别处被引用（测试不解析句子，这里只借键名）。
export type UsesNotificationText = IntelligenceNotificationText
