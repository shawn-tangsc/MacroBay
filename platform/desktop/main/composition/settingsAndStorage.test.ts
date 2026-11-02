import { describe, expect, it, vi } from 'vitest'

import { createDefaultAppSettings } from '../../../settings/schema/appSettings'

import type { SettingsCompositionPorts } from './settingsAndStorage'

// settingsIpc 的保存路径要经 applySessionProxySettings 碰 electron session：给最小替身，
// 用例只验证「装配之后端口真的接上了」，不依赖真实会话。
vi.mock('electron', () => ({
  session: {
    defaultSession: {
      setProxy: vi.fn(async () => undefined),
      forceReloadProxyConfig: vi.fn(async () => undefined),
      closeAllConnections: vi.fn(async () => undefined)
    }
  }
}))

const { composeSettingsIpc, composeStorageIpc } = await import('./settingsAndStorage')

function record(): { channels: string[]; ipcMain: { handle: (channel: string, listener: unknown) => void } } {
  const channels: string[] = []
  return {
    channels,
    ipcMain: {
      handle: (channel: string) => {
        // 真实 ipcMain 对同名通道抛错；recorder 也要抛，否则重复注册会被静默吞掉。
        if (channels.includes(channel)) throw new Error(`duplicate channel: ${channel}`)
        channels.push(channel)
      }
    }
  }
}

function listening(): { listeners: Map<string, (...args: unknown[]) => unknown>; ipcMain: { handle: (c: string, l: (...args: unknown[]) => unknown) => void } } {
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  return { listeners, ipcMain: { handle: (channel, listener) => listeners.set(channel, listener) } }
}

function settingsPorts(overrides: Partial<SettingsCompositionPorts> = {}) {
  let values = createDefaultAppSettings()
  const host = { notifyPreferencesChanged: vi.fn() }
  const settings = {
    get: vi.fn(async () => values),
    update: vi.fn(async (patch: Record<string, unknown>) => {
      values = { ...values, ...patch } as typeof values
      return values
    }),
    notifyCommitted: vi.fn()
  }
  const base: SettingsCompositionPorts = {
    settings,
    ensureDefaultAssistantSeed: vi.fn(async () => undefined),
    refreshBuiltinSeedCopy: vi.fn(async () => undefined),
    refreshTimeZone: vi.fn(async () => 'UTC'),
    getWorkspaceForNotify: vi.fn(() => host)
  }
  return { settings, host, ports: { ...base, ...overrides } as SettingsCompositionPorts }
}

describe('settings and storage composition', () => {
  it('registers the settings channels in order through the composition', () => {
    const { channels, ipcMain } = record()
    composeSettingsIpc(ipcMain as never, settingsPorts().ports)

    expect(channels).toEqual(['platform:settings-get', 'platform:settings-update'])
  })

  it('a language save reaches the host that exists at that moment, once', async () => {
    // 这条替代的是原来读 app.ts 文本数「端口接线 + nativeTheme 两处」的断言里那一半：
    // 接线搬进本模块之后，唯一能证明「设置保存 → 现取宿主 → 通知一次」的是运行时调用。
    const { listeners, ipcMain } = listening()
    const { host, ports } = settingsPorts()
    composeSettingsIpc(ipcMain as never, ports)

    await listeners.get('platform:settings-update')!({}, { language: 'en-US' })

    expect(ports.getWorkspaceForNotify).toHaveBeenCalledOnce()
    expect(host.notifyPreferencesChanged).toHaveBeenCalledOnce()
    expect(ports.refreshTimeZone).toHaveBeenCalledOnce()
  })

  it('no live host means no delivery and no throw', async () => {
    const { listeners, ipcMain } = listening()
    const { ports } = settingsPorts({ getWorkspaceForNotify: vi.fn(() => null) })
    composeSettingsIpc(ipcMain as never, ports)

    await expect(listeners.get('platform:settings-update')!({}, { language: 'en-US' })).resolves.toBeTruthy()
  })

  it('composes the storage channels without touching the settings surface', () => {
    const { channels, ipcMain } = record()
    composeStorageIpc(ipcMain as never, {
      cacheGovernance: {} as never,
      summarizeProducts: vi.fn(() => ({ products: [], totals: { count: 0 } }))
    } as never)

    expect(channels).toHaveLength(8)
    expect(new Set(channels).size).toBe(8)
  })
})
