#!/usr/bin/env node
/**
 * Discord 网关的一次性诊断（只读 / 只发一条，不碰数据库、不写文件、不打印 Token）。
 *
 * 为什么要有它：这台机器直连 discord.com 不通，必须走系统代理；而「用例全绿、用户一条都收不到」
 * 正是这类环境最容易出现的假绿。所以真机验收之前，先用一条命令把三件事分开证：
 * 代理通、Token 活、网关能识别并回 READY（顺带报这个 bot 现在在几个服务器里）。
 *
 * 与适配器共用：帧解析（`DiscordGatewayProtocol`）、状态机（`DiscordGatewaySession`）、
 * REST 读（`DiscordApiClient`）。**没共用的一层是 socket 工厂**——`platformWebSocket` 为了读
 * Electron 的会话代理在顶层 import 了 electron，只能跑在应用里；这里用同一套 `ws` + `proxy-agent`
 * 复现它的代理逻辑（同样先解析代理再连、同样带超时）。
 *
 * Token 只从 `$DSH_SECRET_DISCORD_BOT_TOKEN` 读，绝不落盘、绝不打印；输出一行脱敏 JSON：
 * `{ ok, mode, proxy, botId, username, guilds, sessionIdPrefix, messageId, failure }`。
 *
 * 用法：
 *   DSH_SECRET_DISCORD_BOT_TOKEN=… pnpm tsx scripts/discord-gateway-smoke.mts --probe --proxy http://127.0.0.1:7888
 *   DSH_SECRET_DISCORD_BOT_TOKEN=… pnpm tsx scripts/discord-gateway-smoke.mts --send <channelId> "测试" --proxy http://127.0.0.1:7888
 *
 * `--proxy` 省略时依次看 `DISCORD_SMOKE_PROXY` / `HTTPS_PROXY` / `https_proxy`；都没有就是直连
 * （这台机器会失败，输出里 `proxy: "direct"`——那是「代理没配」，不是「适配器不行」）。
 */
import { readFileSync } from 'node:fs'
import { request } from 'node:https'

import { ProxyAgent } from 'proxy-agent'
import WebSocket from 'ws'

import { DiscordApiClient } from '../platform/ai/agent-platform/channels/discord/DiscordApiClient'
import { parseDiscordGatewayFrame } from '../platform/ai/agent-platform/channels/discord/DiscordGatewayProtocol'
import { DiscordGatewaySession } from '../platform/ai/agent-platform/channels/discord/DiscordGatewaySession'
import { DISCORD_DEFAULT_INTENTS } from '../platform/ai/agent-platform/channels/discord/DiscordRuntimeManager'

type ApiRead<T> = { ok: true; value: T } | { ok: false; code: string }
type Args = { mode: 'probe' | 'send'; channelId?: string; text?: string; proxy?: string }

const USAGE = `Usage:
  discord-gateway-smoke --probe [--proxy <url>]
  discord-gateway-smoke --send <channelId> <text> [--proxy <url>]
Token comes from $DSH_SECRET_DISCORD_BOT_TOKEN. Nothing is written to disk and the token is never printed.`

function parseArgs(argv: readonly string[]): Args {
  const [mode, ...rest] = argv
  const proxyIndex = rest.indexOf('--proxy')
  const proxy = proxyIndex >= 0 ? rest[proxyIndex + 1] : undefined
  const positional = proxyIndex >= 0 ? rest.slice(0, proxyIndex) : rest
  if (mode === '--probe') return { mode: 'probe', ...(proxy ? { proxy } : {}) }
  if (mode === '--send') {
    if (!positional[0] || positional.length < 2) throw new Error(USAGE)
    return { mode: 'send', channelId: positional[0], text: positional.slice(1).join(' '), ...(proxy ? { proxy } : {}) }
  }
  throw new Error(USAGE)
}

/** 产品 UA：版本从 package.json 读，避免脚本里写死一个会过期的数字。 */
function userAgent(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
  const version = typeof pkg.version === 'string' && pkg.version.trim() !== '' ? pkg.version.trim() : '0.0.0'
  return `MacroBay/${version} (Discord adapter)`
}

function resolveProxy(explicit: string | undefined): string | null {
  const value = explicit ?? process.env.DISCORD_SMOKE_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? ''
  return value.trim().length > 0 ? value.trim() : null
}

/** 代理只报 host:port：URL 里的账号密码不进输出（与平台那条 `maskProxyCredentials` 同一口径）。 */
function maskProxy(proxy: string | null): string {
  if (!proxy) return 'direct'
  try {
    const url = new URL(proxy)
    return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
  } catch {
    return 'configured'
  }
}

/**
 * 代理感知的最小 `fetch`：够 `DiscordApiClient` 用（只看 status 与 json）。
 *
 * 为什么不用 Node 自带的 `fetch`：它不认代理 agent，硬塞一个会被忽略、**静默直连**——
 * 那正好是这台机器上必失的那种假绿。
 */
