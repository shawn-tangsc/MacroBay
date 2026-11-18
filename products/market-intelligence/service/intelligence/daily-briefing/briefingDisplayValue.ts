import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'

/**
 * 日历条目的展示字符串：值对象只允许在 `.displayValue` 这一个边界上被解释成字符串。
 *
 * 线上缺陷（2026-11-18，`daily-briefings.sqlite` 00:08:03 那版）：宏观事件行的 `previous`
 * 落库成了 `{"displayValue":"4.7%"}`——某个分支把值对象直接序列化进了展示字段，读者在正文里
 * 看到一段 JSON。渲染本地化那几条路径本来都取 `.displayValue`，所以这是另一条没走同一处解释的路。
 *
 * 根因（2026-11-18 定位）：`narwhal` 标准行的 `values_json.previous` 本身就是
 * `'{"displayValue":"4.7%"}'` 这个**字符串**；标准表月读把它原样包成 `{ displayValue: … }`，
 * 于是 `.displayValue` 取得的是那段 JSON。解释必须发生在**简报读日历值的那一刻**：
 * `toDisplayText(…displayValue)` 一次，值进入 packet 就只剩普通字符串。
 */

export const BRIEFING_DISPLAY_VALUE_NOT_LOCALIZED = 'briefing-display-value-not-localized'

/** 展示字符串字段：只扫这几个，正文不在此列（正文里出现这段子串极不可能，也不该当数据看）。 */
export const briefingDisplayTextFields = Object.freeze(['actual', 'previous', 'consensus'] as const)

const SERIALIZED_OBJECT = /\{\s*"displayValue"\s*:/u

/**
 * 落库前的出口断言：文档里任何一个展示字段已经是 JSON 对象串就直接失败。
 *
 * **递归**扫整份文档：真正的路径是 `news.macro[]`（不是某个顶层数组），事件 id 取
 * `eventKey` / `eventId` / `id`。以前这里只看了 `document.calendarEvents`——那个字段不存在，
 * 于是线上这份坏文档能从断言下面走过去。
 *
 * 失败要指出**哪个事件、哪个字段**——只报「文档坏了」等于把定位工作留给下一个人。
 */
export function assertNoSerializedValueObjects(document: unknown): void {
  visit(document, [])
}

function visit(node: unknown, path: readonly string[]): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) => visit(child, [...path, String(index)]))
    return
  }
  if (node === null || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  for (const field of briefingDisplayTextFields) {
    const value = record[field]
    if (typeof value === 'string' && SERIALIZED_OBJECT.test(value)) {
      const id = record.eventId ?? record.eventKey ?? record.id ?? path.join('.')
      throw new Error(`${BRIEFING_DISPLAY_VALUE_NOT_LOCALIZED}:${String(id)}:${field}`)
    }
  }
  for (const [key, child] of Object.entries(record)) visit(child, [...path, key])
}

/**
 * 读侧还原：**只认**「单键 `displayValue` 的 JSON 对象」这一种形态，其它原样返回。
 *
 * 存量版次已经冻结进库，重新生成等于改写历史，所以历史坏串在读口还原（一处生效，界面/导出/推送
 * 三条读路径同时受益）。不写库、不迁移。
 */
export function toDisplayString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') || !SERIALIZED_OBJECT.test(trimmed)) return value
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value
    const record = parsed as Record<string, unknown>
    const keys = Object.keys(record)
    // 单键才认：多键说明这段串不是「值对象的序列化」，别猜。
    if (keys.length !== 1 || keys[0] !== 'displayValue' || typeof record.displayValue !== 'string') return value
    return record.displayValue
  } catch {
    return value
  }
}

/** 生成侧只有一个出口：值进 packet 前先过这一道，展示字段永远是普通字符串。 */
export function toDisplayText(value: unknown): string | undefined {
  const text = toDisplayString(value)
  return typeof text === 'string' ? text : undefined
}

