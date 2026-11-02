import { describe, expect, it } from 'vitest'

import type { StorageIpcPorts } from './storageIpc'

const { registerStorageIpc } = await import('./storageIpc')

const EXPECTED_CHANNELS = [
  'platform:product-summaries',
  'platform:external-apps-list-installed',
  'platform:external-apps-launch-workspace',
  'platform:storage-list-caches',
  'platform:storage-inspect-cache',
  'platform:storage-clear-cache',
  'platform:storage-compact-cache',
  'platform:storage-list-cache-operations'
]

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

function ports(overrides: Partial<StorageIpcPorts> = {}): StorageIpcPorts {
  const noop = async () => undefined
  return {
    cacheGovernance: {
      listCaches: noop,
      inspectCache: noop,
      clearCache: noop,
      compactCache: noop,
      listOperations: noop
    },
    externalApps: { listInstalledAppViews: async () => [], launchWorkspace: async () => undefined },
    summarizeProducts: () => [],
    ...overrides
  }
}

describe('storage ipc surface', () => {
  it('registers exactly the eight storage/product/external-app channels, in order', () => {
    const { channels, ipcMain } = record()
    registerStorageIpc(ipcMain as never, ports())

    expect(channels).toEqual(EXPECTED_CHANNELS)
  })

  it('keeps the snapshot in step with the source', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./storageIpc.ts', import.meta.url), 'utf8')
    const referenced = [...source.matchAll(/IpcChannels\.(\w+)/gu)].map((match) => match[1])

    const { IpcChannels } = await import('../../ipc/channels')
    const names = [...new Set(referenced)].map((key) => (IpcChannels as Record<string, string>)[key])
    expect(names.sort()).toEqual([...EXPECTED_CHANNELS].sort())
  })

  it('keeps validating the launch request before handing it to the service', async () => {
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    registerStorageIpc(
      { handle: (channel: string, listener: (...args: unknown[]) => unknown) => listeners.set(channel, listener) } as never,
      ports()
    )

    // 校验是同步抛的：handler 本体不包 try，真实 ipcMain 会把它转成 invoke 的 reject。
    expect(() => listeners.get('platform:external-apps-launch-workspace')!({}, { protocol: 'https://' })).toThrow()
  })
})
