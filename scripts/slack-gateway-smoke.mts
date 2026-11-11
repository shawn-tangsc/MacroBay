#!/usr/bin/env node
/**
 * Slack 连通自检的一次性命令（只读 / 只发一条，不碰数据库、不写文件、不打印 Token）。
 *
 * 与 Discord 那条同形状、同理由：这台机器直连 slack.com 与 Socket Mode 都不可靠，必须走代理；
 * 而「用例全绿、真机收不到」正是这类环境最容易出现的假绿。所以分三步各证一件事：
 * 1. `auth.test`（Bot Token）—— 这把 `xoxb-` 是活的；
 * 2. `apps.connections.open`（App Token）—— 这把 `xapp-` 是活的，且 App 侧 **Socket Mode 真开着**；
 * 3. 连上那个 wss 并收到 `{"type":"hello"}` —— 长连接本身通。
 *
 * 只验第 1 步的写法更省事，但 Socket Mode 没开时它照样通过：用户会拿着「已启用」的频道收不到任何消息，
 * 那条路上连日志都没有（连接根本没建立）。
 *
 * 失败时先分「代理这一跳通不通」：连不上就是 `proxy-unreachable`（与另外三条命令同一个说法），
 * 而不是甩一个 `ECONNREFUSED` 堆栈；其余失败按 `slack-rejected:<error>` / `socket-*` 原样带出。
 *
 * Token 只从环境变量读，绝不落盘、绝不打印；输出一行脱敏 JSON：
 * `{ ok, mode, proxy, botUserId, teamId, socket, messageId, failure }`。
 *
 * 用法：
 *   DSH_SECRET_SLACK_BOT_TOKEN=… DSH_SECRET_SLACK_APP_TOKEN=… \
 *     pnpm slack:smoke --probe --proxy http://127.0.0.1:7888
 *   … pnpm slack:smoke --send <channelId> "测试" --proxy http://127.0.0.1:7888
 *
 * `--proxy` 省略时依次看 `SLACK_SMOKE_PROXY` / `HTTPS_PROXY` / `https_proxy`；都没有就是直连。
 */
import { connect } from 'node:net'
import { request } from 'node:https'

import { ProxyAgent } from 'proxy-agent'
import WebSocket from 'ws'

type ApiRead<T> = { ok: true; value: T } | { ok: false; code: string }
type Args = { mode: 'probe' | 'send'; channelId?: string; text?: string; proxy?: string }

const USAGE = `Usage:
  slack-smoke --probe [--proxy <url>]
  slack-smoke --send <channelId> <text> [--proxy <url>]
Tokens come from $DSH_SECRET_SLACK_BOT_TOKEN and $DSH_SECRET_SLACK_APP_TOKEN.
Nothing is written to disk and the tokens are never printed.`

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

function resolveProxy(explicit: string | undefined): string | null {
  // 本脚本自己的变量名在前：复制过来的 `DISCORD_SMOKE_PROXY` 会让配置的人以为配错了地方。
  const value = explicit ?? process.env.SLACK_SMOKE_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? ''
  return value.trim().length > 0 ? value.trim() : null
}

/** 代理只报 host:port：URL 里的账号密码不进输出。 */
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
 * 代理这一跳先单独证一次：`fetch` 层失败时，「代理根本连不上」和「代理通了但目标不可达」
 * 分得开，用户才知道该去开代理还是该去查网络。3 秒超时，连不上就停在这里。
 */
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

/**
 * 代理感知的最小 `fetch`：Node 自带 `fetch` 不认代理 agent，塞进去会被忽略、静默直连。
 * 响应只取 status 与 json，够这一条命令用。
 */
function nodeFetchThroughProxy(proxy: string | null): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const body = typeof init?.body === 'string' ? init.body : null
    const headers = headersOf(init)
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

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const headers = new Headers(init?.headers)
  const result: Record<string, string> = {}
  headers.forEach((value, key) => { result[key] = value })
  return result
}

