import type { DatabaseSync } from 'node:sqlite'

import { countryCodeOfName } from './marketCalendarCountryNameCodes'
import { isUnknownCountryCode, toAlpha2Country } from './marketCalendarMetricIdentity'
import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **源把南非记成 `SA` 的写入端纠正**（0.4.5 计划清单第 59 行，用户 2026-11-25 拍）。
 *
 * 起因：0xrouter 的南非央行回购利率两条，源给 `countryCode = 'SA'`、`countryName = '南非' /
 * 'South Africa'` —— 码是沙特阿拉伯的、名是南非的，落库后这两行以**沙特**身份进库
 * （`calendarCountryNameCodes` 把 `SA` 显示成「沙特」）。同一个源的沙特阿美原油售价那行是
 * `SA` + `沙特`，**真的是沙特**。
 *
 * 所以这一笔的判据不是「`SA` 改 `ZA`」——那样会把沙特阿美那行一起改掉。判据是**源自己的码与名
 * 自相矛盾**时以名为准（名也是源给的事实，且已经有一张「名 → 码」表），并且
 * **只对 0xrouter 的行生效**：同一个 `SA` 在别的来源里完全可能是沙特，改全局等于伤它们。
 *
 * 两处落地：
 * - 写入端：`calendarEventDraft` 算完国家码后调 `correctSourceCountryCode`（新采集的行当场落对）；
 * - 历史行：`correctSourceRecordedCountries` 每次启动幂等跑一遍（判据是「还有没有源自相矛盾的行」，
 *   不是「跑过没有」），把观测、标准表、台账三处一起改——三处不一致会让「按身份匹配」的判据
 *   把正常行判成孤儿。
 */
export const sourceCountryCorrectionPolicy = Object.freeze({
  /**
   * 只对这一个源归一。加来源要单独判据：先确认那个源的码与名哪个可信，别顺着名单加。
   */
  providerIds: ['0xrouter'] as readonly string[],
  /** 首次执行前的整表快照；之后不再覆盖，保住「规则上线前」的原样。 */
  eventsBackupTable: 'mi_calendar_events__source_country_v1',
  observationsBackupTable: 'mi_macro_calendar_market_event_observations__source_country_v1',
  observationsTable: 'mi_macro_calendar_market_event_observations'
})

export type SourceCountryCorrectionReport = Readonly<{
  /** 源自相矛盾、需要改的观测行数（正常应为 0）。 */
  pending: number
  observations: number
  events: number
  ledger: number
  /**
   * 改完之后撞上「目标国家 + 同一身份 + 同一期 + 同一首发布日」已有行：
   * 本笔只改国家、不合并，报出来等人工判（含主键串）。
   */
  collisions: readonly string[]
}>

/**
 * 纯函数：源内码与名指向不同国家时，以**名**为准（只在声明过的来源作用域内）。
 *
 * - 名查不到（源给了新写法）→ 原样返回，不猜；
 * - 码归成两位之后与名一致（`AUS`/`JPN`/`UK` 这些写法）→ 原样返回，不算矛盾；
 * - 不在名单里的来源 → 原样返回。
 */
export function correctSourceCountryCode(input: Readonly<{
  providerId: string
  countryCode: string
  countryName?: string
}>): string {
  if (!sourceCountryCorrectionPolicy.providerIds.includes(input.providerId)) return input.countryCode
  const name = input.countryName?.trim() ?? ''
  if (name === '') return input.countryCode
  /**
   * 码本身认不出（`ZZZ` 这类）就**不动**：既有口径是「认不出的码原样留着、能数、等映射补上」，
   * 这里按名覆盖等于替源猜了个国家，还会让 `classifyCalendarCountryCodes` 那套计数失明。
   */
  if (isUnknownCountryCode(input.countryCode)) return input.countryCode
  const byName = countryCodeOfName(name)
  if (byName === undefined) return input.countryCode
  return toAlpha2Country(input.countryCode) === byName ? input.countryCode : byName
}

type ObservationRow = Readonly<{ observation_id: string; provider_id: string; source_event_id: string; country_code: string; country_name: string }>
type EventRow = Readonly<{ rowId: number; metric_key: string | null; period_key: string | null; first_scheduled_date: string | null }>

