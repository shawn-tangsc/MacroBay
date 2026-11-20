import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { marketCalendarCodeTable } from './marketCalendarCodeTable'
import { marketCalendarCountryCodeTable } from './marketCalendarCountryCodeTable'
import { auditCalendarIntegrity, calendarIntegrityGaps } from './marketCalendarIntegrityAudit'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/**
 * 五项扫描的判据（用户 2026-11-19 定）：任一不为 0 就说明数据又开始往回长。
 * 每条用例**先种一条违规**再断言计数——守卫红得起来，才证明它真的在看数据。
 */
const today = '2026-11-19'
const now = '2026-11-19T03:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  return database
}

const tierOneCode = [...new Map([...Object.values(marketCalendarCodeTable),
  ...Object.values(marketCalendarCountryCodeTable)].map((row) => [row.code, row])).values()]
  .find((row) => row.status === 'active' && (row.tier === 1 || row.tier === 2))!.code

type Seed = Readonly<{
  metricKey?: string
  periodKey?: string
  firstScheduledDate?: string
  valueState?: string
  valuesJson?: string
  status?: string
  missingReason?: string
  identityKind?: 'code' | 'source'
}>

let seq = 0
function seed(database: DatabaseSync, over: Seed = {}): void {
  seq += 1
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision,
     status, identity_kind, value_state, values_json, source_provider_id, source_event_id,
     parser_version, observed_at, first_seen_at, missing_reason, release_count)
    values ('US', ?, ?, ?, ?, 'date', ?, ?, ?, ?, 'test', ?, 'v1', ?, ?, ?, 1)`)
    .run(over.metricKey ?? tierOneCode, over.periodKey ?? `2026-0${(seq % 9) + 1}`,
      over.firstScheduledDate ?? '2026-11-01', over.firstScheduledDate ?? '2026-11-01',
      over.status ?? 'published', over.identityKind ?? 'code', over.valueState ?? 'missing', over.valuesJson ?? '{}',
      `x-${seq}`, now, now, over.missingReason ?? null)
}

const audit = (database: DatabaseSync) => auditCalendarIntegrity(database, { today })

describe('日历数据一致性盘点', () => {
  it('干净库五项都是 0', () => {
    const database = setup()
    seed(database, { valueState: 'present', valuesJson: '{"actual":"1.2%"}' })
    const counts = audit(database)
    expect(counts).toEqual({
      presentWithoutActual: 0, missingWithActual: 0, duplicateGroups: 0, duplicateRows: 0,
      tierOverdueWithoutValueOrReason: 0, unresolvedPeriodRows: 0, typeNameIdentities: 0,
      unregisteredSourceNames: 0
    })
    expect(calendarIntegrityGaps(counts)).toEqual([])
  })

  it('① 标着有值却只有前值 → presentWithoutActual=1', () => {
    const database = setup()
    seed(database, { valueState: 'present', valuesJson: '{"previous":"6.57"}' })
    expect(audit(database).presentWithoutActual).toBe(1)
    expect(calendarIntegrityGaps(audit(database))).toContain('present-without-actual=1')
  })

  /**
   * 0.4.5 #15：身份槽位里写进了**类型名**（`financial-event`）。写入口已经不再这么写，
   * 但存量行必须在盘点里可见——它不是一条发布，地址/名字/分级都只能退到名字串层。
   * 盘点**只报不改**：改身份要动主键与台账，属于另一件事。
   */
  it('类型名被当成身份 → typeNameIdentities 计数并进缺口，行不动', () => {
    const database = setup()
    seed(database, { metricKey: 'financial-event', identityKind: 'source', valuesJson: '{}' })
    const counts = audit(database)
    expect(counts.typeNameIdentities).toBe(1)
    expect(calendarIntegrityGaps(counts)).toContain('type-name-identity=1')
    const row = database.prepare("select metric_key, identity_kind from mi_calendar_events where metric_key = 'financial-event'")
      .get() as { metric_key: string; identity_kind: string }
    expect(row).toEqual({ metric_key: 'financial-event', identity_kind: 'source' })
  })

  /**
   * 0.4.5 #14：源侧会给出机翻残句（`transmutation…`）。判据不是「名字里有什么字」，
   * 而是「这一条源内身份登记了没有」——没登记的计数上屏，登记了的算有名字。
   */
  it('源内身份没登记显示名 → 按身份去重计数并进缺口；登记过的、非法 JSON 的不算', () => {
    const database = setup()
    // 同一个未登记身份的两行 → 只算 1 个身份（计数是「待起名的身份数」）。
    seed(database, { metricKey: '["45210",79716]', identityKind: 'source', periodKey: '2026-07' })
    seed(database, { metricKey: '["45210",79717]', identityKind: 'source', periodKey: '2026-08' })
    const counts = audit(database)
    expect(counts.unregisteredSourceNames).toBe(1)
    expect(calendarIntegrityGaps(counts)).toContain('unregistered-source-names=1')
    // 名字表里登记过的身份不算缺口（`9553` 在 `sourceIdentityDisplayNames` 里）。
    const registered = setup()
    seed(registered, { metricKey: '["9553",79716]', identityKind: 'source' })
    expect(audit(registered).unregisteredSourceNames).toBe(0)
    // 非法 JSON 的数组身份不参与（按 JSON 解析不了，谈不上登记）。
    const invalid = setup()
    seed(invalid, { metricKey: '["45210", 79716', identityKind: 'source' })
    expect(audit(invalid).unregisteredSourceNames).toBe(0)
  })

  it('“0” 是真值，不算 ① 也不该被当成没值', () => {
    const database = setup()
    seed(database, { valueState: 'present', valuesJson: '{"actual":"0%"}' })
    expect(audit(database).presentWithoutActual).toBe(0)
  })

  it('② 标着没值却有 actual → missingWithActual=1', () => {
    const database = setup()
    seed(database, { valueState: 'missing', valuesJson: '{"actual":"3.1%"}' })
    expect(audit(database).missingWithActual).toBe(1)
  })

  it('③ 同国家同码同期两行（首发布日不同）→ 1 组 / 2 行', () => {
    const database = setup()
    seed(database, { periodKey: '2026-09', firstScheduledDate: '2026-10-01' })
    seed(database, { periodKey: '2026-09', firstScheduledDate: '2026-10-03' })
    const counts = audit(database)
    expect(counts.duplicateGroups).toBe(1)
    expect(counts.duplicateRows).toBe(2)
  })

  it('④ 一二级码发布日已过、无值、无原因 → 计 1；写了原因就不算', () => {
    const database = setup()
    seed(database, { firstScheduledDate: '2026-11-01' })
    expect(audit(database).tierOverdueWithoutValueOrReason).toBe(1)
    const explained = setup()
    seed(explained, { firstScheduledDate: '2026-11-01', missingReason: 'source-no-value' })
    expect(audit(explained).tierOverdueWithoutValueOrReason).toBe(0)
  })

  it('④ 今天发布的不算欠账（first_scheduled_date 不早于今天）', () => {
    const database = setup()
    seed(database, { firstScheduledDate: today })
    expect(audit(database).tierOverdueWithoutValueOrReason).toBe(0)
  })

  it('⑤ 期次没解开 → unresolvedPeriodRows 计数', () => {
    const database = setup()
    seed(database, { periodKey: 'unknown:x-1' })
    expect(audit(database).unresolvedPeriodRows).toBe(1)
  })

  it('读不到表时抛错（交给调用方吞掉，不在这里画成 0）', () => {
    const database = setup()
    database.exec('drop table mi_calendar_events')
    expect(() => audit(database)).toThrow()
  })
})
