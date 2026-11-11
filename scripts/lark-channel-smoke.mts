#!/usr/bin/env node
/**
 * 飞书（Lark）的一次性连通诊断（只读 / 可发一条，不碰数据库、不写文件、不打印凭据）。
 *
 * 三步各证一件事，任何一步跳过都会把「配错了」读成「通了」：
 * 1. 代理这一跳建得起来（3 秒 TCP 检查）；
 * 2. `app_id + app_secret` 换得到 `tenant_access_token` —— 凭据活着；
 * 3. 长连接建得起来 —— **只鉴权成功不算通过**：应用没开长连接能力时鉴权照样成功，
 *    而消息一条都收不到。这一步与启用自检的第二步是同一件事（同一个包装层）。
 *
 * 与产品共用 `createLarkLongConnection`（长连接包装层，SDK 只出现在那里）。**没共用的一层是出网入口**：
 * 应用里的 `platformFetch` 读 Electron 会话代理，只能在应用内跑；这里用同一套 `proxy-agent` 复现，
 * 并且把**取 wss 地址那一跳**也接到这个入口上（`getPlatformFetch`）——不接的话 SDK 会用自带 axios
 * 直连，测出来的「连不上」是假的。
 *
 * 凭据只从 `$DSH_SECRET_LARK_APP_ID` / `$DSH_SECRET_LARK_APP_SECRET` 读，绝不落盘、绝不打印；
 * 输出一行脱敏 JSON：`{ ok, mode, proxy, tenantTokenExpiresIn, socket, messageId, step, failure }`。
 *
 * 用法：
 *   DSH_SECRET_LARK_APP_ID=… DSH_SECRET_LARK_APP_SECRET=… pnpm lark:smoke --probe --proxy http://127.0.0.1:7888
 *   … pnpm lark:smoke --send <chatId> "测试" --proxy http://127.0.0.1:7888
 *
 * `--proxy` 省略时依次看 `LARK_SMOKE_PROXY` / `HTTPS_PROXY` / `https_proxy`；都没有就是直连。
 *
 * 失败码分三类，`step` 指到断在哪一步：
 *   - 凭据错：`lark-provider-rejected`（`step:"token"` = app_id/secret 不认；`step:"send"` = 消息被拒，
 *     多半是机器人没在目标会话里）
 *   - 网络/代理不通：`proxy-unreachable`、`lark-network-unavailable`
 *   - 对方没起：`lark-connect-failed`（长连接建不起来：应用没开长连接能力/没加机器人能力）、
 *     `lark-rate-limited`
 */
import { connect } from 'node:net'
import { request } from 'node:https'

import { ProxyAgent } from 'proxy-agent'

import { larkApiBase } from '../platform/ai/agent-platform/channels/lark/LarkContracts'
import {
  createLarkLongConnection,
  type LarkProxyDecision
} from '../platform/ai/agent-platform/channels/lark/LarkLongConnectionClient'

type Args = { mode: 'probe' | 'send'; chatId?: string; text?: string; proxy?: string }

const USAGE = `Usage:
  lark-channel-smoke --probe [--proxy <url>]
  lark-channel-smoke --send <chatId> <text> [--proxy <url>]
Credentials come from $DSH_SECRET_LARK_APP_ID and $DSH_SECRET_LARK_APP_SECRET.
Nothing is written to disk and the credentials are never printed.`

function parseArgs(argv: readonly string[]): Args {
  const [mode, ...rest] = argv
  const proxyIndex = rest.indexOf('--proxy')
  const proxy = proxyIndex >= 0 ? rest[proxyIndex + 1] : undefined
  const positional = proxyIndex >= 0 ? rest.slice(0, proxyIndex) : rest
  if (mode === '--probe') return { mode: 'probe', ...(proxy ? { proxy } : {}) }
  if (mode === '--send') {
    if (!positional[0] || positional.length < 2) throw new Error(USAGE)
    return { mode: 'send', chatId: positional[0], text: positional.slice(1).join(' '), ...(proxy ? { proxy } : {}) }
  }
  throw new Error(USAGE)
}

function resolveProxy(explicit: string | undefined): string | null {
  const value = explicit ?? process.env.LARK_SMOKE_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? ''
  return value.trim().length > 0 ? value.trim() : null
}

/** 代理只报 host:port：URL 里的账号密码不进输出（与平台那条 `maskProxyCredentials` 同一口径）。 */
function maskProxy(proxy: string | null): string {
  if (!proxy) return 'direct'
  try {
    const url = new URL(proxy)
    return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
  } catch {
    return 'unparsable'
  }
}

/** 代理这一跳先单独证一次：`fetch` 层失败时，「代理连不上」与「目标不可达」要分得开。 */
async function proxyReachable(proxy: string): Promise<boolean> {
  let host = ''
  let port = 0
  try {
    const url = new URL(proxy)
    host = url.hostname
    port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  } catch {
    return false
  }
  if (!host || !port) return false
  return await new Promise<boolean>((resolve) => {
    const socket = connect({ host, port })
    const finish = (value: boolean): void => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(3_000, () => finish(false))
    socket.on('connect', () => finish(true))
    socket.on('error', () => finish(false))
  })
}

