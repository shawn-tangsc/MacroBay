import type { Agent } from 'node:http'

import { ProxyAgent } from 'proxy-agent'
import { session } from 'electron'
import NodeWebSocket from 'ws'

import type { NetworkSettings } from '../settings/schema/appSettings'

type BrowserStyleWebSocket = Pick<globalThis.WebSocket, 'close' | 'onclose' | 'onerror' | 'onmessage' | 'onopen' | 'send'>
type BrowserOpenEvent = Parameters<NonNullable<BrowserStyleWebSocket['onopen']>>[0]
type BrowserCloseEvent = Parameters<NonNullable<BrowserStyleWebSocket['onclose']>>[0]
type BrowserErrorEvent = Parameters<NonNullable<BrowserStyleWebSocket['onerror']>>[0]
type BrowserMessageEvent = Parameters<NonNullable<BrowserStyleWebSocket['onmessage']>>[0]

type NodeWebSocketLike = {
  close: () => void
  send: (data: string) => void
  on: (event: 'open' | 'message' | 'error' | 'close', listener: (...args: unknown[]) => void) => void
}

type NodeWebSocketConstructor = new (url: string, options?: { agent?: unknown }) => NodeWebSocketLike

type ResolveSystemProxy = (url: string) => Promise<string>

export type PlatformWebSocketFactoryOptions = {
  getNetworkSettings: () => Promise<NetworkSettings>
  NodeWebSocketImpl?: NodeWebSocketConstructor
  createProxyAgent?: (proxyUrl: string) => unknown
  resolveSystemProxy?: ResolveSystemProxy
}

export type PlatformWebSocketConstructor = new (url: string) => BrowserStyleWebSocket

/**
 * A socket URL fit for a log: any query secret is replaced and any userinfo dropped. Logging the raw
 * URL once put a live API key in the terminal and in a screenshot, which is exactly what this exists
 * to prevent — a diagnostic must never be the leak.
 */
export function redactWebSocketUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) { parsed.username = ''; parsed.password = '' }
    for (const key of [...parsed.searchParams.keys()]) {
      if (/key|token|secret|auth|password/i.test(key)) parsed.searchParams.set(key, '***')
    }
    return parsed.toString()
  } catch {
    return url.replace(/([?&](?:apikey|api_key|token|key)=)[^&]*/gi, '$1***')
  }
}

/** A proxy URL with any userinfo removed, for logs that must never carry credentials. */
export function maskProxyCredentials(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl)
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return proxyUrl.replace(/\/\/[^@/]*@/, '//')
  }
}

/** How long a single pre-connection step may take before it is reported as a failure. */
export const WEBSOCKET_PRE_CONNECT_TIMEOUT_MS = 5_000

/** How long the client itself may stay silent — constructed but neither open nor failed. */
export const WEBSOCKET_CONNECT_TIMEOUT_MS = 10_000

function withWebSocketTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} did not settle within ${WEBSOCKET_PRE_CONNECT_TIMEOUT_MS}ms`)),
        WEBSOCKET_PRE_CONNECT_TIMEOUT_MS)
    })
  ])
}

export function createPlatformWebSocketFactory(options: PlatformWebSocketFactoryOptions): PlatformWebSocketConstructor {
  const NodeWebSocketImpl = options.NodeWebSocketImpl ?? (NodeWebSocket as unknown as NodeWebSocketConstructor)
  const createProxyAgent =
    options.createProxyAgent ??
    ((proxyUrl) =>
      new ProxyAgent({
        getProxyForUrl: async () => proxyUrl
      }) as Agent)
  const resolveSystemProxy =
    options.resolveSystemProxy ?? ((url) => session.defaultSession.resolveProxy(url))

  return class PlatformWebSocket implements BrowserStyleWebSocket {
    onclose: BrowserStyleWebSocket['onclose'] = null
    onerror: BrowserStyleWebSocket['onerror'] = null
    onmessage: BrowserStyleWebSocket['onmessage'] = null
    onopen: BrowserStyleWebSocket['onopen'] = null

    private socket: NodeWebSocketLike | null = null
    private closeRequested = false
    /** The resolved proxy for the diagnostics, with any credentials stripped. */
    private proxyForLog = 'direct'

    constructor(private readonly url: string) {
      void this.open()
    }

    close(_code?: number, _reason?: string): void {
      this.closeRequested = true
      this.socket?.close()
    }

    send(data: string): void {
      this.socket?.send(data)
    }

    private async open(): Promise<void> {
      let settingsMs = -1
      let proxyMs = -1
      try {
        // Both steps below can hang rather than reject: reading the app's network settings and asking
        // the session to resolve a proxy are async and neither is guaranteed to settle. Because the
        // socket's open/error handlers are only attached *after* them, a hang here is invisible — no
        // open, no error, a caller that waits forever. A bounded wait turns that into a reported
        // failure, with the timings, so the next reader knows which step stalled.
        const settingsStarted = Date.now()
        const network = await withWebSocketTimeout(options.getNetworkSettings(), 'network-settings')
        settingsMs = Date.now() - settingsStarted
        const proxyStarted = Date.now()
        const proxyUrl = await withWebSocketTimeout(
          resolveWebSocketProxyUrl(this.url, network, resolveSystemProxy), 'websocket-proxy-resolution')
        proxyMs = Date.now() - proxyStarted
        this.proxyForLog = proxyUrl ? maskProxyCredentials(proxyUrl) : 'direct'
        if (this.closeRequested) return

        const socket = new NodeWebSocketImpl(
          this.url,
          proxyUrl
            ? {
                agent: createProxyAgent(proxyUrl)
              }
            : undefined
        )
        this.socket = socket
        this.bindSocket(socket)
        if (this.closeRequested) {
          socket.close()
        }
      } catch (error) {
        console.log(JSON.stringify({
          marker: 'PLATFORM_WS_OPEN_FAILED', url: redactWebSocketUrl(this.url), settingsMs, proxyMs, proxy: this.proxyForLog,
          message: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
        }))
        this.onerror?.call(this as unknown as WebSocket, createWebSocketErrorEvent(error))
        this.onclose?.call(this as unknown as WebSocket, createWebSocketCloseEvent())
      }
    }

    private bindSocket(socket: NodeWebSocketLike): void {
      // The last place a connection can stall: the client is constructed, the network steps resolved,
      // and then neither `open` nor `error` ever arrives. Without this bound the caller waits forever —
      // which is exactly what the gold stream did, reporting `connecting` for as long as it ran.
      let settled = false
      const connectTimer = setTimeout(() => {
        if (settled) return
        settled = true
        console.log(JSON.stringify({ marker: 'PLATFORM_WS_CONNECT_TIMEOUT', url: redactWebSocketUrl(this.url), timeoutMs: WEBSOCKET_CONNECT_TIMEOUT_MS, proxy: this.proxyForLog }))
        try { socket.close() } catch { /* a socket that never opened may refuse to close; the report above still stands. */ }
        this.onerror?.call(this as unknown as WebSocket, createWebSocketErrorEvent(new Error('websocket connect timed out')))
        this.onclose?.call(this as unknown as WebSocket, createWebSocketCloseEvent())
      }, WEBSOCKET_CONNECT_TIMEOUT_MS)
      const settle = (): void => { if (!settled) { settled = true; clearTimeout(connectTimer) } }
      socket.on('open', () => {
        // Success is worth one line too: it is the only proof that the proxy decision was right.
        console.log(JSON.stringify({ marker: 'PLATFORM_WS_OPENED', url: redactWebSocketUrl(this.url), proxy: this.proxyForLog }))
        settle()
        this.onopen?.call(this as unknown as WebSocket, createWebSocketOpenEvent())
      })
      socket.on('message', (data) => {
        this.onmessage?.call(this as unknown as WebSocket, createWebSocketMessageEvent(data))
      })
      socket.on('error', (error) => {
        settle()
        this.onerror?.call(this as unknown as WebSocket, createWebSocketErrorEvent(error as Error))
      })
      socket.on('close', () => {
        settle()
        this.onclose?.call(this as unknown as WebSocket, createWebSocketCloseEvent())
      })
    }
  }
}

export async function resolveWebSocketProxyUrl(
  url: string,
  network: NetworkSettings,
  resolveSystemProxy: ResolveSystemProxy = (targetUrl) => session.defaultSession.resolveProxy(targetUrl)
): Promise<string | null> {
  if (network.proxyMode === 'none') return null
  if (shouldBypassProxy(url, network.proxyBypassRules)) return null

  if (network.proxyMode === 'custom') {
    return normalizeCustomProxyUrl(network.proxyUrl)
  }

  const proxyRules = await resolveSystemProxy(url)
  return parseResolvedProxyRules(proxyRules)
}

export function normalizeCustomProxyUrl(proxyUrl: string): string | null {
  const trimmed = proxyUrl.trim()
  if (!trimmed) return null

  try {
    const parsed = new URL(trimmed)
    if (isSupportedProxyProtocol(parsed.protocol)) {
      return parsed.toString()
    }
  } catch {
    if (/^[\w.-]+:\d+$/.test(trimmed)) {
      return `socks5://${trimmed}`
    }
  }

  return null
}

