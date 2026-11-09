import { describe, expect, it, vi } from 'vitest'

import { createDefaultAppSettings } from '../../../settings/schema/appSettings'

import type { SettingsIpcPorts } from './settingsIpc'
import type { SettingsStartupReadState } from '../../../settings/store/settingsStore'

// settingsIpc 会经 applySessionProxySettings 触碰 electron session：给一个最小替身，
// 让用例只验证「搬过来的顺序与副作用」，不依赖真实会话。
vi.mock('electron', () => ({
  session: {
    defaultSession: {
      setProxy: vi.fn(async () => undefined),
      forceReloadProxyConfig: vi.fn(async () => undefined),
      closeAllConnections: vi.fn(async () => undefined)
    }
  }
}))

const { registerSettingsIpc } = await import('./settingsIpc')

const EXPECTED_CHANNELS = ['platform:settings-get', 'platform:settings-update', 'platform:settings-recovery']

function record(): { channels: string[]; ipcMain: { handle: (channel: string, listener: unknown) => void } } {
  const channels: string[] = []
  return {
    channels,
    ipcMain: {
      handle: (channel: string) => {
        // 真实 ipcMain 对同名通道会抛错；recorder 必须模拟这条，否则重复注册会被静默吞掉。
        if (channels.includes(channel)) throw new Error(`duplicate channel: ${channel}`)
        channels.push(channel)
      }
    }
  }
}

function ports(overrides: Partial<SettingsIpcPorts> = {}) {
  const settings = {
    values: createDefaultAppSettings(),
    get: vi.fn(async () => settings.values),
    update: vi.fn(async (patch: Record<string, unknown>) => {
      settings.values = { ...settings.values, ...patch }
      return settings.values
    }),
    notifyCommitted: vi.fn(),
    // 启动降级面：默认桩子模拟「正常读到了」；降级用例单独覆盖。
    readStartup: vi.fn(async () => settings.values),
    startupState: vi.fn<() => SettingsStartupReadState>(() => ({ unreadable: false, copyPath: null })),
    retryStartupRead: vi.fn<() => Promise<SettingsStartupReadState>>(async () => ({ unreadable: false, copyPath: null })),
    resetAfterUnreadable: vi.fn(async () => settings.values)
  }
  const base: SettingsIpcPorts = {
    settings,
    ensureDefaultAssistantSeed: vi.fn(async () => undefined),
    refreshBuiltinSeedCopy: vi.fn(async () => undefined),
    refreshShellTimeZone: vi.fn(async () => 'UTC'),
    notifyPreferencesChanged: vi.fn()
  }
  return { settings, ports: { ...base, ...overrides } }
}

describe('settings ipc surface', () => {
  it('registers exactly the three settings channels, in order', () => {
    const { channels, ipcMain } = record()
    registerSettingsIpc(ipcMain as never, ports().ports)

    expect(channels).toEqual(EXPECTED_CHANNELS)
  })

  it('keeps a language save driving the seed copy, the zone refresh and one preference notification', async () => {
    const { ports: p } = ports()
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    registerSettingsIpc(
      { handle: (channel: string, listener: (...args: unknown[]) => unknown) => listeners.set(channel, listener) } as never,
      p
    )

    await listeners.get('platform:settings-update')!({}, { language: 'en-US' })

    expect(p.ensureDefaultAssistantSeed).toHaveBeenCalledOnce()
    expect(p.refreshBuiltinSeedCopy).toHaveBeenCalledWith('en-US')
    expect(p.refreshShellTimeZone).toHaveBeenCalledOnce()
    expect(p.notifyPreferencesChanged).toHaveBeenCalledOnce()
    expect(p.settings.notifyCommitted).toHaveBeenCalledOnce()
  })

  it('answers the startup recovery surface without throwing on a still-broken file', async () => {
    const { settings, ports: p } = ports()
    const state: SettingsStartupReadState = { unreadable: true, copyPath: '/tmp/settings.json.corrupt-1' }
    settings.startupState.mockReturnValue(state)
    settings.retryStartupRead.mockResolvedValue(state)
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    registerSettingsIpc(
      { handle: (channel: string, listener: (...args: unknown[]) => unknown) => listeners.set(channel, listener) } as never,
      p
    )
    const recovery = listeners.get('platform:settings-recovery')!

    await expect(recovery({}, 'state')).resolves.toEqual(state)
    // 重试仍然失败：把状态原样返回，不抛。
    await expect(recovery({}, 'retry')).resolves.toEqual(state)
    // 未知动作要显式失败，不能静默当成 state。
    await expect(recovery({}, 'drop-everything')).rejects.toThrow('settings-recovery-unknown-action')
  })

  it('rebuilds the settings file only on the explicit reset action, then re-applies side effects', async () => {
    const { settings, ports: p } = ports()
    settings.resetAfterUnreadable.mockResolvedValue(createDefaultAppSettings())
    settings.startupState.mockReturnValue({ unreadable: false, copyPath: null })
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    registerSettingsIpc(
      { handle: (channel: string, listener: (...args: unknown[]) => unknown) => listeners.set(channel, listener) } as never,
      p
    )

    await listeners.get('platform:settings-recovery')!({}, 'reset')

    expect(settings.resetAfterUnreadable).toHaveBeenCalledOnce()
    expect(p.refreshShellTimeZone).toHaveBeenCalledOnce()
    expect(p.notifyPreferencesChanged).toHaveBeenCalledOnce()
    expect(settings.notifyCommitted).toHaveBeenCalledOnce()
  })

  it('validates the proxy address before anything is written', async () => {
    const { settings, ports: p } = ports()
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    registerSettingsIpc(
      { handle: (channel: string, listener: (...args: unknown[]) => unknown) => listeners.set(channel, listener) } as never,
      p
    )

    await expect(
      listeners.get('platform:settings-update')!({}, { network: { proxyMode: 'custom', proxyUrl: 'myproxy', proxyBypassRules: '' } })
    ).rejects.toThrow(/proxy_settings_rejected/)
    expect(settings.update).not.toHaveBeenCalled()
    expect(settings.notifyCommitted).not.toHaveBeenCalled()
  })
})
