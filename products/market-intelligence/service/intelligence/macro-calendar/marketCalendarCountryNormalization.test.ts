import { DatabaseSync } from 'node:sqlite'

import { beforeEach, describe, expect, it } from 'vitest'

import { normalizeCalendarCountryCodes } from './marketCalendarCountryNormalization'

/**
 * 国家码归一（迁移 15/25 的安全网）：**主键里那几列允许 `NULL`，所以 `NULL` 不许折成空串**。
 *
 * 事故现场（真库副本）：`findTarget` 用的是 null 安全比较 `metric_key is ?`，而找目标行之前
 * 调用方先写了 `stray.metric_key ?? ''`——`metric_key` 是 `NULL` 的行就被比成 `is ''`，
 * 而 `NULL is ''` 在 SQLite 里是**假**，于是它以为「目标键上没有一行」，直接改名。
 *
 * 这一条用例对着**改动前那一版**跑出来的实测是：`merged = 0、renamed = 2`——两条本该合并的
 * 身份都变成了「改名成功」，同一身份因此**留下两行**（`US` 与 `USA` 各一行）。真库那边因为
 * 表上还有一条唯一约束，同一件事表现为 `UNIQUE constraint failed`、整笔迁移回滚。
 * 两种表现是同一个根因：目标行没找到。
 *
 * 这一条钉三件事：
 * 1. 主键列是 `NULL` 的两行（`USA` 与 `US`）**能合并成一行**，不撞主键；
 * 2. 合并按既有规矩：有 `actual` 的那行留下、值逐字段合并（空值不覆盖）；
 * 3. 没有撞行的 `UK` 照常改名成 `GB`，台账同归一。
 */
const EVENTS = 'mi_calendar_events'
const LEDGER = 'mi_calendar_event_source_ids'

const database = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:')
  db.exec(`create table ${EVENTS} (
    country_code text,
    metric_key text,
    period_key text,
    first_scheduled_date text,
    values_json text not null default '{}',
    status text not null default 'published',
    value_state text,
    observed_at text,
    data_observed_at text,
    scheduled_at text,
    importance text,
    series_id text,
    first_published_actual text,
    first_published_previous text,
    primary key (country_code, metric_key, period_key, first_scheduled_date)
  )`)
  db.exec(`create table ${LEDGER} (provider_id text, source_event_id text, country_code text)`)
  db.exec(`create table mi_macro_calendar_migrations (version integer primary key, applied_at text)`)
  return db
}

const row = (country: string, values: string): readonly unknown[] =>
  [country, null, null, null, values, 'published', 'present', '2026-11-18T00:00:00.000Z',
    '2026-11-18T00:00:00.000Z', null, null, null, null, null]

describe('国家码归一：主键列是 NULL 时不许折成空串', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = database()
    db.prepare(`insert into ${EVENTS} values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...row('US', '{"actual":"7.8"}') as never[])
    db.prepare(`insert into ${EVENTS} values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...row('USA', '{"consensus":"18"}') as never[])
    db.prepare(`insert into ${LEDGER} values ('narwhal', 'evt-1', 'UK')`).run()
    // 一条没有撞行的 UK：归一后应当改名成 GB。
    db.prepare(`insert into ${EVENTS} values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('UK', 'US.CPI.NSA.YOY', '2026-10', '2026-11-10', '{"actual":"3.4"}', 'published', 'present',
        '2026-11-18T00:00:00.000Z', null, null, null, null, null, null)
  })

  it('merges the two NULL-keyed rows instead of renaming into a unique conflict', () => {
    const report = normalizeCalendarCountryCodes(db)
    expect(report.merged).toBe(1)
    const left = db.prepare(`select country_code, values_json from ${EVENTS} where metric_key is null`).all() as
      { country_code: string; values_json: string }[]
    // 只剩一行，国家是 alpha-2，两个值都在（空值不覆盖）。
    expect(left).toHaveLength(1)
    expect(left[0]!.country_code).toBe('US')
    expect(JSON.parse(left[0]!.values_json)).toMatchObject({ actual: '7.8', consensus: '18' })
  })

  it('still renames the rows that do not collide, and rewrites the ledger with them', () => {
    const report = normalizeCalendarCountryCodes(db)
    expect(report.renamed).toBe(1)
    expect(report.ledgerRewritten).toBe(1)
    const codes = (db.prepare(`select country_code from ${EVENTS} where metric_key = 'US.CPI.NSA.YOY'`).all() as
      { country_code: string }[]).map((entry) => entry.country_code)
    expect(codes).toEqual(['GB'])
    expect((db.prepare(`select country_code from ${LEDGER}`).get() as { country_code: string }).country_code).toBe('GB')
  })

  it('is idempotent: a second run changes nothing', () => {
    normalizeCalendarCountryCodes(db)
    expect(normalizeCalendarCountryCodes(db)).toMatchObject({ pending: 0, renamed: 0, merged: 0 })
  })
})
