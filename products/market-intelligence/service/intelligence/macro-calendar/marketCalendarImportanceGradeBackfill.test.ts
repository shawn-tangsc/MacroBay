import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { backfillCalendarImportanceGrades } from './marketCalendarImportanceGradeBackfill'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/**
 * **一次性启动回填：只填 `importance_grade IS NULL`**（Chief 2026-11-24 定）。
 *
 * 写入口改成「每次重写都重判」之后，只有被采集重写到的行才补得上档；不在采集窗口里的未来行
 * （例如还没到排期、本周不会被任何源重发的那些）会一直未分级。所以补一次历史：**只填空、不覆盖**，
 * 用与写入端同一个纯函数判，幂等。
 *
 * 这是「补历史」不是「改历史」：S4 那份报告仍然是当时那笔账（它比的是旧档 vs 当时的新判）。
 */
const now = '2026-11-24T00:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  return database
}

let seq = 0
function seed(database: DatabaseSync, over: Readonly<{ countryCode?: string; metricKey: string
  periodKey?: string; grade?: string | null; scheduledDate?: string }>): void {
  seq += 1
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision,
     status, identity_kind, value_state, values_json, source_provider_id, source_event_id,
     parser_version, observed_at, first_seen_at, importance_grade, release_count)
    values (?, ?, ?, ?, ?, 'date', 'scheduled', 'code', 'missing', '{}', 'test', ?,
      'v1', ?, ?, ?, 1)`)
    .run(over.countryCode ?? 'US', over.metricKey, over.periodKey ?? '2026-11',
      over.scheduledDate ?? '2026-11-30', over.scheduledDate ?? '2026-11-30', `e-${seq}`,
      now, now, over.grade ?? null)
}

describe('重要性档的启动回填（只填空、幂等）', () => {
  it('可判的 NULL 行补上；判不出的留 NULL；已有档不覆盖', () => {
    const database = setup()
    seed(database, { metricKey: 'US.CPI.NSA.YOY' })                       // 可判 → high
    seed(database, { metricKey: '["45125",78986]' })                      // 数组身份：判不出 → 留 NULL
    seed(database, { countryCode: 'JP', metricKey: 'JP.SOMETHING.NONE.LEVEL' }) // 未列辖区 → 留 NULL
    seed(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', grade: 'low' })    // 已有档：不动
    seed(database, { metricKey: 'US.NONFARM.SA.CHANGE', grade: 'medium' })     // 已有档：不动

    const report = backfillCalendarImportanceGrades(database)
    expect(report.scanned).toBe(3)
    expect(report.filled).toBe(1)
    expect(report.stillUngraded).toBe(2)

    const grades = new Map((database.prepare('select metric_key, importance_grade from mi_calendar_events')
      .all() as Array<{ metric_key: string; importance_grade: string | null }>)
      .map((row) => [row.metric_key, row.importance_grade]))
    expect(grades.get('US.CPI.NSA.YOY')).toBe('high')
    expect(grades.get('["45125",78986]')).toBeNull()
    expect(grades.get('JP.SOMETHING.NONE.LEVEL')).toBeNull()
    // **不覆盖**：已有档哪怕与我们今天判的不同也原样留着（那是「已有结论」，得由重写流程改）。
    expect(grades.get('US.GDP.SA.ANNUALIZED_QOQ')).toBe('low')
    expect(grades.get('US.NONFARM.SA.CHANGE')).toBe('medium')
  })

  it('第二遍 0 变更（幂等：只剩判不出的那批是 NULL，扫到也不写）', () => {
    const database = setup()
    seed(database, { metricKey: 'US.CPI.NSA.YOY' })
    seed(database, { metricKey: '["45125",78986]' })
    expect(backfillCalendarImportanceGrades(database)).toMatchObject({ scanned: 2, filled: 1, stillUngraded: 1 })
    const second = backfillCalendarImportanceGrades(database)
    expect(second).toMatchObject({ scanned: 1, filled: 0, stillUngraded: 1 })
    expect(backfillCalendarImportanceGrades(database)).toMatchObject({ scanned: 1, filled: 0 })
  })

  it('事件身份（`US.FOMC.*`）按事件族判，不是按指标码', () => {
    const database = setup()
    seed(database, { metricKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' })
    seed(database, { metricKey: 'evt.central-bank-speech', scheduledDate: '2026-12-01' })
    const report = backfillCalendarImportanceGrades(database)
    expect(report.filled).toBe(1)
    const fomc = database.prepare(`select importance_grade from mi_calendar_events
      where metric_key = 'US.FOMC.2026-12-09'`).get() as { importance_grade: string | null }
    expect(fomc.importance_grade).toBe('high')
    // `evt.*` 没在事件族表里登记 → 未分级（不猜）。
    const speech = database.prepare(`select importance_grade from mi_calendar_events
      where metric_key = 'evt.central-bank-speech'`).get() as { importance_grade: string | null }
    expect(speech.importance_grade).toBeNull()
  })
})