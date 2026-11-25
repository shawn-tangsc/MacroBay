import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { calendarEventDraft } from './0xrouter-calendar/marketCalendarStorageContracts'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'
import {
  correctSourceCountryCode, correctSourceRecordedCountries, sourceCountryCorrectionPolicy
} from './marketCalendarSourceCountryCorrection'

/**
 * 源把南非记成 `SA`（0.4.5 计划清单第 59 行，用户 2026-11-25 拍）。
 *
 * 判据不是「`SA` 改 `ZA`」——0xrouter 里真的有一行沙特（阿美原油售价，`SA` + `沙特`）。
 * 判据是**源自己的码与名自相矛盾**时以名为准，且只在 0xrouter 作用域内改：
 * 同一个 `SA` 在别的来源里完全可能是沙特，全局改会伤它。
 */
describe('源内国家纠正：写入端', () => {
  it('0xrouter 的 SA + 南非（中英两种写法）→ ZA；SA + 沙特 仍是 SA', () => {
    const correct = (countryName: string, countryCode = 'SA'): string =>
      correctSourceCountryCode({ providerId: '0xrouter', countryCode, countryName })
    expect(correct('南非')).toBe('ZA')
    expect(correct('South Africa')).toBe('ZA')
    // 沙特阿美那行是真的沙特：码与名一致，不许顺手改掉。
    expect(correct('沙特')).toBe('SA')
    expect(correct('Saudi Arabia')).toBe('SA')
  })

  it('别的来源不动：同一个 SA + 南非，非 0xrouter 原样返回', () => {
    expect(correctSourceCountryCode({ providerId: 'narwhal', countryCode: 'SA', countryName: '南非' })).toBe('SA')
  })

  it('码与名指向同一国家时不改（AUS/JPN/UK 这类写法不是矛盾）；名字查不到也不猜', () => {
    expect(correctSourceCountryCode({ providerId: '0xrouter', countryCode: 'AUS', countryName: 'Australia' })).toBe('AUS')
    expect(correctSourceCountryCode({ providerId: '0xrouter', countryCode: 'UK', countryName: '英国' })).toBe('UK')
    expect(correctSourceCountryCode({ providerId: '0xrouter', countryCode: 'SA', countryName: '某个新写法' })).toBe('SA')
  })

  /** 走一遍真实的解析器：draft 是观测与标准表共同的上游，改这里两处一起对。 */
  it('解析 0xrouter 的一行 SA + 南非：draft 的国家码是 ZA；SA + 沙特 仍是 SA', () => {
    const draftFor = (countryCode: string, countryName: string) => calendarEventDraft({
      calendarId: '215645', id: 79763, calendarName: '南非央行公布利率决议', locale: 'zh',
      star: 3, countryCode, countryName, pubTimestamp: 1795000000000
    }, 'zh', 'macro-calendar-0xrouter-economic-data', 'economic-indicator')
    expect(draftFor('SA', '南非')?.countryCode).toBe('ZA')
    expect(draftFor('SA', '沙特')?.countryCode).toBe('SA')
  })
})

