import type { DatabaseSync } from 'node:sqlite'

import { zeroXRouterCanonicalIdentity, zeroXRouterIndicatorIdentities } from './marketCalendarMetricIdentity'
import { derivePublishWindows } from './marketCalendarPublishWindow'
import { calendarStandardTablePolicy, hasActualValue } from './marketCalendarStandardTable'
import { isCalendarPeriodToken } from './marketCalendarPeriodKey'
import { releaseStatusesPromotedByValue } from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * **启动链幂等规范化**（用户 2026-11-19 批）：把这几轮清库用的三步固定下来，每次启动先跑一遍。
 *
 * 三步**只做**这些事，不许顺手做别的：
 * 1. `value_state` 重算：`present` ⇔ `values_json.actual` 非空（空串与 null 都算没值）；
 *    `missing`/`scheduled` 的行一旦有 actual 就把 `status` 推进到 `published`（`cancelled` 不动）。
 * 2. 期次解析（**只用项目里已有的规则**）：事件行 = 活动日期；身份行/码行 = 身份映射里的
 *    `periodRule`（`month` / `week_end` / `quarter` / `event_date`）。解不出保持 `unknown:`——
 *    那是「明确缺失」，不是缺陷。
 * 2. 桶一（同国家+码+首发布日 已有正常期次行时的 `unknown:` 重复）：**先于期次解析跑**——
 *    否则那条重复会被解析成另一个周次、躲过合并，落成同一发布的第二行（实测 MBA 那组）。
 *    规则：保留行没有的字段才补，然后删重复行。
 * 3. 期次解析；4. 桶二（同国家+码+期次 的多行）：有 actual 优先 → 都有取首发布日最晚 →
 *    都无取最早。**每一次删除都整行进 `mi_calendar_events__merge_audit_v1`**，记规则分支与保留目标行。
 *
 * 幂等：第二遍 0 变更。不碰国家码、不碰主键、不碰数值本身（桶一/桶二只为补空缺字段并值）。
 */
/**
 * 这一行的期次是不是「待解析」：`unknown:`（明确缺失），或者**不是任何一种期次令牌**
 * （`SECOND` / `ADVANCE` 这种修订序号被误当期次）。两者都不是缺陷行，而是还没解出真期次。
 */
function isUnresolvedPeriodKey(periodKey: string): boolean {
  return periodKey.startsWith('unknown:') || !isCalendarPeriodToken(periodKey)
}

export const calendarStartupNormalizationPolicy = Object.freeze({
  mergeAuditTable: 'mi_calendar_events__merge_audit_v1'
})

/** 报告里「被改名成 unknown 的原期次」最多列几条：多到看不出形状时就该去查代码，不是查日志。 */
const renamedFromSampleLimit = 10

export type CalendarNormalizationReport = Readonly<{
  scanned: number
  valueStateToPresent: number
  valueStateToMissing: number
  statusPromoted: number
  periodsResolved: number
  mergedRows: number
  droppedRows: number
  unresolvedPeriods: number
  /** 因「跨源值冲突」而**故意不并**的组数（同源两行仍按老规则合并）。 */
  conflictGroupsKept: number
  /**
   * 被改名成 `unknown:<源内发布 id>` 的行数，以及它们**原来的 `period_key`**（distinct、前几条）。
   *
   * 为什么记原值：改名是对的（那不是期次），但**漏认一种期次形状**也表现成「解析 N 条」。
   * 只记数量，日志里看不出是谁被改名了，下次还得翻库。
   */
  renamedToUnknown: number
  renamedFromPeriods: readonly string[]
  renamedFromDistinct: number
  /**
   * 改名撞上「目标行已存在」的次数：不再抛 UNIQUE，而是把值并进那一行、删本条。
   *
   * 撞车在今天的数据上还没出现，但旧写法是裸 `update`、主键含 `period_key`，一撞就抛——
   * 而整段规范化在一个 `try/catch` 里只记一行「失败（已忽略）」，于是**这一轮清理整段不跑**，
   * 日志还像「没事可做」。计数是为了它发生时能看见。
   */
  renameCollisions: number
}>

type Row = Record<string, unknown>

