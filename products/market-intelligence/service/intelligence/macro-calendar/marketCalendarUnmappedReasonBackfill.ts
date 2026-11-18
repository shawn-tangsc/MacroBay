/**
 * **未映射原因的重算**（幂等，启动链与采集前各跑一次）。
 *
 * 为什么要有：`missing-country` 是**写入那一刻**的原因。国家后来补上了、码后来建出来了，
 * 那一行却还挂着旧原因——1871 条里有一千多条早就不是「缺国家」了，盘点读到的永远是假数。
 * 2026-11-18 Chief 定：重算一遍，把有国家的改判成真实原因，然后接进启动链，让它自己保持正确。
 *
 * 分类只看**事实**，不看字面：
 * 1. 源自己给的 `eventKind` 不是 `economic-indicator`（央行活动、金融事件）→ 事件；
 * 2. 已转正（`identity_kind = 'code'）或源内 id 在按国家的映射表里且同国家 → 清单里的过期条目，删；
 * 3. 标准表里根本没有这一行（采集时缺国家被跳过）→ `no-standard-row`：不在等映射；
 * 4. 标题能唯一对上该国码表的一个码：测度定得出期次（`MOM`/`YOY`/`QOQ`）→ 缺的是映射条目，
 *    读者眼里仍是「没有码」→ `no-code`；测度定不出（`LEVEL`/`AMOUNT`/…) → `period-unresolved`
 *    （码认出来了，缺的是源没给统计期）；
 * 5. 其余 → `no-code`。
 *
 * 三条硬约束：
 * - **幂等**：同一库跑两次结果一致，第二次不会有任何写；
 * - **跑前备份**：第一次写之前把整表复制到 `mi_calendar_unmapped__reasons_v26`，只建一次，不覆盖；
 * - **不猜期次**：`LEVEL` 那批就是「源没给统计期」，不改写、不推算（见 15 号文档第二十三节）。
 */
import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'
import { marketCalendarCodeTable } from './marketCalendarCodeTable'
import { marketCalendarCountryCodeTable } from './marketCalendarCountryCodeTable'
import { marketCalendarCountrySourceMappings } from './marketCalendarCountrySourceMappings'

export const unmappedReasonBackupTable = 'mi_calendar_unmapped__reasons_v26'

export type UnmappedReasonReport = Readonly<{
  scanned: number
  deleted: number
  updated: number
  counts: Readonly<Partial<Record<string, number>>>
}>

const PERIOD = [/^第[一二三四]季度/u, /^\d{4}年/u, /^\d{1,2}月/u, /^\d{1,2}-\d{1,2}月/u,
  /\((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\)/iu, /\(Q[1-4]\)/iu]
const STAGE = [/\(Preliminary\)/iu, /\(Final\)/iu, /\(Revised\)/iu, /^初值/u, /^终值/u, /^修正值/u,
  /\(初值\)/u, /\(终值\)/u, /\(修正值\)/u]

/** 剥掉期次与阶段后比对：名字属于那一行，码不该带着它。 */
function comparableName(name: string): string {
  let text = name.replaceAll('（', '(').replaceAll('）', ')').trim()
  for (let round = 0; round < 4; round += 1) {
    const before = text
    for (const pattern of PERIOD) text = text.replace(pattern, '').trim()
    for (const pattern of STAGE) text = text.replace(pattern, '').trim()
    if (text === before) break
  }
  return text.toLowerCase()
}

/** 该国码表里，名字命中的码（中文名或英文名，剥掉期次后精确相等）。 */
function codesByName(): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>()
  const rows = [...Object.values(marketCalendarCodeTable), ...Object.values(marketCalendarCountryCodeTable)]
  for (const row of rows) {
    if (row.kind !== 'metric' || row.status === 'retired' || row.countryCode === null) continue
    for (const name of [row.names.zhFull, row.names.enFull]) {
      const comparable = comparableName(name)
      if (comparable === '') continue
      const key = `${row.countryCode}|${comparable}`
      index.set(key, [...(index.get(key) ?? []), row.code])
    }
  }
  return index
}