describe('源内国家纠正：历史行', () => {
  function setup(): DatabaseSync {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
    database.exec(`create table if not exists mi_macro_calendar_market_event_observations (
      observation_id text primary key, provider_id text not null, source_event_id text not null,
      country_code text, country_name text, display_name text)`)
    return database
  }

  type Seed = Readonly<{ provider: string; sourceEventId: string; metricKey: string; countryCode: string; countryName: string }>

  function seed(database: DatabaseSync, input: Seed): void {
    database.prepare(`insert into mi_calendar_events
      (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision,
       status, identity_kind, source_label, value_state, values_json, source_provider_id, source_event_id,
       parser_version, observed_at, first_seen_at, event_type, release_count)
      values (?, ?, '2026-11', '2026-11-19', '2026-11-19', 'date', 'scheduled', 'source', ?, 'missing', '{}',
        ?, ?, 'v1', '2026-11-19T03:00:00.000Z', '2026-11-19T03:00:00.000Z', 'economic-indicator', 1)`)
      .run(input.countryCode, input.metricKey, `事件 ${input.metricKey}`, input.provider, input.sourceEventId)
    database.prepare(`insert into mi_macro_calendar_market_event_observations
      (observation_id, provider_id, source_event_id, country_code, country_name, display_name)
      values (?, ?, ?, ?, ?, ?)`)
      .run(`obs-${input.sourceEventId}`, input.provider, input.sourceEventId, input.countryCode, input.countryName,
        `事件 ${input.sourceEventId}`)
    database.prepare(`insert into mi_calendar_event_source_ids
      (provider_id, source_event_id, country_code, metric_key, period_key, first_scheduled_date, observed_at)
      values (?, ?, ?, ?, '2026-11', '2026-11-19', '2026-11-19T03:00:00.000Z')`)
      .run(input.provider, input.sourceEventId, input.countryCode, input.metricKey)
  }

  const southAfricaZh: Seed = { provider: '0xrouter', sourceEventId: '["215645",79763]',
    metricKey: '["215645",79763]', countryCode: 'SA', countryName: '南非' }
  const southAfricaEn: Seed = { provider: '0xrouter', sourceEventId: '["215645",79761]',
    metricKey: '["215645",79761]', countryCode: 'SA', countryName: 'South Africa' }
  const saudiAramco: Seed = { provider: '0xrouter', sourceEventId: '["44846",76751]',
    metricKey: '["44846",76751]', countryCode: 'SA', countryName: '沙特' }
  const otherProvider: Seed = { provider: 'narwhal', sourceEventId: 'nr-1',
    metricKey: 'NR.SOME_METRIC.SA.LEVEL', countryCode: 'SA', countryName: '南非' }

  const countryOf = (database: DatabaseSync, table: string, sourceEventId: string): string =>
    (database.prepare(`select country_code from ${table} where source_event_id = ?`)
      .get(sourceEventId) as { country_code: string }).country_code

  it('两行南非改 ZA、沙特阿美那行与别的来源一行都不动；台账与观测同改；第二遍 0 变更', () => {
    const database = setup()
    for (const seedRow of [southAfricaZh, southAfricaEn, saudiAramco, otherProvider]) seed(database, seedRow)
    const report = correctSourceRecordedCountries(database)
    expect(report.pending).toBe(2)
    expect(report.observations).toBe(2)
    expect(report.events).toBe(2)
    expect(report.ledger).toBe(2)
    expect(report.collisions).toEqual([])
    for (const table of ['mi_calendar_events', 'mi_calendar_event_source_ids']) {
      expect(countryOf(database, table, southAfricaZh.sourceEventId)).toBe('ZA')
      expect(countryOf(database, table, southAfricaEn.sourceEventId)).toBe('ZA')
      expect(countryOf(database, table, saudiAramco.sourceEventId)).toBe('SA')
      expect(countryOf(database, table, otherProvider.sourceEventId)).toBe('SA')
    }
    const observationOf = (sourceEventId: string): string =>
      (database.prepare('select country_code from mi_macro_calendar_market_event_observations where source_event_id = ?')
        .get(sourceEventId) as { country_code: string }).country_code
    expect(observationOf(southAfricaZh.sourceEventId)).toBe('ZA')
    expect(observationOf(saudiAramco.sourceEventId)).toBe('SA')
    // 判据是差集，不是版本标记：再跑一遍必须 0 变更。
    expect(correctSourceRecordedCountries(database)).toEqual(
      { pending: 0, observations: 0, events: 0, ledger: 0, collisions: [] })
  })

  it('目标国家下已有同一身份同一期的行：不硬改（会撞主键），报进 collisions', () => {
    const database = setup()
    seed(database, southAfricaZh)
    // 同一身份、同一期已经有 ZA 行（不同 source_event_id）：改名会撞主键。
    seed(database, { ...southAfricaZh, sourceEventId: '["215645",79799]', countryCode: 'ZA', countryName: '南非' })
    const report = correctSourceRecordedCountries(database)
    expect(report.events).toBe(0)
    expect(report.collisions).toHaveLength(1)
    expect(report.collisions[0]).toContain('ZA|["215645",79763]')
    // 观测与标准表必须一致：观测改成 ZA、标准表仍是 SA 会让「按身份匹配」判孤儿。
    expect(countryOf(database, 'mi_calendar_events', southAfricaZh.sourceEventId)).toBe('SA')
  })

  it('策略只声明了 0xrouter：名单外来源的行不会进候选', () => {
    expect(sourceCountryCorrectionPolicy.providerIds).toEqual(['0xrouter'])
  })
})
