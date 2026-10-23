/**
 * PLAT-61：代理地址只展示到 host:port。
 * 账号密码（userinfo）、查询串、路径一律丢弃 —— 代理自检与环境块共用这一条规则。
 */
export function sanitizeProxyAddressForDisplay(rawUrl: string): string | null {
  const raw = rawUrl.trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    const withoutUserInfo = raw.split('@').pop() ?? ''
    return withoutUserInfo.length > 0 ? withoutUserInfo : null
  }
}
