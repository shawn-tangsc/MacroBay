import type { FieldSource, KindSource } from './modelListShape'

/**
 * PLAT-77：语义取值器。
 *
 * 只做"从一条 payload 里把某个语义读出来"，不关心它属于哪家厂商。
 * 返回值区分三种情况：
 *  - `declared: true` + `value`：上游给了值（**包括布尔 false**，那也是声明）；
 *  - `declared: false`：上游没给，交给 id/type 推断兜底。
 */
export type FieldRead<T> = { readonly declared: true; readonly value: T } | { readonly declared: false }

const NOT_DECLARED: FieldRead<never> = { declared: false }

/** 取嵌套路径；任一层不是对象就返回 undefined。 */
export function readPath(item: unknown, path: string): unknown {
  let current: unknown = item
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

type MatchSource = Extract<FieldSource, { readonly read: 'match' }>

/**
 * `read:'match'`：在 `path` 指向的数组里找 `item[where.path] === where.equals`
 * 的第一项（字符串比较，trim 后不区分大小写），返回它 `valuePath` 的值。
 * 数组不存在、不是数组、没有命中、`valuePath` 类型不对 ⇒ 交给调用方判"未声明"。
 */
function readMatchTarget(item: unknown, source: MatchSource): unknown {
  const list = readPath(item, source.path)
  if (!Array.isArray(list)) return undefined
  const expected = source.where.equals.trim().toLowerCase()
  for (const entry of list) {
    const candidate = readPath(entry, source.where.path)
    if (typeof candidate === 'string' && candidate.trim().toLowerCase() === expected) {
      return readPath(entry, source.valuePath)
    }
  }
  return undefined
}

function readBooleanSource(item: unknown, source: FieldSource): FieldRead<boolean> {
  // `match` 只用于"按 type 命中后读数值/字符串"（价格等），不参与布尔语义。
  if (source.read === 'match') return NOT_DECLARED
  const raw = readPath(item, source.path)
  if (source.read === 'includes') {
    if (!Array.isArray(raw)) return NOT_DECLARED
    const token = source.token.trim().toLowerCase()
    return { declared: true, value: raw.some((entry) => String(entry).trim().toLowerCase() === token) }
  }
  if (source.read === 'split-includes') {
    // 逗号分隔字符串（如 `"chat_completions,responses"`）：切分后 trim + 不区分大小写。
    //
    // **空串 / 全空白 = 未声明**，不是"声明了不支持"：很多厂商用空串表示"没填这条信息"
    // （AIHubMix 的 `endpoints` 有 769 条空串）。若把空串当成显式 false，同步会把整家中转站
    // 标成"明确不支持 messages/responses"，直接影响智能体候选与模型行文案。
    if (typeof raw !== 'string') return NOT_DECLARED
    const trimmed = raw.trim()
    if (trimmed.length === 0) return NOT_DECLARED
    const token = source.token.trim().toLowerCase()
    return { declared: true, value: trimmed.split(',').some((entry) => entry.trim().toLowerCase() === token) }
  }
  if (source.read === 'non-empty') {
    if (raw === undefined || raw === null) return NOT_DECLARED
    if (Array.isArray(raw)) return { declared: true, value: raw.length > 0 }
    if (typeof raw === 'string') return { declared: true, value: raw.trim().length > 0 }
    if (typeof raw === 'object') return { declared: true, value: Object.keys(raw as object).length > 0 }
    return { declared: true, value: Boolean(raw) }
  }
  return typeof raw === 'boolean' ? { declared: true, value: raw } : NOT_DECLARED
}

function readNumberSource(item: unknown, source: FieldSource): FieldRead<number> {
  if (source.read === 'includes' || source.read === 'split-includes' || source.read === 'non-empty') return NOT_DECLARED
  const raw = source.read === 'match' ? readMatchTarget(item, source) : readPath(item, source.path)
  const parsed = toNumber(raw)
  if (parsed === undefined) return NOT_DECLARED
  const scale = source.scale ?? 1
  return { declared: true, value: parsed * scale }
}

function readStringSource(item: unknown, source: FieldSource): FieldRead<string> {
  if (source.read === 'includes' || source.read === 'split-includes' || source.read === 'non-empty') return NOT_DECLARED
  const raw = source.read === 'match' ? readMatchTarget(item, source) : readPath(item, source.path)
  return isNonEmptyString(raw) ? { declared: true, value: raw.trim() } : NOT_DECLARED
}

function firstDeclared<T>(
  item: unknown,
  sources: readonly FieldSource[] | undefined,
  read: (item: unknown, source: FieldSource) => FieldRead<T>
): FieldRead<T> {
  for (const source of sources ?? []) {
    const result = read(item, source)
    if (result.declared) return result
  }
  return NOT_DECLARED
}

export function readBooleanField(item: unknown, sources: readonly FieldSource[] | undefined): FieldRead<boolean> {
  return firstDeclared(item, sources, readBooleanSource)
}

export function readNumberField(item: unknown, sources: readonly FieldSource[] | undefined): FieldRead<number> {
  return firstDeclared(item, sources, readNumberSource)
}

export function readStringField(item: unknown, sources: readonly FieldSource[] | undefined): FieldRead<string> {
  return firstDeclared(item, sources, readStringSource)
}

/** 按顺序取第一个非空字符串（用于显示名）。 */
export function readFirstString(item: unknown, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const raw = readPath(item, path)
    if (isNonEmptyString(raw)) return raw.trim()
  }
  return undefined
}

export type KindReading = {
  /** 归一化（trim + 小写）后的观测值集合。 */
  readonly values: readonly string[]
  /** 传给 `inferModelCapabilities` 的原始 type（只取 `read:'value'` 的那个来源）。 */
  readonly typeValue: string | undefined
}

/**
 * 读取模型类型：
 * - `read:'value'` → 单值，同时作为 `type` 透传给能力推断（保持旧的 `visual_model` 语义）；
 * - `read:'includes'` → 数组里出现的所有已知值（如 `['TextGeneration']`、`['generateContent', …]`）；
 * - `read:'split-includes'` → 逗号分隔字符串里的每一项（如 `"image_generation,llm"`）。
 */
export function readKindValues(item: unknown, sources: readonly KindSource[]): KindReading {
  const values: string[] = []
  let typeValue: string | undefined
  for (const source of sources) {
    const raw = readPath(item, source.path)
    if (source.read === 'includes') {
      if (!Array.isArray(raw)) continue
      for (const entry of raw) {
        if (isNonEmptyString(entry)) values.push(entry.trim().toLowerCase())
      }
      continue
    }
    if (source.read === 'split-includes') {
      if (typeof raw !== 'string') continue
      for (const entry of raw.split(',')) {
        if (isNonEmptyString(entry)) values.push(entry.trim().toLowerCase())
      }
      continue
    }
    if (!isNonEmptyString(raw)) continue
    if (typeValue === undefined) typeValue = raw.trim()
    values.push(raw.trim().toLowerCase())
  }
  return { values, typeValue }
}
