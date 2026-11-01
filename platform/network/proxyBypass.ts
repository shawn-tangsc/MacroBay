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
    // 历史数据用分号分隔；Chromium 只认逗号/空白，读取时要能一起切开。
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

type RuleClassification = 'supported' | 'unsupported' | 'malformed'

function classifyRule(rule: string): RuleClassification {
  const normalized = rule.toLowerCase()
  if (!normalized) return 'malformed'
  if (SPECIAL_RULES.has(normalized)) return 'supported'
  // CIDR、端口、其它 `<...>` 指令都超出这套语义：保存时明确拒绝。
  if (normalized.includes('/')) return 'unsupported'
  if (isBracketedIpv6(normalized)) {
    // `[::1]` 是合法的 IPv6 字面量；`[::1]:8080` 是端口写法，不受支持。
    return normalized.endsWith(']') ? 'supported' : 'unsupported'
  }
  if (normalized.startsWith('<') || normalized.endsWith('>')) return 'unsupported'
  if (normalized.includes(':')) {
    if (isIpv6Literal(normalized)) return 'supported'
    // `host:8080` 是端口写法；`:1` 这种没有主机名的条目是历史残留，直接丢弃而不是拒绝整份设置。
    return hasHostPart(normalized) ? 'unsupported' : 'malformed'
  }
  if (normalized.startsWith('*.')) return normalized.length > 2 ? 'supported' : 'malformed'
  if (normalized.startsWith('.')) return normalized.length > 1 ? 'supported' : 'malformed'
  return 'supported'
}

/**
 * 保存前检查：只拒绝「语法超出能力」的条目；历史残留（如 `:1`）直接丢弃，
 * 不然一个旧条目会让用户连改语言的保存都被挡住。
 */
export function checkBypassRules(value: string): BypassRulesCheck {
  const rules = splitRules(value)
  const unsupported = rules.filter((rule) => classifyRule(rule) === 'unsupported')
  if (unsupported.length > 0) return { ok: false, unsupported }
  return {
    ok: true,
    rules: rules.filter((rule) => classifyRule(rule) === 'supported').map((rule) => rule.toLowerCase())
  }
}

/** 归一化成 Chromium 语法：逗号分隔、丢弃历史残留条目。读取与保存共用这一份。 */
export function normalizeBypassRules(value: string): string {
  return splitRules(value)
    .filter((rule) => classifyRule(rule) === 'supported')
    .map((rule) => rule.toLowerCase())
    .join(',')
}

function isIpv6Literal(rule: string): boolean {
  const value = rule.replace(/^\[|\]$/g, '')
  if (!value.includes(':')) return false
  if (!/^[0-9a-f:.]+$/i.test(value)) return false
  return (value.match(/:/g)?.length ?? 0) >= 2
}

function isBracketedIpv6(rule: string): boolean {
  return rule.startsWith('[') && /^\[[0-9a-f:.]+\](?::\d+)?$/i.test(rule)
}

function hasHostPart(rule: string): boolean {
  return (rule.split(':')[0] ?? '').length > 0
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