/**
 * 读口的文档还原：只动宏观事件那三个展示字段，其它字段原样（同一个文档对象、只在真的有坏串时换新）。
 *
 * 传给界面/导出/推送的是**还原后的文档**；库里那份冻结的坏串不碰。
 */
export function restoreBriefingDisplayValues(document: DailyBriefingDocument): DailyBriefingDocument {
  const macro = document.news?.macro
  if (!Array.isArray(macro) || macro.length === 0) return document
  let changed = false
  const restored = macro.map((item) => {
    let itemChanged = false
    const next: Record<string, unknown> = { ...item }
    for (const field of briefingDisplayTextFields) {
      const current = next[field]
      const text = toDisplayString(current)
      if (text !== current) {
        next[field] = text
        itemChanged = true
      }
    }
    if (!itemChanged) return item
    changed = true
    return Object.freeze(next) as typeof item
  })
  if (!changed) return document
  return Object.freeze({
    ...document,
    news: Object.freeze({ ...document.news, macro: Object.freeze(restored) })
  })
}

/**
 * 命中的一条：哪个事件、哪个字段、能不能还原。诊断只写定位，不写值本身。
 *
 * `restored: false` 是「这段串解析出来是对象/数组，但不是单键 `displayValue`」——它在界面上
 * **照原样显示**（不猜），所以必须继续出现在计数里，否则它就成了看不见的那一半。
 */
export type SerializedDisplayValueHit = Readonly<{
  event: string
  field: 'actual' | 'previous' | 'consensus'
  restored: boolean
}>

/** 能解析成对象/数组的字符串才叫命中：存进去的是**文本**，按「值是不是对象」查会全绿（2026-11-18）。 */
function parsedSerializedValue(value: unknown): unknown {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return undefined
  }
}

/**
 * 只读地找出「展示字段里冻结了序列化对象」的那几条——**必须在还原之前问**，还原之后它们就看不见了。
 *
 * 判据按字符串形状认，不按对象认（架构师 2026-11-18：`json_type(...)='object'` 永远是 0，bug 还在）。
 */
export function serializedDisplayValueHits(document: DailyBriefingDocument): readonly SerializedDisplayValueHit[] {
  const macro = document.news?.macro
  if (!Array.isArray(macro)) return []
  const hits: SerializedDisplayValueHit[] = []
  for (const item of macro) {
    const record = item as unknown as Record<string, unknown>
    for (const field of briefingDisplayTextFields) {
      const value = record[field]
      const parsed = parsedSerializedValue(value)
      if (parsed === null || typeof parsed !== 'object') continue
      hits.push(Object.freeze({
        event: String(record.eventKey ?? record.eventId ?? record.id ?? 'unknown'),
        field,
        restored: toDisplayString(value) !== value
      }))
    }
  }
  return hits
}

/**
 * 读口一次性入口：还原 + 一行诊断（只在真的还原了东西时才打，存量归零后它永远静默）。
 *
 * 产品经理 2026-11-18：短期在读口还原，但**必须同时计数**，否则读侧一静默还原，这个错就再也
 * 看不见了。归零之后连 `toDisplayString` / `restoreBriefingDisplayValues` 一起删；落库前的
 * `assertNoSerializedValueObjects` 留着——那是读者之前的最后一道闸。
 */
export function restoreAndReportBriefingDisplayValues(document: DailyBriefingDocument): DailyBriefingDocument {
  const hits = serializedDisplayValueHits(document)
  if (hits.length === 0) return document
  console.log(`[daily-briefing.values] ${JSON.stringify({
    date: document.edition?.date ?? null,
    edition: document.edition?.generatedAt ?? null,
    restored: hits.filter(hit => hit.restored).length,
    kept: hits.filter(hit => !hit.restored).length,
    fields: hits.slice(0, 10).map(hit => `${hit.event}:${hit.field}${hit.restored ? '' : ':kept'}`)
  })}`)
  return restoreBriefingDisplayValues(document)
}