/** 出网入口：与平台 `platformFetch` 同一套（`proxy-agent` 对象形状，传字符串不生效）。 */
function nodeFetchThroughProxy(proxy: string | null): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const body = typeof init?.body === 'string' ? init.body : null
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value })
    const agent = proxy ? new ProxyAgent({ getProxyForUrl: async () => proxy }) : undefined
    return await new Promise<Response>((resolve, reject) => {
      const outgoing = request({
        host: url.hostname,
        port: Number(url.port || 443),
        path: `${url.pathname}${url.search}`,
        method: init?.method ?? 'GET',
        headers,
        ...(agent ? { agent } : {})
      })
      outgoing.setTimeout(15_000, () => outgoing.destroy(new Error('request timed out')))
      outgoing.on('response', (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve(new Response(Buffer.concat(chunks).toString('utf8'), { status: response.statusCode ?? 0 })))
      })
      outgoing.on('error', reject)
      if (body !== null) outgoing.write(body)
      outgoing.end()
    })
  }) as typeof fetch
}

type ApiRead<T> = { ok: true; value: T } | { ok: false; code: 'lark-provider-rejected' | 'lark-network-unavailable' | 'lark-rate-limited' }

/** 换 tenant_access_token：这一步过了才说明 app_id/app_secret 活着。 */
async function tenantToken(
  transport: typeof fetch,
  appId: string,
  appSecret: string
): Promise<ApiRead<{ token: string; expiresIn: number }>> {
  try {
    const response = await transport(`${larkApiBase}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    })
    if (response.status === 429) return { ok: false, code: 'lark-rate-limited' }
    if (response.status >= 500) return { ok: false, code: 'lark-network-unavailable' }
    const body = await response.json() as { code?: unknown; tenant_access_token?: unknown; expire?: unknown }
    const token = typeof body.tenant_access_token === 'string' ? body.tenant_access_token : ''
    if (!response.ok || body.code !== 0 || !token) return { ok: false, code: 'lark-provider-rejected' }
    return { ok: true, value: { token, expiresIn: typeof body.expire === 'number' ? body.expire : 0 } }
  } catch {
    return { ok: false, code: 'lark-network-unavailable' }
  }
}

/** 发一条文本：回上游 `message_id`，它是唯一能把「发到了」与「发到了别处」分开的证据。 */
async function sendText(
  transport: typeof fetch,
  token: string,
  chatId: string,
  text: string
): Promise<ApiRead<{ messageId: string | null }>> {
  try {
    const response = await transport(`${larkApiBase}/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) })
    })
    if (response.status === 429) return { ok: false, code: 'lark-rate-limited' }
    if (response.status >= 500) return { ok: false, code: 'lark-network-unavailable' }
    const body = await response.json() as { code?: unknown; data?: { message_id?: unknown } }
    if (!response.ok || body.code !== 0) return { ok: false, code: 'lark-provider-rejected' }
    const messageId = typeof body.data?.message_id === 'string' ? body.data.message_id : null
    return { ok: true, value: { messageId } }
  } catch {
    return { ok: false, code: 'lark-network-unavailable' }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const appId = process.env.DSH_SECRET_LARK_APP_ID?.trim()
  const appSecret = process.env.DSH_SECRET_LARK_APP_SECRET?.trim()
  if (!appId) throw new Error('DSH_SECRET_LARK_APP_ID is not set')
  if (!appSecret) throw new Error('DSH_SECRET_LARK_APP_SECRET is not set')

  const proxy = resolveProxy(args.proxy)
  const report: Record<string, unknown> = { ok: false, mode: args.mode, proxy: maskProxy(proxy) }
  if (proxy && !(await proxyReachable(proxy))) return print({ ...report, step: 'proxy', failure: 'proxy-unreachable' })

  const transport = nodeFetchThroughProxy(proxy)
  const decision: LarkProxyDecision = proxy ? { kind: 'proxy', url: proxy } : { kind: 'direct' }

  const auth = await tenantToken(transport, appId, appSecret)
  if (!auth.ok) return print({ ...report, step: 'token', failure: auth.code })
  report.tenantTokenExpiresIn = auth.value.expiresIn

  if (args.mode === 'send') {
    const sent = await sendText(transport, auth.value.token, args.chatId ?? '', args.text ?? '')
    return print({ ...report, ...(sent.ok ? { ok: true, step: 'send', messageId: sent.value.messageId } : { step: 'send', failure: sent.code }) })
  }

  // 长连接：与启用自检第二步同一件事。取 wss 地址那一跳必须走 `getPlatformFetch`。
  const connection = createLarkLongConnection({
    appId,
    appSecret,
    resolveProxy: async () => decision,
    getPlatformFetch: () => transport,
    handshakeTimeoutMs: 15_000
  })
  try {
    const connected = await connection.connect({ onEvent: () => {} })
    if (!connected.ok) return print({ ...report, step: 'socket', failure: connected.code })
    print({ ...report, ok: true, step: 'socket', socket: 'connected' })
  } finally {
    connection.close()
  }
}

function print(value: Record<string, unknown>): void {
  // 一行 JSON：脱敏后的结果，app_id / app_secret / tenant token 从不出现在这里。
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${USAGE}\n\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})