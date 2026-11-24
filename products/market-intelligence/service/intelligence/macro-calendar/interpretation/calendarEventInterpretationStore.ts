import type { DatabaseSync } from 'node:sqlite'

import type { CalendarInterpretationFailureCode } from './calendarEventInterpretationPolicy'
import type { CalendarInterpretationLocale } from './calendarEventInterpretationEnvelope'

/**
 * 解读的落库（R36 技术方案 §4，迁移 12）。
 *
 * 三条硬规矩：
 * - **只插不改，失败行例外**：`ready` 行是那一刻的账，重跑不该覆盖它；`failed` 只是标记不是证据，
 *   重试写成新一行（同一主键）是允许的，否则「可重试」永远撞唯一键。
 * - **一份行只服务一种语言**：主键带 `locale`。把中文解读端给英文读者，就是一种最显眼的错；
 *   语言变了重新生成一次，比展示错语言的文字便宜。
 * - **读的是「这一份数据」的行**：`data_key` 变了就是另一份数据，旧行留在库里作审计，不拿来顶。
 */
export type CalendarInterpretationRow = Readonly<{
  eventKey: string
  dataKey: string
  locale: CalendarInterpretationLocale
  state: 'ready' | 'failed'
  text?: string
  modelRef?: string
  generatedAt: string
  snapshotHash: string
  evidenceScope: readonly string[]
  failureCode?: CalendarInterpretationFailureCode
}>

const table = 'mi_macro_calendar_event_interpretation'

type Row = Readonly<{
  event_key: string; data_key: string; locale: string; state: string; text: string | null
  model_ref: string | null; generated_at: string; snapshot_hash: string; evidence_scope_json: string
  failure_code: string | null
}>

function toRecord(row: Row): CalendarInterpretationRow {
  return {
    eventKey: row.event_key, dataKey: row.data_key, locale: row.locale as CalendarInterpretationLocale,
    state: row.state === 'ready' ? 'ready' : 'failed',
    ...(row.text === null ? {} : { text: row.text }),
    ...(row.model_ref === null ? {} : { modelRef: row.model_ref }),
    generatedAt: row.generated_at, snapshotHash: row.snapshot_hash,
    evidenceScope: JSON.parse(row.evidence_scope_json) as string[],
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code as CalendarInterpretationFailureCode })
  }
}

/** 这一份数据、这一种语言的那一行；没有就是没有（不拿别的 `data_key` 顶）。 */
export function readCalendarInterpretation(database: DatabaseSync, input: Readonly<{
  eventKey: string; dataKey: string; locale: CalendarInterpretationLocale
}>): CalendarInterpretationRow | undefined {
  const row = database.prepare(
    `select event_key, data_key, locale, state, text, model_ref, generated_at, snapshot_hash, evidence_scope_json, failure_code
       from ${table} where event_key = ? and data_key = ? and locale = ?`
  ).get(input.eventKey, input.dataKey, input.locale) as Row | undefined
  return row === undefined ? undefined : toRecord(row)
}

/** 这条事件最近一次写下的行（任何 `data_key`）：详情要能说「之前生成过、但数据已经变了」。 */
export function readLatestCalendarInterpretation(database: DatabaseSync, input: Readonly<{
  eventKey: string; locale: CalendarInterpretationLocale
}>): CalendarInterpretationRow | undefined {
  const row = database.prepare(
    `select event_key, data_key, locale, state, text, model_ref, generated_at, snapshot_hash, evidence_scope_json, failure_code
       from ${table} where event_key = ? and locale = ? order by generated_at desc limit 1`
  ).get(input.eventKey, input.locale) as Row | undefined
  return row === undefined ? undefined : toRecord(row)
}

/**
 * 写一行。`ready` 已存在时**不覆盖**（`where state = 'failed'`），失败行允许被这次结果替换。
 * 返回是否真的写入：调用方据此说「这次没有重写」还是「写了」。
 */
export function writeCalendarInterpretation(database: DatabaseSync, row: CalendarInterpretationRow): boolean {
  const result = database.prepare(
    `insert into ${table}
       (event_key, data_key, locale, state, text, model_ref, generated_at, snapshot_hash, evidence_scope_json, failure_code)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(event_key, data_key, locale) do update set
       state = excluded.state, text = excluded.text, model_ref = excluded.model_ref,
       generated_at = excluded.generated_at, snapshot_hash = excluded.snapshot_hash,
       evidence_scope_json = excluded.evidence_scope_json, failure_code = excluded.failure_code
     where ${table}.state = 'failed'`
  ).run(
    row.eventKey, row.dataKey, row.locale, row.state, row.text ?? null, row.modelRef ?? null,
    row.generatedAt, row.snapshotHash, JSON.stringify(row.evidenceScope), row.failureCode ?? null
  )
  return Number(result.changes) > 0
}