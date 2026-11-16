import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'

/**
 * 一版生成只打一行：这一版宏观那栏最终写进文档的原因码，以及当时的年龄。
 *
 * 用户 2026-11-16 的埋点要求：今晚最费力的是「一直猜数字」，每个结论都要翻代码推一遍。
 * 这行把当时决策用的几个数直接写下，和日历线那两行 `[macro-calendar.freshness]` /
 * `[macro-calendar.catchup]` 用同一个 `asOf` 串起来，一条 grep 就能把一版的三条记录对齐。
 *
 * 只写这四个字段：原因码、年龄、窗口时长、这一版的读数时刻。**不写凭据、URL、来源 key**。
 */
export type BriefingMacroDiagnostic = Readonly<{
  asOf: string
  /** 最终写进文档的那条原因码；这一版宏观栏有事件（没走空态）时是 `null`。 */
  macroEmpty: string | null
  /** 最后一次成功采集距这一版读数时刻的分钟数；没有读数时是 `null`。 */
  ageMinutes: number | null
  windowHours: number
}>

export function briefingMacroDiagnostic(
  document: Pick<DailyBriefingDocument, 'news'>,
  packet: Pick<DailyBriefingFactPacket, 'asOf' | 'windowHours' | 'calendarFreshness'>
): BriefingMacroDiagnostic {
  const lastCollectedAt = packet.calendarFreshness?.lastCollectedAt
  const ageMs = lastCollectedAt === undefined ? Number.NaN : Date.parse(packet.asOf) - Date.parse(lastCollectedAt)
  return Object.freeze({
    asOf: packet.asOf,
    macroEmpty: document.news.notes.macroEmpty ?? null,
    ageMinutes: Number.isFinite(ageMs) ? Math.round((ageMs / 60_000) * 10) / 10 : null,
    windowHours: packet.windowHours
  })
}

export function formatBriefingMacroDiagnostic(input: BriefingMacroDiagnostic): string {
  return `[daily-briefing.macro] ${JSON.stringify(input)}`
}

/** 生成路径用的一行式入口：一版一次，字段见 `BriefingMacroDiagnostic`。 */
export function logBriefingMacroDiagnostic(
  document: Pick<DailyBriefingDocument, 'news'>,
  packet: Pick<DailyBriefingFactPacket, 'asOf' | 'windowHours' | 'calendarFreshness'>
): void {
  console.log(formatBriefingMacroDiagnostic(briefingMacroDiagnostic(document, packet)))
}