const fieldsOf = (valuesJson: unknown): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(String(valuesJson ?? '{}'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch { return {} }
}

const isFilled = (value: unknown): boolean => value !== null && value !== undefined && String(value).trim() !== ''

/** 把「保留行没有、被删行有」的字段补过去；保留行已有值**不覆盖**。返回是否写回。 */
function mergeMissingFields(keptValuesJson: unknown, otherValuesJson: unknown): { valuesJson: string; changed: boolean } {
  const kept = fieldsOf(keptValuesJson)
  let changed = false
  for (const [key, value] of Object.entries(fieldsOf(otherValuesJson))) {
    if (!isFilled(value)) continue
    if (isFilled(kept[key])) continue
    kept[key] = value
    changed = true
  }
  return { valuesJson: JSON.stringify(kept), changed }
}

const mergeAuditSchema = `create table if not exists %TABLE% (
  id integer primary key autoincrement,
  group_country_code text not null,
  group_metric_key text not null,
  group_period_key text not null,
  kept_rowkey text not null,
  rule text not null,
  deleted_row_json text not null,
  deleted_at text not null
)`

export function normalizeCalendarStandardRows(
  database: DatabaseSync,
  options: Readonly<{ nowIso?: string }> = {}
): CalendarNormalizationReport {
  const table = calendarStandardTablePolicy.eventsTable
  const { mergeAuditTable } = calendarStartupNormalizationPolicy
  const deletedAt = options.nowIso ?? new Date().toISOString()
  database.exec(mergeAuditSchema.replace('%TABLE%', mergeAuditTable))

  const report = {
    scanned: 0, valueStateToPresent: 0, valueStateToMissing: 0, statusPromoted: 0,
    periodsResolved: 0, mergedRows: 0, droppedRows: 0, unresolvedPeriods: 0, conflictGroupsKept: 0
  }
  let renamedToUnknown = 0
  let renameCollisions = 0
  // distinct：同一个假期次（例如一批 `SECOND`）只记一条，日志才读得懂。
  const renamedFrom = new Set<string>()
  const byCode = new Map<string, Array<{ id: string; entry: Record<string, unknown> }>>()
  for (const [id, entry] of Object.entries(zeroXRouterIndicatorIdentities)) {
    const list = byCode.get(entry.metricKey) ?? []
    list.push({ id, entry })
    byCode.set(entry.metricKey, list)
  }

  const readRow = database.prepare(`select * from ${table} where rowid = ?`)
  const audit = database.prepare(`insert into ${mergeAuditTable}
    (group_country_code, group_metric_key, group_period_key, kept_rowkey, rule, deleted_row_json, deleted_at)
    values (?,?,?,?,?,?,?)`)
  const keyOf = (row: Row): string =>
    `${String(row.country_code)}|${String(row.metric_key)}|${String(row.period_key)}|${String(row.first_scheduled_date)}`

  const archiveAndDelete = (rowId: number, group: Row, keptRowkey: string, rule: string): void => {
    const full = readRow.get(rowId) as Row
    audit.run(String(group.country_code), String(group.metric_key), String(group.period_key),
      keptRowkey, rule, JSON.stringify(full), deletedAt)
    database.prepare(`delete from ${table} where rowid = ?`).run(rowId)
    report.droppedRows += 1
  }

  database.exec('begin immediate')
  try {
    // ── 1. value_state 重算（只改状态字段） ──────────────────────────────────
    const rows = database.prepare(`select rowid as rowId, value_state, status, missing_reason, values_json
      from ${table}`).all() as Row[]
    report.scanned = rows.length
    const updateState = database.prepare(`update ${table} set value_state = ?, status = ?,
      missing_reason = case when ? = 1 then null else missing_reason end,
      missing_basis = case when ? = 1 then null else missing_basis end,
      missing_review_at = case when ? = 1 then null else missing_review_at end
      where rowid = ?`)
    for (const row of rows) {
      const present = hasActualValue(String(row.values_json))
      const nextState = present ? 'present' : 'missing'
      const status = String(row.status)
      // 「有实际值就升级成 published」的那几档写在契约里（`releaseStatusesPromotedByValue`），这里不抄字面量。
      const nextStatus = present && releaseStatusesPromotedByValue.includes(status as never) ? 'published' : status
      const clearReason = present && row.missing_reason !== null ? 1 : 0
      if (nextState === row.value_state && nextStatus === status && clearReason === 0) continue
      if (nextState === 'present' && row.value_state !== 'present') report.valueStateToPresent += 1
      if (nextState === 'missing' && row.value_state === 'present') report.valueStateToMissing += 1
      if (nextStatus !== status) report.statusPromoted += 1
      updateState.run(nextState, nextStatus, clearReason, clearReason, clearReason, Number(row.rowId))
    }

    // ── 1b. 桶一：同（国家+码+首发布日）已有正常期次行时，`unknown:` 重复先并值后删 ──
    //     抽成函数是因为它在「期次解析之后」还要再跑一遍（见步骤 2 末，#53）：解析可能刚好让
    //     一条 unknown 变成正常期次，于是同一身份出现「正常 + unknown」——那时该当场合掉，
    //     而不是等下一次启动。**原顺序不动**：它第一次仍然在解析之前跑。
    const mergeUnknownDuplicates = (): void => {
    const bucketOne = database.prepare(`select country_code, metric_key, first_scheduled_date
      from ${table} group by 1,2,3
      having sum(period_key not like 'unknown:%') > 0 and sum(period_key like 'unknown:%') > 0`).all() as Row[]
    const findNormal = database.prepare(`select rowid as rowId, * from ${table}
      where country_code = ? and metric_key = ? and first_scheduled_date = ? and period_key not like 'unknown:%'`)
    const findDuplicates = database.prepare(`select rowid as rowId, * from ${table}
      where country_code = ? and metric_key = ? and first_scheduled_date = ? and period_key like 'unknown:%'`)
    for (const group of bucketOne) {
      const normals = findNormal.all(String(group.country_code), String(group.metric_key),
        String(group.first_scheduled_date)) as Row[]
      if (normals.length !== 1) continue
      const kept = normals[0]!
      let keptValues = String(kept.values_json)
      let anyMerged = false
      const duplicates = findDuplicates.all(String(group.country_code), String(group.metric_key),
        String(group.first_scheduled_date)) as Row[]
      for (const duplicate of duplicates) {
        const merged = mergeMissingFields(keptValues, duplicate.values_json)
        if (merged.changed) { keptValues = merged.valuesJson; anyMerged = true }
      }
      if (anyMerged) {
        database.prepare(`update ${table} set values_json = ?, value_state = ? where rowid = ?`)
          .run(keptValues, hasActualValue(keptValues) ? 'present' : 'missing', Number(kept.rowId))
        report.mergedRows += 1
      }
      for (const duplicate of duplicates) {
        archiveAndDelete(Number(duplicate.rowId), group,
          keyOf({ ...kept, period_key: kept.period_key }),
          anyMerged ? 'merged-value-then-delete' : 'values-equal-direct-delete')
      }
    }
    }
    mergeUnknownDuplicates()

    // ── 2. 期次解析（只用已有 periodRule） ──────────────────────────────────
    // 发布窗口与回填共用同一套算法（从该源历史发布日现算）：期次反推必须两边一致，
    // 否则回填写下 2026-10、这里又把它「解」成 2026-11，同一行每轮翻一次。
    const publishWindows = derivePublishWindows(database)
    /**
     * **候选＝`unknown:` 的，加上「根本不是期次令牌」的**（0.4.5 #52）。
     * 后者以前漏在闸外：回放曾把 `US.GDP.2026-Q3.SECOND` 的末段当期次写成 `SECOND`，
     * 它不是 unknown、也不是期次，于是永远不被解析，与 BEA 的 `2026-Q3` 并存成两行。
     */
    const unresolved = (database.prepare(`select rowid as rowId, country_code, metric_key, period_key,
        scheduled_date, first_scheduled_date, coalesce(event_type, '') as event_type,
        source_event_id, source_label, source_label_en
      from ${table}`).all() as Row[]).filter((row) => isUnresolvedPeriodKey(String(row.period_key)))
    const rename = database.prepare(`update ${table} set period_key = ? where rowid = ?`)
    const index = new Map<string, number>()
    for (const row of database.prepare(`select rowid as rowId, country_code, metric_key, period_key, first_scheduled_date
      from ${table}`).all() as Row[]) index.set(keyOf(row), Number(row.rowId))
    for (const row of unresolved) {
      const isEvent = row.event_type === 'central-bank-activity' || row.event_type === 'financial-event'
      let period: string | null = null
      if (isEvent) period = String(row.scheduled_date).slice(0, 10)
      else if (String(row.metric_key).startsWith('[')) {
        const sourceId = /^\["([^"]+)"/.exec(String(row.metric_key))?.[1]
        const canonical = sourceId === undefined ? undefined : zeroXRouterCanonicalIdentity({
          countryCode: String(row.country_code), indicatorId: sourceId,
          scheduledAt: `${String(row.scheduled_date)}T00:00:00.000Z`,
          title: String(row.source_label_en ?? row.source_label ?? ''),
          window: publishWindows.get(sourceId)
        })
        period = canonical?.periodKey ?? null
      } else {
        const candidates = byCode.get(String(row.metric_key)) ?? []
        const hit = candidates.find((item) => item.entry.countryCode === row.country_code) ?? candidates[0]
        const canonical = hit === undefined ? undefined : zeroXRouterCanonicalIdentity({
          countryCode: String(row.country_code), indicatorId: hit.id,
          scheduledAt: `${String(row.scheduled_date)}T00:00:00.000Z`,
          title: String(row.source_label_en ?? row.source_label ?? ''),
          window: publishWindows.get(hit.id)
        })
        period = canonical?.periodKey ?? null
      }
      if (period === null) {
        /**
         * 解不出来，而它的期次**本来就不是期次**（`SECOND` 这类修订序号）：把它落成
         * 「明确缺失」`unknown:<源内发布 id>`，与同身份的另一行同一写法——否则它顶着一个
         * 假期次永远是「另一期」，后面的桶一/桶二都认不出它们是同一次发布（0.4.5 #52）。
         * 已经是 `unknown:` 的不动：那本来就是「明确缺失」。
         */
        const current = String(row.period_key)
        const currentKey = keyOf(row)
        if (!current.startsWith('unknown:')) {
          const target = { ...row, period_key: `unknown:${String(row.source_event_id)}` }
          const occupiedUnknown = index.get(keyOf(target))
          if (occupiedUnknown === undefined) {
            rename.run(String(target.period_key), Number(row.rowId))
            index.delete(currentKey)
            index.set(keyOf(target), Number(row.rowId))
            renamedToUnknown += 1
          } else {
            /**
             * **目标行已存在 → 并进去，不抛**（架构师 2026-11-24 复核）：裸 `update` 撞主键会抛
             * UNIQUE，而整段规范化在一个 `try/catch` 里，抛了就是这一轮清理整段停摆。
             * 与正常期次撞车（下面那段）同一个动作：补缺字段 → 归档 → 删本条。不许删保留方、
             * 不许改来源（这里是同一发布的两条重复观测，来源留谁的都行）。
             */
            const keptUnknown = readRow.get(occupiedUnknown) as Row
            const mergedUnknown = mergeMissingFields(keptUnknown.values_json, row.values_json)
            if (mergedUnknown.changed) {
              database.prepare(`update ${table} set values_json = ?, value_state = ? where rowid = ?`)
                .run(mergedUnknown.valuesJson, hasActualValue(mergedUnknown.valuesJson) ? 'present' : 'missing',
                  occupiedUnknown)
              report.mergedRows += 1
            }
            archiveAndDelete(Number(row.rowId), target, keyOf(keptUnknown), 'unknown-rename-collision')
            index.delete(currentKey)
            renameCollisions += 1
          }
          // 原值进报告：将来漏认一种形状时，能看出**是谁被改名了**（distinct，前几条就够）。
          renamedFrom.add(current)
        }
        report.unresolvedPeriods += 1
        continue
      }
      const currentKey = keyOf(row)
      const target = { ...row, period_key: period }
      const occupied = index.get(keyOf(target))
      if (occupied === undefined) {
        rename.run(period, Number(row.rowId))
        index.delete(currentKey)
        index.set(keyOf(target), Number(row.rowId))
        report.periodsResolved += 1
        continue
      }
      const kept = readRow.get(occupied) as Row
      const merged = mergeMissingFields(kept.values_json, row.values_json)
      if (merged.changed) {
        database.prepare(`update ${table} set values_json = ?, value_state = ? where rowid = ?`)
          .run(merged.valuesJson, hasActualValue(merged.valuesJson) ? 'present' : 'missing', occupied)
      }
      archiveAndDelete(Number(row.rowId), target, keyOf(kept), 'period-resolve-collision')
      index.delete(currentKey)
      report.periodsResolved += 1
    }
    // 解析之后当场再合一遍（#53）：本次刚解析出来的正常行，与同一身份仍挂着的 `unknown:` 重复。
    // 幂等：没有这种重复时它一条都不动。
    mergeUnknownDuplicates()

    /**
     * **跨源值冲突不并**（Chief 2026-11-21，0.4.5 #18）：两家对同一期给出不同的数时，
     * 合并会挑一行留下、另一行的值当场消失——读者看到的是一个来源的数，却以为是共识，
     * 事后也查不到「曾有两家不一致」。**同源两行仍按老规则合并**（那是同一家的修订）。
     */
    const conflictsIn = (group: readonly Row[]): readonly string[] => {
      if (new Set(group.map((row) => String(row.source_provider_id))).size < 2) return []
      const conflicted: string[] = []
      for (const field of ['actual', 'previous', 'consensus'] as const) {
        const values = new Set<string>()
        for (const row of group) {
          const value = fieldsOf(row.values_json)[field]
          if (isFilled(value)) values.add(String(value).trim())
        }
        if (values.size > 1) conflicted.push(field)
      }
      return conflicted
    }

    // ── 3b. 桶二：同（国家+码+期次）多行，按「有 actual → 最晚 → 最早」合并 ──────
    const duplicatesByPeriod = database.prepare(`select country_code, metric_key, period_key
      from ${table} group by 1,2,3 having count(*) > 1`).all() as Row[]
    for (const group of duplicatesByPeriod) {
      const rowsHere = database.prepare(`select rowid as rowId, * from ${table}
        where country_code = ? and metric_key = ? and period_key = ?`).all(
        String(group.country_code), String(group.metric_key), String(group.period_key)) as Row[]
      // 跨源且值不同：**一条都不删、不改**，留给冲突审计记一对互指；计数进报告，不静默。
      if (conflictsIn(rowsHere).length > 0) {
        report.conflictGroupsKept += 1
        continue
      }
      const ranked = rowsHere.map((row) => ({ row, hasActual: hasActualValue(String(row.values_json)) ? 1 : 0 }))
      ranked.sort((left, right) => {
        if (left.hasActual !== right.hasActual) return right.hasActual - left.hasActual
        const leftDate = String(left.row.first_scheduled_date)
        const rightDate = String(right.row.first_scheduled_date)
        return left.hasActual === 1 ? rightDate.localeCompare(leftDate) : leftDate.localeCompare(rightDate)
      })
      const kept = ranked[0]!.row
      const allActual = ranked.every((item) => item.hasActual === 1)
      const noneActual = ranked.every((item) => item.hasActual === 0)
      const branch = allActual ? 'latest-when-all-have-actual'
        : noneActual ? 'earliest-when-none-have-actual' : 'actual-priority'
      let keptValues = String(kept.values_json)
      let anyMerged = false
      for (const loser of ranked.slice(1)) {
        const merged = mergeMissingFields(keptValues, loser.row.values_json)
        if (merged.changed) { keptValues = merged.valuesJson; anyMerged = true }
      }
      if (anyMerged) {
        database.prepare(`update ${table} set values_json = ?, value_state = ? where rowid = ?`)
          .run(keptValues, hasActualValue(keptValues) ? 'present' : 'missing', Number(kept.rowId))
        report.mergedRows += 1
      }
      for (const loser of ranked.slice(1)) {
        archiveAndDelete(Number(loser.row.rowId), group, keyOf(kept), `period-resolve-dup/${branch}`)
      }
    }

    database.exec('commit')
    return { ...report, renamedToUnknown, renamedFromDistinct: renamedFrom.size,
      renamedFromPeriods: [...renamedFrom].slice(0, renamedFromSampleLimit), renameCollisions }
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
