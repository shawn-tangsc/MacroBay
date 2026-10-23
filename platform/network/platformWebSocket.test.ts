import { describe, expect, it, vi } from 'vitest'

import type { NetworkSettings } from '../settings/schema/appSettings'

import { createPlatformWebSocketFactory, resolveWebSocketProxyUrl } from './platformWebSocket'

const customSocksNetwork: NetworkSettings = {
  proxyMode: 'custom',
  proxyUrl: 'socks5://127.0.0.1:6153',
  proxyBypassRules: 'localhost,127.0.0.1,::1'
}

describe('platformWebSocket', () => {
  it('resolves custom proxy settings for WebSocket urls', async () => {
    await expect(resolveWebSocketProxyUrl('wss://fstream.binance.com/market/ws', customSocksNetwork)).resolves.toBe(
      'socks5://127.0.0.1:6153'
    )
  })

  it('bypasses custom proxy settings for configured local hosts', async () => {
    await expect(resolveWebSocketProxyUrl('ws://127.0.0.1:5173/ws', customSocksNetwork)).resolves.toBeNull()
  })

  it('uses Electron system proxy resolution when proxy mode is system', async () => {
    const resolveSystemProxy = vi.fn(async () => 'PROXY 127.0.0.1:7890; DIRECT')

    await expect(
      resolveWebSocketProxyUrl(
        'wss://fstream.binance.com/market/ws',
        { ...customSocksNetwork, proxyMode: 'system' },
        resolveSystemProxy
      )
    ).resolves.toBe('http://127.0.0.1:7890')
    expect(resolveSystemProxy).toHaveBeenCalledWith('wss://fstream.binance.com/market/ws')
  })

  it('creates sockets with the selected proxy agent', async () => {
    const constructed: Array<{ url: string; options: { agent?: unknown } }> = []
    class FakeNodeWebSocket {
      close = vi.fn()
      send = vi.fn()

      constructor(url: string, options?: { agent?: unknown }) {
        constructed.push({ url, options: options ?? {} })
      }

      on(): void {}
    }

    const WebSocketImpl = createPlatformWebSocketFactory({
      getNetworkSettings: async () => customSocksNetwork,
      NodeWebSocketImpl: FakeNodeWebSocket,
      createProxyAgent: (proxyUrl) => ({ proxyUrl })
    })

    new WebSocketImpl('wss://fstream.binance.com/market/ws')
    await vi.waitFor(() => expect(constructed).toHaveLength(1))

    expect(constructed[0]).toEqual({
      url: 'wss://fstream.binance.com/market/ws',
      options: {
        agent: {
          proxyUrl: 'socks5://127.0.0.1:6153'
        }
      }
    })
  })

  it('proxies send calls through the platform WebSocket wrapper', async () => {
    const sentMessages: string[] = []
    class FakeNodeWebSocket {
      close = vi.fn()

      constructor(_url: string, _options?: { agent?: unknown }) {}

      on(): void {}

      send(message: string): void {
        sentMessages.push(message)
      }
    }

    const WebSocketImpl = createPlatformWebSocketFactory({
      getNetworkSettings: async () => ({ ...customSocksNetwork, proxyMode: 'none' }),
      NodeWebSocketImpl: FakeNodeWebSocket
    })

    const socket = new WebSocketImpl('wss://fstream.binance.com/stream')
    await vi.waitFor(() => {
      socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['ethusdt@kline_1h'], id: 1 }))
      expect(sentMessages).toEqual([
        JSON.stringify({ method: 'SUBSCRIBE', params: ['ethusdt@kline_1h'], id: 1 })
      ])
    })
  })
})
