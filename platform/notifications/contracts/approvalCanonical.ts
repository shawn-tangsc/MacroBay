import { createHash } from 'node:crypto'

import type { NotificationApprovedLevel } from './notificationEventCatalog'

/**
 * 批准值签署的规范化与哈希——**唯一实现**，别处不许再写第二份。
 *
 * 规则由架构师定死（2026-11-08），这里只照做：
 * 1. 进哈希的是 `events` 全量 + `signedBy` + `signedAt`：只签事件的话，换一个签署人不用重算，
 *    等于可以冒名。
 * 2. 每个事件条目**只允许三个键**，多一个报错；`events` 不许为空。
 * 3. 档位按 **ASCII 字典序**排，不按枚举顺序——枚举是类型实现细节，改一次声明就会废掉所有历史
 *    签名；重复档位**报错不去重**，去重会把写错签成合法。
 * 4. `surfaceGroup` 没有就写 `null`，**键不许省**；`approvedBypassQuietHours` 必须显式布尔，
 *    缺键报错（缺 ≠ false）。
 * 5. 事件 id 与 `surfaceGroup` 只收 ASCII `[a-z0-9.-]`；`signedBy` 允许中文，但先做 NFC 规范化
 *    再进哈希；空串一律报错。
 * 6. 单行 JSON、无空白、无尾随换行，键按 ASCII 字典序**显式构造**，不靠字面量书写顺序。
 * 7. `sha256` over UTF-8 字节，返回 `sha256:<64 位小写十六进制>`。
 */

export type SignedApprovalEvent = {
  approvedDisruptionLevels: readonly NotificationApprovedLevel[]
  approvedBypassQuietHours: boolean
  surfaceGroup: string | null
}

export type SignedApprovalDocument = {
  formatVersion: 1
  signedBy: string
  signedAt: string
  events: Readonly<Record<string, SignedApprovalEvent>>
}

const ASCII_TOKEN = /^[a-z0-9.-]+$/u
const SIGNED_AT = /^\d{4}-\d{2}-\d{2}$/u
const ENTRY_KEYS = ['approvedBypassQuietHours', 'approvedDisruptionLevels', 'surfaceGroup'] as const

/** ASCII 字典序：按 UTF-16 码元比较即等同 ASCII 顺序（这些值限定在 ASCII 内）。 */
function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function requireToken(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`approval-canonical: ${field} must be a non-empty string`)
  if (!ASCII_TOKEN.test(value)) throw new Error(`approval-canonical: ${field} must match [a-z0-9.-]: ${value}`)
  return value
}

function requireEntry(eventId: string, entry: unknown): SignedApprovalEvent {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`approval-canonical: event ${eventId} must be an object`)
  }
  const record = entry as Record<string, unknown>
  const keys = Object.keys(record)
  // 缺 ≠ false：先单独报这个码，再谈别的缺键。
  if (!keys.includes('approvedBypassQuietHours')) throw new Error('approval-bypass-missing')
  for (const key of keys) {
    if (!(ENTRY_KEYS as readonly string[]).includes(key)) {
      throw new Error(`approval-canonical: event ${eventId} has an unknown key: ${key}`)
    }
  }
  for (const key of ENTRY_KEYS) {
    if (!keys.includes(key)) throw new Error(`approval-canonical: event ${eventId} is missing ${key}`)
  }
  // 显式布尔：缺失不是 false（缺失在这里已经被上面拦掉），非布尔也拦。
  if (typeof record.approvedBypassQuietHours !== 'boolean') {
    throw new Error(`approval-canonical: event ${eventId} approvedBypassQuietHours must be a boolean`)
  }
  const levels = record.approvedDisruptionLevels
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error(`approval-canonical: event ${eventId} approvedDisruptionLevels must be a non-empty array`)
  }
  const seen = new Set<string>()
  for (const level of levels) {
    if (typeof level !== 'string' || level.length === 0) {
      throw new Error(`approval-canonical: event ${eventId} approvedDisruptionLevels contains an invalid value`)
    }
    // 重复档位报错，不去重：去重会把写错签成合法。
    if (seen.has(level)) throw new Error('approval-levels-duplicated')
    seen.add(level)
  }
  // 没有就写 null，但键不许省：省略与 null 是两种状态，不能混。
  if (!keys.includes('surfaceGroup')) throw new Error(`approval-canonical: event ${eventId} is missing surfaceGroup`)
  const rawSurfaceGroup = record.surfaceGroup
  const surfaceGroup = rawSurfaceGroup === null
    ? null
    : requireToken(rawSurfaceGroup, `event ${eventId} surfaceGroup`)
  return {
    approvedDisruptionLevels: [...levels].sort(compareAscii) as readonly NotificationApprovedLevel[],
    approvedBypassQuietHours: record.approvedBypassQuietHours,
    surfaceGroup
  }
}

/** 规范化成单行 JSON：无空白、无换行、无尾随换行；键按 ASCII 字典序显式构造。 */
export function canonicalApprovalText(doc: SignedApprovalDocument): string {
  if (!doc || typeof doc !== 'object') throw new Error('approval-canonical: document must be an object')
  if (doc.formatVersion !== 1) throw new Error('approval-canonical: formatVersion must be 1')
  if (typeof doc.signedBy !== 'string' || doc.signedBy.length === 0) {
    throw new Error('approval-canonical: signedBy must be a non-empty string')
  }
  if (typeof doc.signedAt !== 'string' || !SIGNED_AT.test(doc.signedAt)) {
    throw new Error('approval-canonical: signedAt must be YYYY-MM-DD')
  }
  const eventIds = Object.keys(doc.events ?? {})
  if (eventIds.length === 0) throw new Error('approval-canonical: events must not be empty')

  const events: Record<string, SignedApprovalEvent> = {}
  for (const eventId of eventIds.slice().sort(compareAscii)) {
    requireToken(eventId, 'event id')
    const entry = requireEntry(eventId, doc.events[eventId])
    // 条目内键序同样是显式构造：approvedBypassQuietHours → approvedDisruptionLevels → surfaceGroup。
    events[eventId] = {
      approvedBypassQuietHours: entry.approvedBypassQuietHours,
      approvedDisruptionLevels: entry.approvedDisruptionLevels,
      surfaceGroup: entry.surfaceGroup
    }
  }

  const canonical = {
    events,
    formatVersion: 1,
    signedAt: doc.signedAt,
    // signedBy 先 NFC 规范化再进哈希：一种字形的两种写法必须签出同一个值。
    signedBy: doc.signedBy.normalize('NFC')
  }
  return JSON.stringify(canonical)
}

/** `sha256:<64 位小写十六进制>`，对规范化文本的 UTF-8 字节求哈希。 */
export function signApprovals(doc: SignedApprovalDocument): string {
  const digest = createHash('sha256').update(canonicalApprovalText(doc), 'utf8').digest('hex')
  return `sha256:${digest}`
}
