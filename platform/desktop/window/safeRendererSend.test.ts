import { EventEmitter } from 'node:events'

import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { resetRendererUnavailableListenersForTests } from './rendererLifecycle'
import { safeWebContentsSend, wireRendererSendGuard } from './safeRendererSend'

type MockWebContents = EventEmitter & {
  isDestroyed: () => boolean
  isLoading: () => boolean
  send: (...args: unknown[]) => void
}

function createMockWebContents(options?: {
  destroyed?: boolean
  loading?: boolean
  send?: (...args: unknown[]) => void
}): MockWebContents {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isDestroyed: () => options?.destroyed ?? false,
    isLoading: () => options?.loading ?? false,
    send: options?.send ?? vi.fn()
  })
}

describe('safeWebContentsSend', () => {
  it('skips send while renderer is loading', () => {
    const send = vi.fn()
    const webContents = createMockWebContents({ loading: true, send })
    webContents.emit('did-finish-load')

    expect(safeWebContentsSend(webContents as unknown as import('electron').WebContents, 'channel', { ok: true })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('sends after renderer finishes loading', () => {
    const send = vi.fn()
    const webContents = createMockWebContents({ send })
    const window = { webContents, isDestroyed: () => false } as BrowserWindow

    wireRendererSendGuard(window)
    webContents.emit('did-finish-load')

    expect(safeWebContentsSend(webContents as unknown as import('electron').WebContents, 'channel', { ok: true })).toBe(true)
    expect(send).toHaveBeenCalledWith('channel', { ok: true })
  })

  it('skips send after renderer reload starts', () => {
    resetRendererUnavailableListenersForTests()
    const send = vi.fn()
    const webContents = createMockWebContents({ send })
    const window = { webContents, isDestroyed: () => false } as BrowserWindow

    wireRendererSendGuard(window)
    webContents.emit('did-finish-load')
    webContents.emit('did-start-loading')

    expect(safeWebContentsSend(webContents as unknown as import('electron').WebContents, 'channel', { ok: true })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
