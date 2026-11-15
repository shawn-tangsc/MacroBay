import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'
import { releaseStatusBackfillPolicy } from './marketCalendarReleaseStatusRule'

/**
 * **发布后补值扫描**（第 3 笔）。
 *
 * 过期、没有实际值、状态还不是终态的行，按节拍向**已有的官方值来源**要一次值（注入的
 * `readActual`，卡片读数那条链已经在用它，不另造第二条）；拿到 → `published` + 写 actual；
 * 拿不到 → 窗口内 `backfilling`、窗口外或次数用尽 `missing`。
 *
 * 三条硬边界：
 * 1. **结构性无值不发请求**：`evt.*` 事件码与 `US.FOMC.*` 决议本来就没有实际值，直接落
 *    `missing`（原因 `structurally-absent`）——否则每次扫描会白打几十个请求；
 * 2. **同一轮同一条只请求一次**：按（指标码, 期次）去重，多个测度行共用一次读数；
 * 3. **只填空字段**：已有 `actual` 不覆盖（逐字段合并那套在写入端，这里先看有没有）。
 */
export type ReleaseValueBackfillReport = Readonly<{
  scanned: number
  requests: number
  filled: number
  structural: number
  stillBackfilling: number
  gaveUp: number
}>

type Row = Readonly<{ country_code: string; metric_key: string; period_key: string; first_scheduled_date: string
  scheduled_date: string; scheduled_at: string | null; status: string; values_json: string }>

const isStructural = (metricKey: string): boolean =>
  metricKey.startsWith('evt.') || metricKey.startsWith('US.FOMC.')

const actualOf = (valuesJson: string): string | undefined => {
  try {
    const values = JSON.parse(valuesJson) as { actual?: unknown }
    return typeof values.actual === 'string' && values.actual.trim() !== '' ? values.actual : undefined
  } catch { return undefined }
}

export function backfillExpiredReleaseValues(database: DatabaseSync, input: Readonly<{
  today: string
  nowMs: number
  /** 已有的官方值来源：给出该指标该期的最新实际值（拿不到返回 undefined）。 */
  readActual: (metricKey: string, periodKey: string) => Promise<string | undefined>
  /** 只扫描这么多行，避免一次启动打爆来源（默认 20）。 */
  maximumReads?: number
}>): Promise<ReleaseValueBackfillReport> {
  const rows = database.prepare(`select country_code, metric_key, period_key, first_scheduled_date,
      scheduled_date, scheduled_at, status, values_json
    from ${calendarStandardTablePolicy.eventsTable}
    where scheduled_date <= ? and status in ('scheduled', 'backfilling', 'unknown')
      and row_kind = 'release'`).all(input.today) as unknown as Row[]
  const update = database.prepare(`update ${calendarStandardTablePolicy.eventsTable}
    set status = ?, values_json = ?, value_state = ?, observed_at = ?
    where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?`)
  const maximumReads = input.maximumReads ?? 20
  const seen = new Set<string>()
  let requests = 0
  let filled = 0
  let structural = 0
  let stillBackfilling = 0
  let gaveUp = 0
  const observedAt = new Date(input.nowMs).toISOString()
  return (async () => {
    for (const row of rows) {
      const releaseAtMs = Date.parse(row.scheduled_at ?? `${row.scheduled_date}T00:00:00.000Z`)
      const expiredLongAgo = input.nowMs - (Number.isFinite(releaseAtMs) ? releaseAtMs : input.nowMs)
        > releaseStatusBackfillPolicy.windowMs
      if (isStructural(row.metric_key)) {
        // 结构性无值：不发请求，直接终态（原因 `structurally-absent`）。
        update.run('missing', row.values_json, 'missing', observedAt,
          row.country_code, row.metric_key, row.period_key, row.first_scheduled_date)
        structural += 1
        continue
      }
      if (actualOf(row.values_json) !== undefined) continue
      const key = `${row.metric_key}|${row.period_key}`
      let value: string | undefined
      if (!seen.has(key) && requests < maximumReads) {
        seen.add(key)
        requests += 1
        value = await input.readActual(row.metric_key, row.period_key)
      }
      if (value !== undefined) {
        const values = JSON.stringify({ actual: value })
        update.run('published', values, 'present', observedAt,
          row.country_code, row.metric_key, row.period_key, row.first_scheduled_date)
        filled += 1
        continue
      }
      // 没拿到：窗口内继续等，窗口外或这一轮之后不再等（次数上限由调用频率自然约束）。
      if (expiredLongAgo) {
        update.run('missing', row.values_json, 'missing', observedAt,
          row.country_code, row.metric_key, row.period_key, row.first_scheduled_date)
        gaveUp += 1
      } else {
        update.run('backfilling', row.values_json, 'missing', observedAt,
          row.country_code, row.metric_key, row.period_key, row.first_scheduled_date)
        stillBackfilling += 1
      }
    }
    return { scanned: rows.length, requests, filled, structural, stillBackfilling, gaveUp }
  })()
}
