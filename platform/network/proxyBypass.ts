import { classifyBypassRule, splitBypassRules } from '../settings/schema/proxyBypassRules'

/**
 * 代理绕过规则的**判定**：某主机是否命中规则。语法（切分/分类/规范化）归
 * `platform/settings/schema/proxyBypassRules.ts`，这里只读它的解析结果。
 *
 * 权威是 Chromium：`session.resolveProxy` 用同一份 `proxyBypassRules` 决定走不走代理，
 * WebSocket 侧必须读同一套语义，否则同一个设置会有两条出网路径各自解释。
 */

/** 与 Chromium 同一份规则的判定：`host` 可以是主机名或 IP 字面量。 */
export function shouldBypass(host: string, bypassRules: string): boolean {
  const normalizedHost = host.trim().toLowerCase()
  if (!normalizedHost) return false

  for (const rule of splitBypassRules(bypassRules).map((entry) => entry.toLowerCase())) {
    if (classifyBypassRule(rule) !== 'supported') continue
    if (rule === '*') return true
    if (rule === '<local>') {
      if (isLocalHostName(normalizedHost)) return true
      continue
    }
    if (rule.startsWith('*.')) {
      if (normalizedHost.endsWith(rule.slice(1))) return true
      continue
    }
    if (rule.startsWith('.')) {
      if (normalizedHost.endsWith(rule) || normalizedHost === rule.slice(1)) return true
      continue
    }
    const bareRule = rule.startsWith('[') && rule.endsWith(']') ? rule.slice(1, -1) : rule
    if (normalizedHost === bareRule) return true
  }

  return false
}

/** 从 URL 里取主机名；解析失败返回空串，调用方按「不绕过」处理。 */
export function hostnameOfUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Chromium 的 `<local>` 只匹配不含点的主机名（`localhost`、`intranet`），IP 字面量不算。 */
function isLocalHostName(host: string): boolean {
  return host === 'localhost' || !host.includes('.')
}