function nodeFetchThroughProxy(proxy: string | null): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const body = typeof init?.body === 'string' ? init.body : null
    const headers = headersOf(init)
    let agent: ProxyAgent | undefined
    if (proxy) agent = new ProxyAgent({ getProxyForUrl: async () => proxy })
    return await new Promise<Response>((resolve, reject) => {
      const options = {
        host: url.hostname,
        port: Number(url.port || 443),
        path: `${url.pathname}${url.search}`,
        method: init?.method ?? 'GET',
        headers,
        ...(agent ? { agent } : {})
      }
      const outgoing = request(options)
      outgoing.setTimeout(15_000, () => outgoing.destroy(new Error('request timed out')))
      outgoing.on('response', (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          resolve(new Response(Buffer.concat(chunks).toString('utf8'), { status: response.statusCode ?? 0 }))
        })
      })
      outgoing.on('error', reject)
      if (body !== null) outgoing.write(body)
      outgoing.end()
    })
  }) as typeof fetch
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const headers = new Headers(init?.headers)
  const result: Record<string, string> = {}
  headers.forEach((value, key) => { result[key] = value })
  return result
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const token = process.env.DSH_SECRET_DISCORD_BOT_TOKEN?.trim()
  if (!token) throw new Error('DSH_SECRET_DISCORD_BOT_TOKEN is not set')
  const proxy = resolveProxy(args.proxy)
  const transport = nodeFetchThroughProxy(proxy)
  const client = new DiscordApiClient({
    getPlatformFetch: () => transport,
    token: async () => token,
    userAgent: userAgent()
  })

  const identity = await client.currentUser(AbortSignal.timeout(15_000))
  const report: Record<string, unknown> = {
    ok: false,
    mode: args.mode,
    proxy: maskProxy(proxy),
    ...(identity.ok ? { botId: identity.value.id, username: identity.value.username } : { failure: identity.code })
  }
  if (!identity.ok) return print(report)

  if (args.mode === 'send') {
    const sent = await sendMessage(transport, args.channelId ?? '', args.text ?? '')
    return print({ ...report, ok: sent.ok, ...(sent.ok ? { messageId: sent.value.messageId } : { failure: sent.code }) })
  }

  const gateway = await client.gatewayBot(AbortSignal.timeout(15_000))
  if (!gateway.ok) return print({ ...report, failure: gateway.code })

  const ready = await awaitReady({ token, url: gateway.value.url, proxy })
  print({ ...report, intents: DISCORD_DEFAULT_INTENTS, ...ready })
}

/** 真网关一次识别往返：用随包的状态机跑 HELLO → IDENTIFY → READY，跑完就关。 */
function awaitReady(input: { token: string; url: string; proxy: string | null }): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const socket = new WebSocket(input.url, {
      ...(input.proxy ? { agent: new ProxyAgent({ getProxyForUrl: async () => input.proxy ?? '' }) } : {}),
      // 与 REST 同一个产品 UA：Discord 边缘在握手这一跳也看它（浏览器 UA 会被 403）。
      headers: { 'user-agent': userAgent() }
    })
    let settled = false
    const finish = (value: Record<string, unknown>): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close() } catch { /* already closed */ }
      resolve(value)
    }
    const timer = setTimeout(() => finish({ ok: false, failure: 'ready-timeout' }), 20_000)
    const session = new DiscordGatewaySession({
      token: input.token,
      intents: DISCORD_DEFAULT_INTENTS,
      clock: {
        setTimer: (delayMs, run) => setTimeout(run, delayMs),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
      },
      onEnd: (end) => finish({ ok: false, failure: `gateway-ended:${end.reason}` })
    })
    session.attach({ send: (wire) => socket.send(wire), close: () => socket.close() })
    socket.on('message', (data) => {
      const frame = parseDiscordGatewayFrame(String(data))
      if (!frame) return
      if (frame.kind === 'dispatch' && frame.event === 'READY') {
        const payload = frame.data as { session_id?: unknown; guilds?: unknown }
        finish({
          ok: true,
          sessionIdPrefix: typeof payload.session_id === 'string' ? payload.session_id.slice(0, 8) : null,
          guilds: Array.isArray(payload.guilds) ? payload.guilds.length : null
        })
        return
      }
      session.receive(frame)
    })
    socket.on('error', (error) => finish({ ok: false, failure: `gateway-error:${error.message.slice(0, 120)}` }))
    // 关闭码是唯一能分清「intent 没授权 / Token 不对 / 连得太急 / 普通掉线」的线索：
    // 混成一句 `gateway-closed-before-ready`，下一个人只能重新猜一遍。
    socket.on('close', (code) => finish({ ok: false, closeCode: code, failure: closeFailure(code) }))
  })
}

async function sendMessage(
  transport: typeof fetch,
  channelId: string,
  text: string
): Promise<ApiRead<{ messageId: string }>> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(channelId)) return { ok: false, code: 'channel-id-invalid' }
  const token = process.env.DSH_SECRET_DISCORD_BOT_TOKEN?.trim() ?? ''
  const response = await transport(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bot ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ content: text })
  })
  if (!response.ok) return { ok: false, code: response.status === 429 ? 'discord-rate-limited' : `discord-http-${response.status}` }
  const body = await response.json() as { id?: unknown }
  if (typeof body.id !== 'string' || body.id.length === 0) return { ok: false, code: 'discord-provider-rejected' }
  return { ok: true, value: { messageId: body.id } }
}

/** Discord 的 Close Event Codes：只有这几条是「改配置才会好」，其余都算普通掉线。 */
function closeFailure(code: number): string {
  if (code === 4_013 || code === 4_014) return 'intents-disallowed'
  if (code === 4_003 || code === 4_004) return 'credential-rejected'
  if (code === 4_008) return 'rate-limited-close'
  return 'gateway-closed-before-ready'
}

function print(value: Record<string, unknown>): void {
  // 一行 JSON：脱敏后的结果，Token 从不出现在这里。
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${USAGE}\n\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
