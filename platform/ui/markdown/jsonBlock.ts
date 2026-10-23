/**
 * Owner: platform/ui/markdown（PLAT-64）。
 *
 * 助手回复里经常出现**整段结构化 JSON**（工具结果、卡片负载、`{"label":…,"text":…,"tone":…}` 之类的
 * 视图模型），此前被当作普通段落原样吐出：大括号、引号、转义全都露在正文里，读起来像日志。
 *
 * 这里的边界刻意收得很窄：
 * - 只看**整段**内容（去空白后首字符是 `{`/`[`、末字符是 `}`/`]`），句子里夹的行内 JSON 不处理，
 *   否则「举例：{"a":1} 表示……」这种正常句子会被改名成代码块；
 * - 必须 `JSON.parse` 成功，且**够长**（≥2 行或 ≥40 字符）：`{}`、`[]`、`{"a":1}` 这类碎片留在正文；
 * - 解析失败一律返回 `null`，调用方按纯文本原样渲染 —— 识别层的失败只能退回旧行为，绝不吞内容。
 */

export type JsonBlockKind = 'object' | 'array'

export type JsonBlock = {
  kind: JsonBlockKind
  /** 规范化后的 JSON 源码（2 空格缩进），代码块与卡片兜底都用它。 */
  source: string
  /** 规范化后的行数，折叠阈值按它算（原始单行 JSON 展开后也可能超过阈值）。 */
  lineCount: number
  value: unknown
}

/** 已知卡片形态：标题键 + 正文档。识别命中就出卡片，不命中就退回代码块。 */
export type JsonBlockCard = {
  title: string
  body: string
  /** 卡片没展示的其余字段个数；>0 时界面必须提供「原始 JSON」入口，避免卡片吞掉内容。 */
  extraFieldCount: number
}

export const JsonBlockShape = {
  /** 短于这个行数、且短于下面的字符数 ⇒ 不认为是结构化负载。 */
  minLines: 2,
  minCharacters: 40,
  /** 超过这个行数默认折叠，并保留「已折叠 N 行」提示。 */
  collapseAfterLines: 20
} as const

const CARD_TITLE_KEYS = ['title', 'name', 'label', 'heading'] as const
const CARD_BODY_KEYS = ['summary', 'text', 'description', 'body', 'content'] as const

export function parseJsonBlock(text: string): JsonBlock | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const kind = readJsonBlockKind(trimmed)
  if (!kind) return null
  if (trimmed.split('\n').length < JsonBlockShape.minLines && trimmed.length < JsonBlockShape.minCharacters) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const source = JSON.stringify(value, null, 2)
  return { kind, value, source, lineCount: source.split('\n').length }
}

export function readJsonBlockCard(block: JsonBlock): JsonBlockCard | null {
  if (block.kind !== 'object' || !block.value || typeof block.value !== 'object') return null
  const record = block.value as Record<string, unknown>
  const titleEntry = firstEntry(record, CARD_TITLE_KEYS)
  const bodyEntry = firstEntry(record, CARD_BODY_KEYS)
  if (!titleEntry || !bodyEntry) return null
  const shownKeys = new Set([titleEntry.key, bodyEntry.key])
  const extraFieldCount = Object.keys(record).filter((key) => !shownKeys.has(key)).length
  return { title: titleEntry.value, body: bodyEntry.value, extraFieldCount }
}

function readJsonBlockKind(trimmed: string): JsonBlockKind | null {
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if (first === '{' && last === '}') return 'object'
  if (first === '[' && last === ']') return 'array'
  return null
}

function firstEntry(
  record: Record<string, unknown>,
  keys: readonly string[]
): { key: string; value: string } | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return { key, value: value.trim() }
  }
  return null
}
