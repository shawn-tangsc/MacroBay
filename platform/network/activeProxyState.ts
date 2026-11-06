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
