/**
 * 代理绕过规则的**语法**：切分、分类、规范化。字段归 settings，规范化就归 settings，
 * 于是 `settings/schema` 不需要反向依赖 `network`（`network` 已经依赖 settings 的类型）。
 *
 * 判定（某主机是否命中某条规则）不在这里：那属出网语义，留在 `platform/network/proxyBypass.ts`。
 */

const SPECIAL_RULES = new Set(['<local>', '*'])

export type BypassRulesCheck =
  | { ok: true; rules: string[] }
  | { ok: false; unsupported: string[] }

export type RuleClassification = 'supported' | 'unsupported' | 'malformed'

export function splitBypassRules(value: string): string[] {
  return value
    // 历史数据用分号分隔；Chromium 只认逗号/空白，读取时要能一起切开。
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function classifyBypassRule(rule: string): RuleClassification {
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
  const rules = splitBypassRules(value)
  const unsupported = rules.filter((rule) => classifyBypassRule(rule) === 'unsupported')
  if (unsupported.length > 0) return { ok: false, unsupported }
  return {
    ok: true,
    rules: rules.filter((rule) => classifyBypassRule(rule) !== 'malformed').map((rule) => rule.toLowerCase())
  }
}

/**
 * 归一化只做格式（分隔符、大小写、去空白）并丢掉 malformed 残留；
 * **`unsupported` 是用户写的、有意义的规则，必须原样保留**——读的时候删掉，
 * 下一次保存就把用户的 CIDR 规则永久写没了，那段内网从此不再绕过代理。
 * 保存路径会用 `proxyRejectedBypassRule` 告诉他是哪几条不支持。
 */
export function normalizeBypassRules(value: string): string {
  return splitBypassRules(value)
    .filter((rule) => classifyBypassRule(rule) !== 'malformed')
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
