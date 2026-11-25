import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { readNextReleaseForMetric, readStandardCalendarMonth } from './marketCalendarStandardMonthRead'
import { ensureCalendarStandardTables, upsertCalendarStandardRow, type CalendarStandardRow }
  from './marketCalendarStandardTable'

const base: CalendarStandardRow = {
  countryCode: 'USA', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10',
  scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T13:30:00.000Z', timePrecision: 'minute',
  status: 'published', valuesJson: '{"actual":"3.7"}', valueState: 'present',
  sourceProviderId: 'macro-calendar-bls', sourceEventId: 'US.CPI.RELEASE.2026-M10',
  parserVersion: 'v1', observedAt: '2026-11-10T13:31:00.000Z', firstSeenAt: '2026-11-10T13:31:00.000Z'
}
const seed = (database: DatabaseSync) => {
  ensureCalendarStandardTables(database)
  upsertCalendarStandardRow(database, base)
  upsertCalendarStandardRow(database, { ...base, metricKey: 'US.GDP_NOWCAST.SA.ANNUALIZED_QOQ',
    periodKey: '2026-11', scheduledDate: '2026-11-12', rowKind: 'estimate', valuesJson: '{"actual":"2.1"}' })
  upsertCalendarStandardRow(database, { ...base, metricKey: 'US.PPI.NSA.YOY', periodKey: '2026-10',
    scheduledDate: '2026-12-15', sourceEventId: 'US.PPI.RELEASE.2026-M10' })
}
const emptyMonth = (database: DatabaseSync) => {
  const rows = database.prepare('select count(*) n from mi_calendar_events where scheduled_date like ?').get('2099-%') as { n: number }
  return rows.n
}

describe('从标准表读一个月', () => {
  it('日历语义默认不含估算', () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    const rows = readStandardCalendarMonth(database, { month: '2026-11' })
    expect(rows.map((row) => row.rowKind)).toEqual(['release'])
    expect(rows[0]!.metricKey).toBe('US.CPI.NSA.YOY')
  })

  it('分析侧传 includeEstimates 才看得到估算', () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    const rows = readStandardCalendarMonth(database, { month: '2026-11', includeEstimates: true })
    expect(rows.map((row) => row.rowKind).sort()).toEqual(['estimate', 'release'])
  })

  it('身份串稳定、出处与状态一起给（少一个消费方就会静默少东西）', () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    const [row] = readStandardCalendarMonth(database, { month: '2026-11' })
    // 国家码在写入端归一到 alpha-2：身份串跟着是 `US`（2026-11-16）。
    expect(row!.identityKey).toBe('US|US.CPI.NSA.YOY|2026-10|2026-11-10')
    expect(row!.observedAt).toBe('2026-11-10T13:31:00.000Z')
    expect(row!.sourceProviderId).toBe('macro-calendar-bls')
    expect(row!.timePrecision).toBe('minute')
    expect(row!.status).toBe('published')
    expect(row!.values.actual).toBe('3.7')
  })

  it('只读本月：跨月的行不出现；真空月返回空数组（与「读不到」是两件事）', () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    expect(readStandardCalendarMonth(database, { month: '2026-12' }).map((row) => row.metricKey))
      .toEqual(['US.PPI.NSA.YOY'])
    expect(readStandardCalendarMonth(database, { month: '2099-01' })).toEqual([])
    expect(emptyMonth(database)).toBe(0)
  })
})


