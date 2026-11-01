/**
 * 代理绕过规则的**唯一**解析与判定。
 *
 * 权威是 Chromium：`session.resolveProxy` 用同一份 `proxyBypassRules` 决定走不走代理，
 * WebSocket 侧必须读同一套语义，否则同一个设置会有两条出网路径各自解释。
 * 这里只实现 Chromium 支持的、我们愿意保存的语法：`<local>`、`*`、`*.suffix`、`.suffix`、精确主机名。
 * 端口、CIDR、`<...>` 其它指令一律拒绝，由保存路径告诉用户，而不是保存后悄悄不生效。
 */

const SPECIAL_RULES = new Set(['<local>', '*'])

export type BypassRulesCheck =
  | { ok: true; rules: string[] }
  | { ok: false; unsupported: string[] }

function splitRules(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function isSupportedRule(rule: string): boolean {
  const normalized = rule.toLowerCase()
  if (SPECIAL_RULES.has(normalized)) return true
  // 端口（`host:8080`）、CIDR（`10.0.0.0/8`）、其它 `<...>` 指令都超出这套语义。
  if (normalized.includes('/')) return false
  if (normalized.includes(':')) return false
  if (normalized.startsWith('<') || normalized.endsWith('>')) return false
  if (normalized.startsWith('*.')) return normalized.length > 2
  if (normalized.startsWith('.')) return normalized.length > 1
  return normalized.length > 0
}

/** 保存前检查：返回不支持的条目，空数组表示全部可以保存。 */
export function checkBypassRules(value: string): BypassRulesCheck {
  const rules = splitRules(value)
  const unsupported = rules.filter((rule) => !isSupportedRule(rule))
  if (unsupported.length > 0) return { ok: false, unsupported }
  return { ok: true, rules: rules.map((rule) => rule.toLowerCase()) }
}

/** 与 Chromium 同一份规则的判定：`host` 可以是主机名或 IP 字面量。 */
export function shouldBypass(host: string, bypassRules: string): boolean {
  const normalizedHost = host.trim().toLowerCase()
  if (!normalizedHost) return false

  for (const rule of splitRules(bypassRules).map((entry) => entry.toLowerCase())) {
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
    if (normalizedHost === rule) return true
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