async function slackCall<T>(
  transport: typeof fetch,
  token: string,
  method: string,
  body: Record<string, unknown> = {}
): Promise<ApiRead<T>> {
  const response = await transport(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  })
  if (response.status === 429) return { ok: false, code: 'slack-rate-limited' }
  if (!response.ok) return { ok: false, code: response.status >= 500 ? 'slack-network-unavailable' : 'slack-provider-rejected' }
  const json = await response.json() as { ok?: unknown; error?: unknown }
  if (json.ok !== true) {
    // Slack 把拒绝放在 200 的 body 里（invalid_auth / not_allowed_token_type / missing_scope…）：
    // 原文只报错误名，不带任何 token 片段。
    return { ok: false, code: `slack-rejected:${typeof json.error === 'string' ? json.error.slice(0, 60) : 'unknown'}` }
  }
  return { ok: true, value: json as T }
}

async function socketModeHello(url: string, proxy: string | null): Promise<Record<string, unknown>> {
  return await new Promise((resolve) => {
    const socket = new WebSocket(url, proxy ? { agent: new ProxyAgent({ getProxyForUrl: async () => proxy ?? '' }) } : {})
    let settled = false
    const finish = (value: Record<string, unknown>): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close() } catch { /* already closed */ }
      resolve(value)
    }
    const timer = setTimeout(() => finish({ ok: false, failure: 'socket-hello-timeout' }), 15_000)
    socket.on('message', (data) => {
      try {
        const frame = JSON.parse(String(data)) as { type?: unknown }
        if (frame.type === 'hello') finish({ ok: true, socket: 'hello' })
      } catch {
        finish({ ok: false, failure: 'socket-frame-invalid' })
      }
    })
    socket.on('error', (error) => finish({ ok: false, failure: `socket-error:${error.message.slice(0, 120)}` }))
    socket.on('close', () => finish({ ok: false, failure: 'socket-closed-before-hello' }))
  })
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const botToken = process.env.DSH_SECRET_SLACK_BOT_TOKEN?.trim()
  const appToken = process.env.DSH_SECRET_SLACK_APP_TOKEN?.trim()
  if (!botToken) throw new Error('DSH_SECRET_SLACK_BOT_TOKEN is not set')
  if (!appToken) throw new Error('DSH_SECRET_SLACK_APP_TOKEN is not set')

  const proxy = resolveProxy(args.proxy)
  const report: Record<string, unknown> = { ok: false, mode: args.mode, proxy: maskProxy(proxy) }
  // 与 discord / telegram / qq 三条同一个说法：代理这一跳先单独证一次，失败就是 `proxy-unreachable`，
  // 不让它变成一个 ECONNREFUSED 堆栈——同一家族的脚本，同一个故障要说同一种话。
  if (proxy && !(await proxyReachable(proxy))) return print({ ...report, failure: 'proxy-unreachable' })

  const transport = nodeFetchThroughProxy(proxy)

  const identity = await slackCall<{ user_id?: unknown; team_id?: unknown }>(transport, botToken, 'auth.test')
  if (!identity.ok) return print({ ...report, failure: identity.code })
  report.botUserId = typeof identity.value.user_id === 'string' ? identity.value.user_id : null
  report.teamId = typeof identity.value.team_id === 'string' ? identity.value.team_id : null

  if (args.mode === 'send') {
    const sent = await slackCall<{ ts?: unknown; channel?: unknown }>(transport, botToken, 'chat.postMessage', {
      channel: args.channelId ?? '',
      text: args.text ?? ''
    })
    if (!sent.ok) return print({ ...report, failure: sent.code })
    return print({ ...report, ok: true, messageId: typeof sent.value.ts === 'string' ? sent.value.ts : null })
  }

  const opened = await slackCall<{ url?: unknown }>(transport, appToken, 'apps.connections.open')
  if (!opened.ok) return print({ ...report, failure: opened.code })
  const url = typeof opened.value.url === 'string' ? opened.value.url : ''
  if (!url.startsWith('wss://')) return print({ ...report, failure: 'socket-url-invalid' })

  const hello = await socketModeHello(url, proxy)
  print({ ...report, ...hello })
}

function print(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${USAGE}\n\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
