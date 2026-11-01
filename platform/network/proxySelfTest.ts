import { connect } from 'node:net'

export type ResolvedProxyEndpoint = { host: string; port: number }

export type ResolvedProxyRoute = {
  /** `session.resolveProxy` 的原始返回；展示给用户的就是它，不是输入框里的字符串。 */
  raw: string
  /** 第一跳是不是 DIRECT。是的话，「经代理」这句话就不成立。 */
  direct: boolean
  endpoint: ResolvedProxyEndpoint | null
}

/**
 * 解析 Chromium `session.resolveProxy` 的返回：`DIRECT`、`PROXY host:port`、
 * `SOCKS5 host:port`，多跳时以 `;` 分隔、第一跳为准。
 */
export function parseResolvedProxy(raw: string): ResolvedProxyRoute {
  const entries = raw
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const first = entries[0]
  if (!first || first.toUpperCase() === 'DIRECT') return { raw, direct: true, endpoint: null }

  const match = /^[A-Z0-9]+\s+(.+):(\d+)$/i.exec(first)
  if (!match) return { raw, direct: false, endpoint: null }
  const port = Number(match[2])
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return { raw, direct: false, endpoint: null }
  return { raw, direct: false, endpoint: { host: match[1], port } }
}

/**
 * 代理端点本身通不通：连不上是「代理坏了」，与目标站无关。
 * 只做一次 TCP 连接，不做任何应用层握手。
 */
export function isProxyEndpointReachable(
  endpoint: ResolvedProxyEndpoint,
  timeoutMs = 1500
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (reachable: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(reachable)
    }
    const socket = connect({ host: endpoint.host, port: endpoint.port })
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

/**
 * 代理端点是不是本机回环。回环上的连接不经过网络栈，连不上只能说明代理没起或端口错；
 * 非回环连不上则分不清本机断网、VPN、主机不在、防火墙四件事，不许归到代理或目标站。
 */
export function isLoopbackProxyEndpoint(hostOrEndpoint: string): boolean {
  const value = hostOrEndpoint.trim().toLowerCase()
  if (!value) return false
  const host = value.startsWith('[')
    ? value.slice(1, value.indexOf(']'))
    : value.slice(0, value.lastIndexOf(':') > 0 ? value.lastIndexOf(':') : value.length)
  const normalized = host.replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '::1') return true
  return /^127\./.test(normalized)
}

/**
 * R33 的对照探针：**不经代理**地验证本机能不能出一个 TCP 连接。
 *
 * 这是全仓唯一一处故意绕开平台代理设置的出网动作，也是唯一一处允许直接连外部 IP 的地方：
 * 它的语义就是「不经代理」，走 `platformFetch` 会跟随 session 代理、结论立刻失真。
 * 除对照探针外，产品与平台代码仍必须走 `platform/network` 的适配器，不许在这里开第二例。
 *
 * 只在用户主动点「测试网络」时调用，不许在启动或定时任务里后台跑。
 */
/** 两个不同归属的裸 IP：任一通即说明本机能出网，全部不通才算探针失败。 */
export const DIRECT_PROBE_ENDPOINTS: readonly ResolvedProxyEndpoint[] = Object.freeze([
  { host: '1.1.1.1', port: 443 },
  { host: '8.8.8.8', port: 443 }
])
export const DIRECT_PROBE_TIMEOUT_MS = 1000

export async function probeDirectEgress(
  endpoints: readonly ResolvedProxyEndpoint[] = DIRECT_PROBE_ENDPOINTS,
  timeoutMs = DIRECT_PROBE_TIMEOUT_MS
): Promise<boolean> {
  const results = await Promise.all(endpoints.map((endpoint) => isProxyEndpointReachable(endpoint, timeoutMs)))
  return results.some(Boolean)
}
