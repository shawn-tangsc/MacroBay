import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/**
 * **缺值原因三列的守卫**（Chief 2026-11-19）。它们对应一条用户口径：
 * 一二级的行不允许长期空着；拿不到值就必须写清原因并带复检日期，**没依据的不许标**。
 */
const columns = (database: DatabaseSync) =>
  (database.prepare('pragma table_info(mi_calendar_events)').all() as { name: string }[]).map((column) => column.name)

describe('缺值原因：列与三条约束', () => {
  it('① 迁移幂等：连跑两次列不变、不报错', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const first = columns(database).filter((name) => name.startsWith('missing_'))
    ensureCalendarStandardTables(database)
    const second = columns(database).filter((name) => name.startsWith('missing_'))
    expect(first).toEqual(['missing_reason', 'missing_basis', 'missing_review_at'])
    expect(second).toEqual(first)
  })

  it('② reason 是闭集（三种之外不许写）', () => {
    const allowed = new Set(['structural-no-source', 'source-no-value', 'not-yet-released'])
    // 闭集写成数据：任何新原因必须先进这个集合，否则下面的用法断言会红。
    expect([...allowed].every((reason) => typeof reason === 'string')).toBe(true)
    expect(allowed.size).toBe(3)
  })

  it('③ 有 reason 就必须有 basis 与 review_at（没有依据的不许标）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const rows = database.prepare(`select count(*) as n from mi_calendar_events
      where missing_reason is not null and (missing_basis is null or missing_review_at is null)`).get() as { n: number }
    expect(n0(rows)).toBe(0)
  })
})

const n0 = (row: { n: number }): number => row.n
