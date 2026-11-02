import { describe, expect, it } from 'vitest'

import type { WebIpcPorts } from './webIpc'

const { registerWebIpc } = await import('./webIpc')

const EXPECTED_CHANNELS = [
  'platform:web-search-list-providers',
  'platform:web-search-get-settings',
  'platform:web-search-update-settings',
  'platform:web-search-update-provider',
  'platform:web-search-reveal-provider-api-key',
  'platform:web-search-check-provider',
  'platform:web-search-search-keywords',
  'platform:web-search-fetch-urls'
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

function ports(): WebIpcPorts {
  const noop = async () => undefined
  return {
    webSearch: {
      listProviders: noop,
      getSettings: noop,
      updateSettings: noop,
      updateProvider: noop,
      revealProviderApiKey: noop,
      checkProvider: noop,
      searchKeywords: noop,
      fetchUrls: noop
    }
  }
}

describe('web ipc surface', () => {
  it('registers exactly the eight web search channels, in order', () => {
    const { channels, ipcMain } = record()
    registerWebIpc(ipcMain as never, ports())

    expect(channels).toEqual(EXPECTED_CHANNELS)
  })

  it('keeps the snapshot in step with the source', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./webIpc.ts', import.meta.url), 'utf8')
    const referenced = [...source.matchAll(/IpcChannels\.(\w+)/gu)].map((match) => match[1])

    const { IpcChannels } = await import('../../ipc/channels')
    const names = [...new Set(referenced)].map((key) => (IpcChannels as Record<string, string>)[key])
    expect(names.sort()).toEqual([...EXPECTED_CHANNELS].sort())
  })

  it('passes the raw payload through, so validation stays in the handler owner', async () => {
    const listeners = new Map<string, (...args: unknown[]) => unknown>()
    const seen: unknown[] = []
    registerWebIpc(
      { handle: (channel: string, listener: (...args: unknown[]) => unknown) => listeners.set(channel, listener) } as never,
      { webSearch: { ...ports().webSearch, fetchUrls: async (input) => { seen.push(input) } } }
    )

    await listeners.get('platform:web-search-fetch-urls')!({}, { urls: ['https://example.test'] })

    expect(seen).toEqual([{ urls: ['https://example.test'] }])
  })
})