const PERIOD_RULES = new Set(['MOM', 'YOY', 'QOQ'])

export function recomputeUnmappedReasons(database: DatabaseSync, options?: Readonly<{ dryRun?: boolean }>):
UnmappedReasonReport {
  const { eventsTable, unmappedTable } = calendarStandardTablePolicy
  const byName = codesByName()
  const rows = database.prepare(`select rowid, source_key, raw_json, reason from ${unmappedTable}`).all() as
    { rowid: number; source_key: string; raw_json: string; reason: string }[]
  const eventRow = database.prepare(`select country_code, identity_kind from ${eventsTable}
    where source_event_id = ? limit 1`)

  const deletions: number[] = []
  const updates: { rowid: number; reason: string }[] = []
  const counts: Record<string, number> = {}
  for (const row of rows) {
    const parsedRaw = ((): Record<string, unknown> => {
      try {
        const value: unknown = JSON.parse(row.raw_json)
        return value !== null && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown> : {}
      } catch { return {} }
    })()
    const name = typeof parsedRaw.name === 'string' ? parsedRaw.name : ''
    const eventKind = typeof parsedRaw.eventKind === 'string' ? parsedRaw.eventKind : ''
    const parts = ((): string[] => {
      try {
        const value: unknown = JSON.parse(row.source_key)
        return Array.isArray(value) ? value.map((item: unknown) => String(item)) : []
      } catch { return [] }
    })()
    const event = (eventRow.get(row.source_key) ?? (parts[0] === undefined ? undefined : eventRow.get(parts[0]))) as
      { country_code: string | null; identity_kind: string } | undefined
    const country = event?.country_code ?? null

    let reason: string
    if (eventKind !== '' && eventKind !== 'economic-indicator') reason = 'unknown-event-type'
    else if (event?.identity_kind === 'code') reason = 'stale'
    // 没有标准行：当年因缺国家被跳过，之后没人写回来——它不在等映射（没有行可挂）。
    else if (event === undefined) reason = 'no-standard-row'
    else if (country === null) reason = 'no-code'
    else {
      const mapped = parts[0] === undefined ? undefined : marketCalendarCountrySourceMappings[parts[0]]
      if (mapped !== undefined && mapped.metricKey.startsWith(`${country}.`)) reason = 'stale'
      else {
        const matches = [...new Set(byName.get(`${country}|${comparableName(name)}`) ?? [])]
        if (matches.length !== 1) reason = 'no-code'
        // 码已经认出来了（名字唯一命中）、缺的只是统计期 → `period-unresolved`：
        // 映射那一半做完了，缺的是源没给的那一半，不该算「未映射」。
        else reason = PERIOD_RULES.has(matches[0]!.split('.')[3] ?? '') ? 'no-code' : 'period-unresolved'
      }
    }
    if (reason === 'stale') { deletions.push(row.rowid); counts['已过期（删）'] = (counts['已过期（删）'] ?? 0) + 1 }
    else {
      counts[reason] = (counts[reason] ?? 0) + 1
      if (reason !== row.reason) updates.push({ rowid: row.rowid, reason })
    }
  }

  const report: UnmappedReasonReport = Object.freeze({
    scanned: rows.length, deleted: deletions.length, updated: updates.length, counts: Object.freeze(counts),
  })
  if (options?.dryRun === true) return report
  if (deletions.length === 0 && updates.length === 0) return report

  // **跑前备份**：整表复制一份，只建一次；第二次跑不再覆盖（否则备份会被自己的结果污染）。
  database.exec(`create table if not exists ${unmappedReasonBackupTable} as select * from ${unmappedTable}`)
  const remove = database.prepare(`delete from ${unmappedTable} where rowid = ?`)
  const relabel = database.prepare(`update ${unmappedTable} set reason = ? where rowid = ?`)
  database.exec('begin')
  try {
    for (const rowid of deletions) remove.run(rowid)
    for (const item of updates) relabel.run(item.reason, item.rowid)
    database.exec('commit')
  } catch (error) {
    database.exec('rollback')
    throw error
  }
  return report
}
