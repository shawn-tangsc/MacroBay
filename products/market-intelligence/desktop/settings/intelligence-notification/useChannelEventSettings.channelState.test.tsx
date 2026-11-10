// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearAllWriteFailures } from './channelEventWriteFailures'
import { useChannelEventSettings } from './useChannelEventSettings'

/**
 * 「通道未就绪」横幅不能钉死在挂载那一刻：通道后来配好了，界面必须跟着变。
 * 平台层给一次「通道状态变化」广播，这里**只重读投递设置**——不是轮询，也不是每次渲染都读。
 */
let root: Root | undefined
let latest: ReturnType<typeof useChannelEventSettings> | undefined

function Probe(): null {
  latest = useChannelEventSettings()
  return null
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

const DELIVERABLE = [{ deliverable: true }]

function install(options: { ready: boolean }): {
  getDeliverySettings: ReturnType<typeof vi.fn>
  fire: () => void
  setReady: (value: boolean) => void
} {
  let ready = options.ready
  let listener: (() => void) | undefined
  const getDeliverySettings = vi.fn(async () => ({
    toastEnabled: true,
    desktopEnabled: false,
    pushWired: true,
    channels: ready ? DELIVERABLE : [],
    lastDelivery: null
  }))
  ;(window as unknown as { platform: unknown }).platform = {
    notifications: {
      getChannelEvents: vi.fn(async () => ({})),
      setChannelEvent: vi.fn(async () => undefined),
      getDeliverySettings,
      onChannelStateChanged: (callback: () => void) => {
        listener = callback
        return () => { listener = undefined }
      }
    },
    products: { invoke: vi.fn(async () => ({ enabled: false })) }
  }
  return {
    getDeliverySettings,
    fire: () => { listener?.() },
    // 通道后来配好了：读回可投递目标。
    setReady: (value: boolean) => { ready = value }
  }
}

beforeEach(() => { clearAllWriteFailures() })
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  latest = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  vi.restoreAllMocks()
})

async function mount(): Promise<void> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root?.render(<Probe />) })
  await flush()
}

describe('the channel-ready flag follows the platform broadcast', () => {
  it('re-reads the delivery settings on a channel state change, so the banner can go away', async () => {
    const harness = install({ ready: false })
    await mount()
    expect(latest?.channelReady).toBe(false)

    harness.setReady(true)
    await act(async () => { harness.fire() })
    await flush()
    expect(latest?.channelReady).toBe(true)
  })

  it('reads the delivery settings once on mount and never on re-render (no polling)', async () => {
    const harness = install({ ready: true })
    await mount()
    expect(harness.getDeliverySettings).toHaveBeenCalledTimes(1)
    // 强制重渲染：仍然只有挂载那一次读。
    await act(async () => { root?.render(<Probe />) })
    await flush()
    expect(harness.getDeliverySettings).toHaveBeenCalledTimes(1)
  })
})
