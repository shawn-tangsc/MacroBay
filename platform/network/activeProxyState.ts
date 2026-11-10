import { session } from 'electron'

/**
 * 这次请求**实际**会走哪条代理——问 Chromium，不靠猜。
 *
 * 为什么需要它：用户 2026-11-04 反复被「网络或代理连不通」打回，而我们连「代理到底生效了没有」
 * 都拿不出证据。`session.resolveProxy(url)` 是 Chromium 自己给出的答案（`PROXY 127.0.0.1:7888`
 * 或 `DIRECT`），比读设置、比猜调用栈都直接。
 *
 * 两条边界：
 * - **脱敏**：只回 `PROXY host:port` / `SOCKS5 host:port` / `DIRECT` 这类协议与主机，不带凭据、
 *   不带 URL、不带 token。返回值会进审计 summary，属于可以留在库里的那一类。
 * - **纯诊断**：不申请任何东西、不改代理、失败就返回 `unknown`，绝不因为它把请求弄失败。
 */
export async function describeActiveProxy(url: string): Promise<string> {
  try {
    const resolved = await session.defaultSession.resolveProxy(url)
    const match = /^(DIRECT|PROXY|SOCKS4|SOCKS5|HTTPS?)\s+([^\s;,]+)/i.exec(resolved.trim())
    if (!match) return resolved.trim().toUpperCase().startsWith('DIRECT') ? 'DIRECT' : 'unknown'
    return `${match[1].toUpperCase()} ${match[2]}`
  } catch {
    return 'unknown'
  }
}

/** 代理解析的三种答案：显式直连、走某条代理、解析不出来（调用方必须把最后一种当成「不连」）。 */
export type ActiveProxyDecision = { kind: 'direct' } | { kind: 'proxy'; url: string }

/**
 * 长连接那类「连不上就静默失败」的传输，需要先问清代理再动手：
 * Chromium 说 DIRECT 就是直连；给了某条代理就带上它；**解析不出来的返回 `null`**，
 * 由调用方拒绝连接——落回默认直连会把「代理没配」伪装成「适配器坏了」。
 */
export async function resolveActiveProxy(targetUrl: string): Promise<ActiveProxyDecision | null> {
  try {
    const resolved = await session.defaultSession.resolveProxy(targetUrl)
    if (/^\s*DIRECT/i.test(resolved)) return { kind: 'direct' }
    const match = /^(PROXY|SOCKS4|SOCKS5|HTTPS?)\s+([^\s;,]+)/i.exec(resolved.trim())
    if (!match) return null
    const scheme = match[1].toUpperCase().startsWith('SOCKS')
      ? 'socks5'
      : match[1].toLowerCase() === 'https' ? 'https' : 'http'
    return { kind: 'proxy', url: `${scheme}://${match[2]}` }
  } catch {
    return null
  }
}