export function parseResolvedProxyRules(value: string): string | null {
  const entries = value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)

  for (const entry of entries) {
    const [type, address] = entry.split(/\s+/, 2)
    const normalizedType = type?.toUpperCase()
    if (!normalizedType || normalizedType === 'DIRECT' || !address) continue

    if (normalizedType === 'PROXY') {
      return `http://${address}`
    }
    if (normalizedType === 'HTTPS') {
      return `https://${address}`
    }
    if (normalizedType === 'SOCKS' || normalizedType === 'SOCKS5') {
      return `socks5://${address}`
    }
    if (normalizedType === 'SOCKS4') {
      return `socks4://${address}`
    }
  }

  return null
}

function shouldBypassProxy(url: string, proxyBypassRules: string): boolean {
  let hostname = ''
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }

  const rules = proxyBypassRules
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  return rules.some((rule) => matchesBypassRule(hostname, rule))
}

function matchesBypassRule(hostname: string, rule: string): boolean {
  if (rule === '<local>') return !hostname.includes('.')
  if (rule === hostname) return true
  if (rule.startsWith('*.')) {
    const suffix = rule.slice(1)
    return hostname.endsWith(suffix)
  }
  if (rule.startsWith('.')) {
    return hostname.endsWith(rule)
  }
  return false
}

function isSupportedProxyProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:' || protocol === 'socks4:' || protocol === 'socks5:' || protocol === 'socks5h:'
}

function createWebSocketOpenEvent(): BrowserOpenEvent {
  return { type: 'open' } as BrowserOpenEvent
}

/**
 * A browser-style message event, which means text arrives as text.
 *
 * The underlying client hands over a Buffer for a text frame, and passing that through made this
 * adapter subtly unlike the WebSocket it imitates: a consumer that checks `typeof data === 'string'`
 * — which is what a browser delivers, and what the gold stream checks — silently discarded every
 * frame. The reader watched a live price that never moved because of it. Buffers and views are decoded
 * as UTF-8 here, so a text frame is a string for every consumer.
 */
function createWebSocketMessageEvent(data: unknown): BrowserMessageEvent {
  return { data: toBrowserMessageData(data), type: 'message' } as BrowserMessageEvent
}

function toBrowserMessageData(data: unknown): unknown {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data))
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as unknown as Uint8Array)
  // `ws` accepts a list of fragments for a single frame; join them rather than handing over an array.
  if (Array.isArray(data)) return (data as unknown[]).map(part => String(toBrowserMessageData(part))).join('')
  return data
}

function createWebSocketErrorEvent(error: unknown): BrowserErrorEvent {
  return ({
    error,
    message: error instanceof Error ? error.message : String(error),
    type: 'error'
  } as unknown) as BrowserErrorEvent
}

function createWebSocketCloseEvent(): BrowserCloseEvent {
  return { type: 'close' } as BrowserCloseEvent
}
