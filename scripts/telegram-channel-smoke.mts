#!/usr/bin/env node
/**
 * Telegram 的一次性连通诊断（只读 / 可发一条，不碰数据库、不写文件、不打印 Token）。
 *
 * 为什么要有它：这台机器直连 api.telegram.org 并不总通，必须走系统代理；而「用例全绿、
 * 手机一条都收不到」正是这类环境最容易出现的假绿。所以一条命令把三件事分开证：
 * 代理这一跳建得起来、Token 活着（`getMe`）、能收消息（`getUpdates` 短轮询一次）。
 *
 * 与适配器共用 `TelegramApiClient`（`getMe` / 短轮询 `probe` / `sendMessage`）。**没共用的一层是
 * 出网入口**：`platformFetch` 为了读 Electron 的会话代理在顶层 import 了 electron，只能跑在应用里；
 * 这里用同一套 `proxy-agent` 复现它的代理逻辑（同样先解析代理再连、同样带超时）。
 *
 * Token 只从 `$DSH_SECRET_TELEGRAM_BOT_TOKEN` 读，绝不落盘、绝不打印；输出一行脱敏 JSON：
 * `{ ok, mode, proxy, botUsername, updates, messageId, failure }`。
 *
 * 用法：
 *   DSH_SECRET_TELEGRAM_BOT_TOKEN=… pnpm telegram:smoke --probe --proxy http://127.0.0.1:7888
 *   DSH_SECRET_TELEGRAM_BOT_TOKEN=… pnpm telegram:smoke --send <chatId> "测试" --proxy http://127.0.0.1:7888
 *
 * `--proxy` 省略时依次看 `TELEGRAM_SMOKE_PROXY` / `HTTPS_PROXY` / `https_proxy`；都没有就是直连
 * （这台机器大概率失败，输出里 `proxy: "direct"`——那是「代理没配」，不是「适配器不行」）。
 *
 * 失败码分三类，别混着读：
 *   - 凭据错：`telegram-provider-rejected`
 *   - 网络/代理不通：`proxy-unreachable`（连代理这一跳都建不起来）、`telegram-network-unavailable`
 *   - 对方拒绝/占用：`telegram-conflict`（另一个进程正拿着这个 bot 拉更新）、`telegram-rate-limited`
 */
import { connect } from 'node:net'
import { request } from 'node:https'

import { ProxyAgent } from 'proxy-agent'

import { TelegramApiClient } from '../platform/ai/agent-platform/channels/telegram/TelegramApiClient'

type Args = { mode: 'probe' | 'send'; chatId?: string; text?: string; proxy?: string }

const USAGE = `Usage:
  telegram-channel-smoke --probe [--proxy <url>]
  telegram-channel-smoke --send <chatId> <text> [--proxy <url>]
Token comes from $DSH_SECRET_TELEGRAM_BOT_TOKEN. Nothing is written to disk and the token is never printed.`

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
  const value = explicit ?? process.env.TELEGRAM_SMOKE_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? ''
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

/**
 * 代理这一跳先单独证一次：`fetch` 层失败时，只有「代理根本连不上」和「代理通了但目标不可达」
 * 分得开，用户才知道该去开代理还是该去查网络。3 秒超时，连不上就停在这里，不再往下打接口。
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const token = process.env.DSH_SECRET_TELEGRAM_BOT_TOKEN?.trim()
  if (!token) throw new Error('DSH_SECRET_TELEGRAM_BOT_TOKEN is not set')

  const proxy = resolveProxy(args.proxy)
  const report: Record<string, unknown> = { ok: false, mode: args.mode, proxy: maskProxy(proxy) }
  if (proxy && !(await proxyReachable(proxy))) return print({ ...report, failure: 'proxy-unreachable' })

  const client = new TelegramApiClient({ getPlatformFetch: () => nodeFetchThroughProxy(proxy), token: async () => token })

  // 握手：Token 不对 / 被吊销 / 被网关挡住都在这一步分开。
  const identity = await client.botUsername(AbortSignal.timeout(15_000))
  if (!identity.ok) return print({ ...report, ...failureOf(identity) })
  report.botUsername = identity.value

  if (args.mode === 'send') {
    const sent = await client.sendMessage(args.chatId ?? '', args.text ?? '', true, AbortSignal.timeout(15_000))
    return print({ ...report, ok: sent.ok, ...(sent.ok ? { messageId: sent.value.messageId } : failureOf(sent)) })
  }

  // 接收往返：短轮询（`timeout: 0`），立刻返回；不在这里等新消息。
  const probe = await client.probe(AbortSignal.timeout(15_000))
  if (!probe.ok) return print({ ...report, ...failureOf(probe) })
  print({ ...report, ok: true, updates: probe.value.length })
}

/** 失败形状只留能查的两样：错误名（不含 URL）与 Telegram 自己的说明（已脱敏截断）。 */
function failureOf(
  result: { code: string; transportError?: string; providerDetail?: string }
): Record<string, unknown> {
  return {
    failure: result.code,
    ...(result.transportError ? { transportError: result.transportError } : {}),
    ...(result.providerDetail ? { detail: result.providerDetail } : {})
  }
}

function print(value: Record<string, unknown>): void {
  // 一行 JSON：脱敏后的结果，Token 从不出现在这里。
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${USAGE}\n\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})