describe('下一期排期：读不到就说没有，不许编期次', () => {
  it('取 asOf 之后最近一次排期；没有就 undefined', () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    expect(readNextReleaseForMetric(database, { metricKey: 'US.PPI.NSA.YOY', asOf: '2026-11-14T00:00:00.000Z' }))
      .toEqual({ period: '2026-10', releaseAt: '2026-11-10T13:30:00.000Z', timePrecision: 'minute' })
    // 日期型排期带 `date`：下游据此不做倒计时（那一刻几点源没说过）。
    upsertCalendarStandardRow(database, { ...base, metricKey: 'US.DATEONLY.SA.MOM', periodKey: '2026-11',
      scheduledDate: '2026-12-20', scheduledAt: undefined, timePrecision: 'date', sourceEventId: 'r-dateonly' })
    expect(readNextReleaseForMetric(database, { metricKey: 'US.DATEONLY.SA.MOM', asOf: '2026-11-14T00:00:00.000Z' }))
      .toMatchObject({ timePrecision: 'date' })
    expect(readNextReleaseForMetric(database, { metricKey: 'US.PPI.NSA.YOY', asOf: '2026-12-20T00:00:00.000Z' }))
      .toBeUndefined()
    expect(readNextReleaseForMetric(database, { metricKey: 'US.UNKNOWN.SA.MOM', asOf: '2026-11-14T00:00:00.000Z' }))
      .toBeUndefined()
  })

  /**
   * 「今天还有一场」不许被跳过（架构师 2026-11-14 抓到）。
   *
   * 原来的谓词是 `scheduled_date > asOf 的日期`，**严格大于**，于是「今天 21:30 那场」在上午 10:00 查
   * 会被直接跳过——卡片显示「下次发布 12-10」，而事实是今晚就有一场。那看起来完全正常。
   */
  it('counts a release later today when it carries a time', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, { ...base, metricKey: 'US.TODAY.SA.CHANGE', periodKey: '2026-11',
      scheduledDate: '2026-11-14', scheduledAt: '2026-11-14T13:30:00.000Z', sourceEventId: 'r-today-minute' })
    expect(readNextReleaseForMetric(database, { metricKey: 'US.TODAY.SA.CHANGE', asOf: '2026-11-14T02:00:00.000Z' }))
      .toEqual({ period: '2026-11', releaseAt: '2026-11-14T13:30:00.000Z', timePrecision: 'minute' })
  })

  it('counts a date-only release due today, because we do not know its time', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, { ...base, metricKey: 'US.TODAYONLY.SA.MOM', periodKey: '2026-11',
      scheduledDate: '2026-11-14', scheduledAt: undefined, timePrecision: 'date', sourceEventId: 'r-today-date' })
    expect(readNextReleaseForMetric(database, { metricKey: 'US.TODAYONLY.SA.MOM', asOf: '2026-11-14T02:00:00.000Z' }))
      .toMatchObject({ releaseAt: '2026-11-14T00:00:00.000Z', timePrecision: 'date' })
  })

  it('估算不是发布：视图里没有估算行，所以它不会冒出来当「下一次」', () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    expect(readNextReleaseForMetric(database, { metricKey: 'US.GDP_NOWCAST.SA.ANNUALIZED_QOQ',
      asOf: '2026-11-14T00:00:00.000Z' })).toBeUndefined()
  })
})

/**
 * **读侧只读我们判的档**（R44 技术方案 §4.2）：`importance_grade` 映射进既有 `importance` 字段，
 * 旧列 `importance`（源给的档）一律不读。
 *
 * 两个方向都要红：
 * - 源写 `low`、我们判「高」→ 读出来必须是高（把源档当真就是错）；
 * - 我们没判出来（`NULL`）→ 读出来**没有这个字段**，不许拿源写的 `high` 顶上，
 *   也不许降成 `low`（那是把「没定档」当成「定过低」）。
 */
describe('读侧只读 importance_grade，源给的档不采用', () => {
  it('源那一列写 low、我们判高 → 读出来是高', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, { ...base, importance: 'low' })
    const [row] = readStandardCalendarMonth(database, { month: '2026-11' })
    expect(row!.importance).toBe('high')
  })

  it('我们没判出来（NULL）→ 读出来没有这个字段，不拿源给的 high 顶上', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, {
      ...base, metricKey: 'US.UNREGISTERED_FAMILY.SA.LEVEL', importance: 'high',
      sourceEventId: 'US.UNREGISTERED.2026-M10'
    })
    const [row] = readStandardCalendarMonth(database, { month: '2026-11' })
    // 行在、值在，档这一格是「没有」——不是低，也不是源说的高。
    expect(row!.metricKey).toBe('US.UNREGISTERED_FAMILY.SA.LEVEL')
    expect(Object.hasOwn(row!, 'importance')).toBe(false)
  })
})
