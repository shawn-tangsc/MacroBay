#!/usr/bin/env node
/**
 * QQ 机器人（v2）的一次性连通诊断（只读，不碰数据库、不写文件、不打印凭据）。
 *
 * 两步各证一件事：
 * 1. `POST https://bots.qq.com/app/getAppAccessToken` —— `app_id + client_secret` 换得到 access token，
 *    即「凭据活着、出网通」；
 * 2. `GET https://api.sgroup.qq.com/gateway` —— 拿得到 wss 接入点，即「这把 token 有权限订阅事件」。
 *
 * 只证第 1 步的写法更省事，但机器人没开、没加进沙箱频道时它照样通过，而网关根本连不上——
 * 那正是「看起来配好了、一条都收不到」的形态。
 *
 * 与适配器共用 `exchangeQqAccessToken` / `readQqGateway`（协议依据写在那两个函数的文件头）。
 * **没共用的一层是出网入口**：`platformFetch` 为了读 Electron 的会话代理在顶层 import 了 electron，
 * 只能跑在应用里；这里用同一套 `proxy-agent` 复现它的代理逻辑。
 *
 * 凭据只从 `$DSH_SECRET_QQ_APP_ID` / `$DSH_SECRET_QQ_CLIENT_SECRET` 读，绝不落盘、绝不打印；
 * 输出一行脱敏 JSON：`{ ok, mode, proxy, expiresIn, gatewayHost, failure, step }`。
 * **网关 URL 里带着 token，所以只打 host，绝不打整条 URL。**
 *
 * 用法：
 *   DSH_SECRET_QQ_APP_ID=… DSH_SECRET_QQ_CLIENT_SECRET=… pnpm qq:smoke --probe --proxy http://127.0.0.1:7888
 *
 * `--proxy` 省略时依次看 `QQ_SMOKE_PROXY` / `HTTPS_PROXY` / `https_proxy`；都没有就是直连。
 *
 * 失败码分三类，`step` 指到是哪一步断的：
 *   - 凭据错：`qq-provider-rejected`（`step:"token"` = app_id/secret 不认；
 *     `step:"gateway"` = token 拿到了但网关拒绝，多半是机器人没开或没加进频道）
 *   - 网络/代理不通：`proxy-unreachable`（连代理这一跳都建不起来）、`qq-network-unavailable`
 *   - 对方限流：`qq-rate-limited`
 */
import { connect } from 'node:net'
import { request } from 'node:https'

import { ProxyAgent } from 'proxy-agent'

import { exchangeQqAccessToken, readQqGateway } from '../platform/ai/agent-platform/channels/qq/QqAccessToken'

type Args = { mode: 'probe'; proxy?: string }

const USAGE = `Usage:
  qq-channel-smoke --probe [--proxy <url>]
Credentials come from $DSH_SECRET_QQ_APP_ID and $DSH_SECRET_QQ_CLIENT_SECRET.
Nothing is written to disk and the credentials are never printed.`

function parseArgs(argv: readonly string[]): Args {
  const [mode, ...rest] = argv
  if (mode !== '--probe') throw new Error(USAGE)
  const proxyIndex = rest.indexOf('--proxy')
  const proxy = proxyIndex >= 0 ? rest[proxyIndex + 1] : undefined
  if (proxyIndex >= 0 && !proxy) throw new Error(USAGE)
  return { mode: 'probe', ...(proxy ? { proxy } : {}) }
}

function resolveProxy(explicit: string | undefined): string | null {
  const value = explicit ?? process.env.QQ_SMOKE_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? ''
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

/** 网关 URL 里的 token 不进输出：只留 host，够判「拿到的是不是真接入点」。 */
function gatewayHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'unparsable'
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const appId = process.env.DSH_SECRET_QQ_APP_ID?.trim()
  const clientSecret = process.env.DSH_SECRET_QQ_CLIENT_SECRET?.trim()
  if (!appId) throw new Error('DSH_SECRET_QQ_APP_ID is not set')
  if (!clientSecret) throw new Error('DSH_SECRET_QQ_CLIENT_SECRET is not set')

  const proxy = resolveProxy(args.proxy)
  const report: Record<string, unknown> = { ok: false, mode: args.mode, proxy: maskProxy(proxy) }
  if (proxy && !(await proxyReachable(proxy))) return print({ ...report, step: 'proxy', failure: 'proxy-unreachable' })

  const deps = { getPlatformFetch: () => nodeFetchThroughProxy(proxy) }

  const token = await exchangeQqAccessToken(deps, { appId, clientSecret }, AbortSignal.timeout(15_000))
  if (!token.ok) return print({ ...report, step: 'token', failure: token.code })

  const gateway = await readQqGateway(deps, token.value.accessToken, AbortSignal.timeout(15_000))
  if (!gateway.ok) return print({ ...report, step: 'gateway', expiresIn: token.value.expiresInSeconds, failure: gateway.code })

  print({
    ...report,
    ok: true,
    step: 'gateway',
    expiresIn: token.value.expiresInSeconds,
    gatewayHost: gatewayHost(gateway.value.url)
  })
}

function print(value: Record<string, unknown>): void {
  // 一行 JSON：脱敏后的结果，app_id 与 client_secret 从不出现在这里。
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${USAGE}\n\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})