const emptyReport = (): SourceCountryCorrectionReport =>
  ({ pending: 0, observations: 0, events: 0, ledger: 0, collisions: [] })

/**
 * 历史行按同一条判据重归类：每次启动跑，幂等（判据是差集，不是版本标记）。
 *
 * 三处一起改，任何一处改不动就不留半截：
 * - 观测表（源名在这里，是判据的唯一出处）；
 * - 标准表（读者看见的国家）；
 * - 台账 `mi_calendar_event_source_ids`（按身份匹配的孤儿判据读它）。
 */
export function correctSourceRecordedCountries(database: DatabaseSync): SourceCountryCorrectionReport {
  const { eventsTable, sourceIdsTable } = calendarStandardTablePolicy
  const policy = sourceCountryCorrectionPolicy
  const hasObservations = database.prepare(
    "select 1 from sqlite_master where type = 'table' and name = ?").get(policy.observationsTable) !== undefined
  if (!hasObservations) return emptyReport()

  const placeholders = policy.providerIds.map(() => '?').join(', ')
  const candidates = database.prepare(`select observation_id, provider_id, source_event_id, country_code, country_name
    from ${policy.observationsTable}
    where provider_id in (${placeholders})
      and coalesce(trim(country_code), '') <> '' and coalesce(trim(country_name), '') <> ''`)
    .all(...policy.providerIds) as unknown as ObservationRow[]
  const plan = candidates
    .map((row) => ({ row, target: correctSourceCountryCode({
      providerId: row.provider_id, countryCode: row.country_code, countryName: row.country_name }) }))
    .filter((item) => item.target !== item.row.country_code)
  if (plan.length === 0) return emptyReport()

  const report = { pending: plan.length, observations: 0, events: 0, ledger: 0, collisions: [] as string[] }
  database.exec('begin')
  try {
    // 首次执行前的整表快照：只建一次，之后不再覆盖。
    database.exec(`create table if not exists ${policy.eventsBackupTable} as select * from ${eventsTable}`)
    database.exec(`create table if not exists ${policy.observationsBackupTable} as select * from ${policy.observationsTable}`)
    const renameObservation = database.prepare(`update ${policy.observationsTable} set country_code = ? where observation_id = ?`)
    const findEvent = database.prepare(`select rowid as rowId, metric_key, period_key, first_scheduled_date
      from ${eventsTable} where source_provider_id = ? and source_event_id = ?`)
    const findTwin = database.prepare(`select rowid as rowId from ${eventsTable}
      where country_code is ? and metric_key is ? and period_key is ? and first_scheduled_date is ? and rowid <> ?`)
    const renameEvent = database.prepare(`update ${eventsTable} set country_code = ? where rowid = ?`)
    const findLedger = database.prepare(`select 1 from ${sourceIdsTable} where provider_id = ? and source_event_id = ? limit 1`)
    const twinLedger = database.prepare(`select 1 from ${sourceIdsTable}
      where country_code is ? and metric_key is ? and period_key is ? and first_scheduled_date is ? limit 1`)
    const renameLedger = database.prepare(`update ${sourceIdsTable} set country_code = ? where provider_id = ? and source_event_id = ?`)

    for (const { row, target } of plan) {
      report.observations += Number(renameObservation.run(target, row.observation_id).changes)
      const event = findEvent.get(row.provider_id, row.source_event_id) as EventRow | undefined
      if (event !== undefined) {
        const twin = findTwin.get(target, event.metric_key, event.period_key, event.first_scheduled_date, event.rowId)
        if (twin !== undefined) {
          // 目标国家下已经有同一身份同一期的行：只改国家会撞主键，合并要逐字段判，留给人工。
          report.collisions.push(`${target}|${event.metric_key ?? ''}|${event.period_key ?? ''}|${event.first_scheduled_date ?? ''}`)
        } else {
          report.events += Number(renameEvent.run(target, event.rowId).changes)
        }
      }
      if (findLedger.get(row.provider_id, row.source_event_id) !== undefined) {
        const ledgerTwin = twinLedger.get(target, event?.metric_key ?? null, event?.period_key ?? null,
          event?.first_scheduled_date ?? null)
        if (ledgerTwin === undefined) {
          report.ledger += Number(renameLedger.run(target, row.provider_id, row.source_event_id).changes)
        }
      }
    }
    database.exec('commit')
    return report
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
