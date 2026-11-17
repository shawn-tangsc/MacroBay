import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { backfillObservationCountries } from './marketCalendarObservationCountryBackfill'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/**
 * 按 `indicatorId` 补观测的国家（迁移 24）。
 *
 * 三条判据，都在挡「猜」：
 * - 同 id 在别的观测里带过**唯一**国家 → 补（这是事实，同一个 id 就是同一个序列）；
 * - 同 id 出现过**两个**国家 → **不补**（跨国家了，补哪个都是猜），计入 `unresolvable`；
 * - 同 id 从没出现过国家 → 不补，计入 `unresolvable`。
 */
function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
  database.exec(`create table if not exists mi_macro_calendar_market_event_observations (
    observation_id text primary key, source_event_id text not null, indicator_id text, country_code text, display_name text)`)
  return database
}

function seed(database: DatabaseSync, id: string, indicatorId: string, country: string | null): void {
  database.prepare('insert into mi_macro_calendar_market_event_observations values (?, ?, ?, ?, ?)')
    .run(id, `evt-${id}`, indicatorId, country, 'x')
}

describe('观测国家补齐', () => {
  it('同 id 带过唯一国家 → 补上；出现过两个国家或从未出现 → 不补', () => {
    const database = setup()
    seed(database, 'a1', '214797', 'FRA')
    seed(database, 'a2', '214797', null)   // 可补
    seed(database, 'b1', '214798', null)   // 从没出现过国家
    seed(database, 'c1', '214799', 'DE')
    seed(database, 'c2', '214799', 'US')
    seed(database, 'c3', '214799', null)   // 跨国家，不补
    const report = backfillObservationCountries(database)
    // 补不了的是「从没出现过国家」(b1) 与「跨两个国家」(c3)，共 2 条；a2 是能补的那一条。
    expect(report).toMatchObject({ candidates: 1, updated: 1, indicatorIds: 1, unresolvable: 2 })
    const byId = (id: string): string | null =>
      (database.prepare('select country_code from mi_macro_calendar_market_event_observations where observation_id = ?')
        .get(id) as { country_code: string | null }).country_code
    expect(byId('a2')).toBe('FRA')
    expect(byId('b1')).toBeNull()
    expect(byId('c3')).toBeNull()
    // 二次运行 0 变更
    expect(backfillObservationCountries(database)).toMatchObject({ candidates: 0, updated: 0 })
  })
})
