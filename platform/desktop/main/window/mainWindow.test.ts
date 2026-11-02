import { describe, expect, it, vi } from 'vitest'

const events = vi.hoisted(() => [] as string[])

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: (sender: { window?: unknown }) => sender.window ?? null
  }
}))
vi.mock('../../window/safeRendererSend', () => ({
  wireRendererSendGuard: () => { events.push('send-guard') }
}))
vi.mock('../../window/rendererProcessDiagnostics', () => ({
  wireRendererProcessDiagnostics: (_window: unknown, options: { logEvent: () => void }) => {
    events.push('diagnostics')
    options.logEvent()
  }
}))
vi.mock('../../window/windowChrome', () => ({
  wireWindowChromeState: () => { events.push('chrome') }
}))

const { createMainWindowHost } = await import('./mainWindow')

type FakeWindow = {
  webContents: { id: number }
  destroyed: boolean
  listeners: Map<string, Array<() => void>>
  on: (event: string, listener: () => void) => void
  isDestroyed: () => boolean
}

function fakeWindow(id = 42): FakeWindow {
  const window: FakeWindow = {
    webContents: { id },
    destroyed: false,
    listeners: new Map(),
    on: (event, listener) => {
      window.listeners.set(event, [...(window.listeners.get(event) ?? []), listener])
    },
    isDestroyed: () => window.destroyed
  }
  return window
}

describe('main window host', () => {
  it('creates and wires in the documented order, and does not load the renderer yet', async () => {
    const window = fakeWindow()
    const host = createMainWindowHost({
      createWindow: async () => { events.push('create'); return window as never },
      loadRenderer: async () => { events.push('load') },
      logRendererEvent: () => { events.push('log') },
      getWorkspace: () => null
    })

    await host.createAndWire()

    // 建窗 → 发送守卫 → 渲染进程诊断 → 标题栏广播；加载渲染器是第二个时机，必须还没发生。
    expect(events).toEqual(['create', 'send-guard', 'diagnostics', 'log', 'chrome'])
    expect(host.getMainWindow()).toBe(window)
    expect(window.listeners.get('closed')).toHaveLength(1)
  })

  it('loads, registers and mounts the workspace only when loadAndMount runs', async () => {
    events.length = 0
    const window = fakeWindow()
    const host = createMainWindowHost({
      createWindow: async () => window as never,
      loadRenderer: async () => { events.push('load') },
      logRendererEvent: () => undefined,
      getWorkspace: () => ({
        registerMainWindow: () => { events.push('register') },
        attachMainWindow: () => { events.push('attach') }
      })
    })

    await host.createAndWire()
    await host.loadAndMount()

    expect(events.filter((event) => ['load', 'register', 'attach'].includes(event))).toEqual([
      'load',
      'register',
      'attach'
    ])
  })

  it('clears the reference when the window closes and resolves the invoking window from the event', async () => {
    const window = fakeWindow()
    const host = createMainWindowHost({
      createWindow: async () => window as never,
      loadRenderer: async () => undefined,
      logRendererEvent: () => undefined,
      getWorkspace: () => null
    })
    await host.createAndWire()

    for (const listener of window.listeners.get('closed') ?? []) listener()
    expect(host.getMainWindow()).toBeNull()

    const caller = fakeWindow(7)
    expect(host.resolveInvokingWindow({ sender: { window: caller } } as never)).toBe(caller)
    caller.destroyed = true
    expect(host.resolveInvokingWindow({ sender: { window: caller } } as never)).toBeNull()
  })

  it('skips the workspace step when the composition is not there yet', async () => {
    events.length = 0
    const window = fakeWindow()
    const host = createMainWindowHost({
      createWindow: async () => window as never,
      loadRenderer: async () => { events.push('load') },
      logRendererEvent: () => undefined,
      getWorkspace: () => null
    })
    await host.createAndWire()
    await host.loadAndMount()

    expect(events.filter((event) => event === 'load')).toHaveLength(1)
    expect(events).not.toContain('register')
  })
})
