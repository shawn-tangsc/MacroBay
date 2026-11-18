import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { calendarStandardTablePolicy, ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'
import {
  calendarValueEncodingRepairPolicy, countDoubleEncodedValueRows, repairMaterializedValueEncoding
} from './marketCalendarValueEncodingRepair'

/**
 * 存量收敛（用户 2026-11-18）：`materialize-mapped-v1` 那批双重编码的值还原成裸字符串。
 *
 * 钉四条：
 * 1. 只动这批行（别的 `parser_version` 一个字节不变）；
 * 2. 解不出 `displayValue` 的字段**删掉**，不填空串、不保留原文；
 * 3. 整表在同一事务里备份、行数对账、幂等（第二遍 0 变更）；
 * 4. 收完「双重编码的行数 = 0」，这是脚本出口的真值判据。
 */
const table = () => calendarStandardTablePolicy.eventsTable

const seed = (db: DatabaseSync, metricKey: string, parserVersion: string, valuesJson: string): void => {
  // 用真写入端建行（列顺序与默认值都由它负责），再把 values_json 改回事故现场的样子——
  // 写入端现在会解码，直接喂双重编码进不去（那正是它该做的事）。
  upsertCalendarStandardRow(db, {
    countryCode: 'US', metricKey, periodKey: '2026-10', scheduledDate: '2026-11-10',
    scheduledAt: '2026-11-10T13:30:00.000Z', timePrecision: 'minute',
    valuesJson: JSON.stringify({ actual: '0' }), sourceProviderId: 'narwhal', sourceEventId: `evt-${metricKey}`,
    parserVersion, observedAt: '2026-11-18T00:00:00.000Z', firstSeenAt: '2026-11-18T00:00:00.000Z',
    status: 'published'
  })
  db.prepare(`update ${table()} set values_json = ?, parser_version = ? where metric_key = ?`)
    .run(valuesJson, parserVersion, metricKey)
}

const database = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(db)
  seed(db, 'US.CPI.NSA.YOY', 'materialize-mapped-v1',
    JSON.stringify({ previous: '{"displayValue":"4.7%"}', consensus: '{"displayValue":"5%"}', actual: '4.9%' }))
  // 形状对、内容坏：displayValue 不是字符串 → 该字段删掉。
  seed(db, 'US.PPI.NSA.YOY', 'materialize-mapped-v1', JSON.stringify({ previous: '{"displayValue":123}', actual: '1.1%' }))
  // 别的写入端的行：一个字节都不许动。
  seed(db, 'US.NONFARM.SA.CHANGE', 'backfill-from-observations-v1', JSON.stringify({ actual: '165' }))
  return db
}

const valuesOf = (db: DatabaseSync, metricKey: string): Record<string, unknown> =>
  JSON.parse((db.prepare(`select values_json as v from ${table()} where metric_key = ?`).get(metricKey) as { v: string }).v) as Record<string, unknown>

describe('双重编码的一次性收敛', () => {
  it('decodes the materialized rows, drops undecodable fields, and leaves other writers alone', () => {
    const db = database()
    const report = repairMaterializedValueEncoding(db, { apply: true })
    expect(report).toMatchObject({ scanned: 2, updated: 2, remaining: 0 })
    expect(report.before).toBe(report.after)
    expect(valuesOf(db, 'US.CPI.NSA.YOY')).toEqual({ previous: '4.7%', consensus: '5%', actual: '4.9%' })
    // 坏字段被删掉，好字段保留。
    expect(valuesOf(db, 'US.PPI.NSA.YOY')).toEqual({ actual: '1.1%' })
    expect(valuesOf(db, 'US.NONFARM.SA.CHANGE')).toEqual({ actual: '165' })
    expect(countDoubleEncodedValueRows(db)).toBe(0)
  })

  it('backs the whole table up in the same transaction', () => {
    const db = database()
    repairMaterializedValueEncoding(db, { apply: true })
    const backup = db.prepare(`select count(*) as n from ${calendarValueEncodingRepairPolicy.backupTable}`).get() as { n: number }
    expect(backup.n).toBe(3)
  })

  it('is idempotent: a second run changes nothing', () => {
    const db = database()
    repairMaterializedValueEncoding(db, { apply: true })
    const second = repairMaterializedValueEncoding(db, { apply: true })
    expect(second).toMatchObject({ updated: 0, remaining: 0 })
  })

  it('dry run reports what it would change without touching the table', () => {
    const db = database()
    const report = repairMaterializedValueEncoding(db)
    expect(report).toMatchObject({ scanned: 2, updated: 2 })
    expect(countDoubleEncodedValueRows(db)).toBe(2)
    expect(valuesOf(db, 'US.CPI.NSA.YOY').previous).toBe('{"displayValue":"4.7%"}')
  })
})
