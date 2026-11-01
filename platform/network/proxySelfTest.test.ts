import { createServer, type Server } from 'node:net'

import { afterAll, describe, expect, it } from 'vitest'

import { isLoopbackProxyEndpoint, isProxyEndpointReachable, parseResolvedProxy } from './proxySelfTest'

describe('parseResolvedProxy', () => {
  it('reads the first hop of a chromium resolution', () => {
    expect(parseResolvedProxy('DIRECT')).toEqual({ raw: 'DIRECT', direct: true, endpoint: null })
    expect(parseResolvedProxy('PROXY 127.0.0.1:7890; DIRECT')).toEqual({
      raw: 'PROXY 127.0.0.1:7890; DIRECT',
      direct: false,
      endpoint: { host: '127.0.0.1', port: 7890 }
    })
    expect(parseResolvedProxy('SOCKS5 proxy.example.test:1080')).toEqual({
      raw: 'SOCKS5 proxy.example.test:1080',
      direct: false,
      endpoint: { host: 'proxy.example.test', port: 1080 }
    })
    expect(parseResolvedProxy('HTTPS proxy.example.test:443')).toMatchObject({
      direct: false,
      endpoint: { host: 'proxy.example.test', port: 443 }
    })
  })

  it('treats an empty or unreadable resolution as direct, never as a proxy', () => {
    expect(parseResolvedProxy('')).toEqual({ raw: '', direct: true, endpoint: null })
    expect(parseResolvedProxy('WEIRD')).toMatchObject({ direct: false, endpoint: null })
  })
})

describe('isProxyEndpointReachable', () => {
  let server: Server | undefined

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve()
      server.close(() => resolve())
    })
  })

  it('reports a listening endpoint as reachable and a closed port as unreachable', async () => {
    server = createServer()
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('expected a tcp address')

    await expect(isProxyEndpointReachable({ host: '127.0.0.1', port: address.port }, 1000)).resolves.toBe(true)
    await expect(isProxyEndpointReachable({ host: '127.0.0.1', port: 1 }, 500)).resolves.toBe(false)
  })
})

describe('isLoopbackProxyEndpoint', () => {
  it('recognises only endpoints where a failed connection means the proxy itself', () => {
    expect(isLoopbackProxyEndpoint('127.0.0.1:7890')).toBe(true)
    expect(isLoopbackProxyEndpoint('127.1.2.3:1080')).toBe(true)
    expect(isLoopbackProxyEndpoint('localhost:7890')).toBe(true)
    expect(isLoopbackProxyEndpoint('[::1]:7890')).toBe(true)
    expect(isLoopbackProxyEndpoint('192.168.1.10:7890')).toBe(false)
    expect(isLoopbackProxyEndpoint('proxy.corp.test:7890')).toBe(false)
  })
})
