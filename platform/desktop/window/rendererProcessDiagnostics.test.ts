import { EventEmitter } from 'node:events'

import type { BrowserWindow, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import {
  registerRendererProcessDiagnosticListener,
  resetRendererProcessDiagnosticListenersForTests,
  wireRendererProcessDiagnostics
} from './rendererProcessDiagnostics'

type MockWebContents = EventEmitter & {
  isDestroyed: () => boolean
  reloadIgnoringCache: () => void
}

function createMockWindow() {
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    reloadIgnoringCache: vi.fn()
  }) as MockWebContents

  return Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: () => false
  }) as unknown as BrowserWindow & { webContents: MockWebContents }
}

describe('wireRendererProcessDiagnostics', () => {
  it('forwards host lifecycle evidence through the generic diagnostic listener seam', () => {
    resetRendererProcessDiagnosticListenersForTests()
    const window = createMockWindow()
    const listener = vi.fn()
    const unsubscribe = registerRendererProcessDiagnosticListener(listener)

    wireRendererProcessDiagnostics(window, {
      now: () => '2026-07-10T14:00:00.000Z',
      scheduleReload: () => undefined
    })
    window.emit('unresponsive')

    expect(listener).toHaveBeenCalledWith({
      timestamp: '2026-07-10T14:00:00.000Z',
      event: 'unresponsive'
    })
    unsubscribe()
  })

  it('logs renderer exits and reloads a crashed renderer once', () => {
    const window = createMockWindow()
    const logEvent = vi.fn()

    wireRendererProcessDiagnostics(window, {
      logEvent,
      now: () => '2026-07-10T14:00:00.000Z',
      scheduleReload: (reload) => reload()
    })

    window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 9 })

    expect(logEvent).toHaveBeenCalledWith({
      timestamp: '2026-07-10T14:00:00.000Z',
      event: 'render-process-gone',
      reason: 'crashed',
      exitCode: 9
    })
    expect(window.webContents.reloadIgnoringCache).toHaveBeenCalledTimes(1)
  })

  it('logs warning and error console messages from the renderer', () => {
    const window = createMockWindow()
    const logEvent = vi.fn()

    wireRendererProcessDiagnostics(window, {
      logEvent,
      now: () => '2026-07-10T14:00:00.000Z'
    })

    window.webContents.emit('console-message', {
      level: 'warning',
      message: 'nested button',
      lineNumber: 42,
      sourceId: 'http://localhost:5173/app.js',
      frame: {
        url: 'http://localhost:5173/index.html',
        routingId: 7,
        processId: 11,
        extra: 'ignored'
      }
    })

    expect(logEvent).toHaveBeenCalledWith({
      timestamp: '2026-07-10T14:00:00.000Z',
      event: 'console-message',
      level: 'warning',
      message: 'nested button',
      lineNumber: 42,
      sourceId: 'http://localhost:5173/app.js',
      frame: {
        url: 'http://localhost:5173/index.html',
        routingId: 7,
        processId: 11
      }
    })
  })
})
