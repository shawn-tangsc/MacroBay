import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import type { MacroCalendarRevision } from './macroCalendarContracts'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'
import { dualWriteMeasureRows } from './marketCalendarStandardDualWrite'
import { officialLifecycleToReleaseStatus, officialRevisionsToSourceRows, syncOfficialStandardRows, writeOfficialSourceRows }
  from './marketCalendarOfficialSourceRows'

const revision = (over: Partial<MacroCalendarRevision> = {}): MacroCalendarRevision => ({
  revisionId: 'rev-1', eventKey: 'US.CPI.RELEASE.2026-M10', releaseGroupKey: 'US.CPI.RELEASE.2026-M10',
  eventFamily: 'cpi', eventNameKey: 'consumer-price-index', countryCode: 'US', importance: 'high',
  periodKey: '2026-M10', lifecycleState: 'released', revisionKind: 'official-release',
  scheduledDate: '2026-11-10', detectedAt: '2026-11-10T13:30:00.000Z', recordedAt: '2026-11-10T13:31:00.000Z',
  actual: { displayValue: '3.7' }, previous: { displayValue: '3.4' }, providerId: 'macro-calendar-bls',
  descriptorId: 'd', sourceUrl: 'https://example.invalid', evidenceHash: 'h', evidenceRefs: [], snapshotHash: 's',
  parserVersion: 'v1', caveats: [], ...over
})

describe('官方发布先进标准表（source 身份）', () => {
  it('生命周期映射：released→published、scheduled→scheduled、cancelled→cancelled', () => {
    expect(officialLifecycleToReleaseStatus('released')).toBe('published')
    expect(officialLifecycleToReleaseStatus('scheduled')).toBe('scheduled')
    expect(officialLifecycleToReleaseStatus('cancelled')).toBe('cancelled')
  })

  it('能对上标准码的官方发布直接用码身份，期间换成标准写法', () => {
    const [row] = officialRevisionsToSourceRows([revision()])
    expect(row!.metricKey).toBe('US.CPI.NSA.YOY')      // 12 个月同比 → 年率那条
    expect(row!.identityKind).toBe('code')
    expect(row!.periodKey).toBe('2026-10')             // 2026-M10 → 2026-10
    expect(row!.sourceEventId).toBe('US.CPI.RELEASE.2026-M10')
    expect(row!.actual).toBe('3.7')
    expect(row!.status).toBe('published')
    expect(row!.timePrecision).toBe('date')            // 官方只给日期，不推时刻
  })

  it('拼不出码（Fed 事件、或码还没有名字）→ 退回源内身份，但照样显示', () => {
    const [fed] = officialRevisionsToSourceRows([revision({ eventKey: 'US.FOMC.2026-12-09',
      releaseGroupKey: 'US.FOMC.2026-12-09', eventFamily: 'fomc', eventNameKey: 'fomc-statement',
      providerId: 'macro-calendar-fed', lifecycleState: 'scheduled', actual: undefined, previous: undefined })])
    expect(fed!.identityKind).toBe('source')
    expect(fed!.metricKey).toBe('US.FOMC.2026-12-09')
    // GDP 的名字补齐后走标准码；季度期间原样保留（只有 `2026-M10` 这种月写法才换）。
    const [gdp] = officialRevisionsToSourceRows([revision({ eventKey: 'US.GDP.RELEASE.2026-Q3',
      releaseGroupKey: 'US.GDP.RELEASE.2026-Q3', eventFamily: 'gdp', eventNameKey: 'gdp-second-estimate',
      periodKey: '2026-Q3', providerId: 'macro-calendar-bea' })])
    expect(gdp!.identityKind).toBe('code')
    expect(gdp!.metricKey).toBe('US.GDP.SA.ANNUALIZED_QOQ')
    expect(gdp!.periodKey).toBe('2026-Q3')
  })

  it('国家码统一成标准表用的 USA（否则同一发布会存成两个身份）', () => {
    const [row] = officialRevisionsToSourceRows([revision()])
    expect(row!.countryCode).toBe('USA')
  })

  it('官方 CPI 用发布给的 12 个月同比，不许拿季调指数相除算出来', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 发布直接给的同比 3.73768；若有人拿季调指数相除会得到 3.717 —— 落库的必须是前者。
    writeOfficialSourceRows(database, { observedAt: '2026-11-10T13:31:00.000Z', parserVersion: 'v1',
      revisions: [revision({ actual: { displayValue: '3.73768' } })] })
    const stored = database.prepare("select values_json, value_state from mi_calendar_events where metric_key = 'US.CPI.NSA.YOY'")
      .get() as { values_json: string; value_state: string }
    expect(JSON.parse(stored.values_json).actual).toBe('3.73768')
    expect(stored.values_json).not.toContain('3.717')
    expect(stored.value_state).toBe('present')
  })

  /**
   * 覆盖门按「数据自身的观测时刻」判，不按我们的写入时刻（Chief 2026-11-21）。
   * 官方链的写入时刻总是「现在」，若拿它去比，一份三天前的官方数据今天写进来也会赢过
   * 0xrouter 刚拿到的新值——读者看到的是旧数，而且看不出「旧盖了新」。
   */
  it('官方数据比市场旧：不覆盖市场新值，也不推进数据时刻', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    dualWriteMeasureRows(database, {
      providerId: '0xrouter', parserVersion: 'v1', observedAt: '2026-11-10T16:00:00.000Z',
      rows: [{ countryCode: 'USA', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10',
        scheduledDate: '2026-11-10', sourceEventId: 'market-cpi', actual: '4.2', status: 'published' }]
    })
    writeOfficialSourceRows(database, {
      // 写入时刻比市场晚两小时，但 revision 自报的观测时刻更早 → 数据更旧。
      observedAt: '2026-11-10T18:00:00.000Z', parserVersion: 'v1',
      revisions: [revision({ detectedAt: '2026-11-10T13:30:00.000Z', actual: { displayValue: '3.7' } })]
    })
    const stored = database.prepare(`select values_json, data_observed_at from mi_calendar_events
      where metric_key = 'US.CPI.NSA.YOY'`).get() as { values_json: string; data_observed_at: string }
    expect(JSON.parse(stored.values_json).actual).toBe('4.2')
    expect(stored.data_observed_at).toBe('2026-11-10T16:00:00.000Z')
  })

  it('官方数据更新：照常覆盖并推进数据时刻', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    dualWriteMeasureRows(database, {
      providerId: '0xrouter', parserVersion: 'v1', observedAt: '2026-11-10T13:00:00.000Z',
      rows: [{ countryCode: 'USA', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10',
        scheduledDate: '2026-11-10', sourceEventId: 'market-cpi', actual: '4.2', status: 'published' }]
    })
    writeOfficialSourceRows(database, {
      observedAt: '2026-11-10T18:00:00.000Z', parserVersion: 'v1',
      revisions: [revision({ detectedAt: '2026-11-10T17:00:00.000Z', actual: { displayValue: '3.7' } })]
    })
    const stored = database.prepare(`select values_json, data_observed_at from mi_calendar_events
      where metric_key = 'US.CPI.NSA.YOY'`).get() as { values_json: string; data_observed_at: string }
    expect(JSON.parse(stored.values_json).actual).toBe('3.7')
    expect(stored.data_observed_at).toBe('2026-11-10T17:00:00.000Z')
  })

  it('官方行带 revision 自己的 measured 时刻，不拿写入时刻顶替', () => {
    const [row] = officialRevisionsToSourceRows([revision()])
    expect(row!.dataObservedAt).toBe('2026-11-10T13:30:00.000Z')
  })

  /**
   * 一次官方同步只记**一笔**写入尝试（Chief 2026-11-21 复核 #13 时发现的重复调用）：
   * 同一个 `reportWriteFailure` 被复制了两遍，成功与失败都会记两次，写入层的「写过几次」
   * 当场翻倍——它正是读者判断「这个写入方还在不在」的依据。
   */
  it('一次官方同步只记一笔写入尝试', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const attempts: string[] = []
    syncOfficialStandardRows(database, {
      listEffectiveMonthAsOf: () => [revision()],
      months: ['2026-11'], asOf: '2026-11-10T13:31:00.000Z', parserVersion: 'v1',
      writeLayer: { recordAttempt: (input) => { attempts.push(input.writerId) } }
    })
    expect(attempts).toHaveLength(1)
  })

  it('写进表后日历可见（视图含 release 行），且按源分批', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const counts = writeOfficialSourceRows(database, {
      observedAt: '2026-11-10T13:31:00.000Z', parserVersion: 'v1',
      revisions: [revision(), revision({ revisionId: 'rev-2', eventKey: 'US.PCE.RELEASE.2026-M09',
        releaseGroupKey: 'US.PCE.RELEASE.2026-M09', periodKey: '2026-M09',
        providerId: 'macro-calendar-bea', lifecycleState: 'scheduled', actual: undefined, previous: undefined })]
    })
    // **按发布组展开**：CPI 组 4 行（排除两个指数水平）+ PCE 组 4 行 = 8，加上原本两条自己 = 10。
    expect(counts).toEqual({ written: 12, failed: 0, numericUnparsed: 0 })
    const rows = database.prepare('select metric_key, identity_kind, status, value_state from mi_calendar_releases order by metric_key')
      .all() as { metric_key: string; identity_kind: string; status: string; value_state: string }[]
    expect(rows.every((row) => row.identity_kind === 'code')).toBe(true)
    // 验收点：**价格指数水平不单独成行**（同一次发布已有年率与月率）。
    expect(rows.map((row) => row.metric_key)).not.toContain('US.CPI.NSA.LEVEL')
    expect(rows.map((row) => row.metric_key)).not.toContain('US.CORE_CPI.SA.LEVEL')
    // 只有「拿到值的那一个码」带值，展开出来的兄弟码值空。
    const cpiYear = rows.find((row) => row.metric_key === 'US.CPI.NSA.YOY')!
    expect(cpiYear.value_state).toBe('present')
    expect(rows.filter((row) => row.metric_key.startsWith('US.CPI.')).length).toBeGreaterThan(1)
  })
})

/**
 * N2：官方源（BLS/BEA/Fed）的值对象**自带 `numericValue` + `unit`**，以前只把展示串拷进标准表，
 * 源给的高精度数与单位都扔掉了。现在按「源给的数优先、没有才解析展示串」落进 `numeric_json`。
 */
describe('官方源数值落数值列（N2）', () => {
  const stored = (database: DatabaseSync, metricKey = 'US.CPI.NSA.YOY') => JSON.parse(String(
    (database.prepare('select numeric_json from mi_calendar_events where metric_key = ?').get(metricKey) as
      { numeric_json: string }).numeric_json))

  it('源给了 numericValue + unit：原样落，单位按闭集映射（percent-yoy → percent）', () => {
    const [row] = officialRevisionsToSourceRows([revision({
      actual: { displayValue: '3.2%', numericValue: 3.2, unit: 'percent-yoy' }
    })])
    expect(JSON.parse(String(row!.numericJson))).toMatchObject({
      state: 'available', unit: 'percent', values: { actual: 3.2 }, decimals: { actual: 1 }
    })
  })

  it('只给展示串：按该码的量纲提示解析（官方 CPI 的 3.7 没有百分号）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    writeOfficialSourceRows(database, { observedAt: '2026-11-10T13:31:00.000Z', parserVersion: 'v1',
      revisions: [revision({ actual: { displayValue: '3.7' } })] })
    expect(stored(database)).toMatchObject({ state: 'available', unit: 'percent', values: { actual: 3.7 } })
  })

  it('展开出来的兄弟码没有值 → missing，不复制主行的数与单位', () => {
    const [main, sibling] = officialRevisionsToSourceRows([revision({
      actual: { displayValue: '3.2%', numericValue: 3.2, unit: 'percent' }
    })])
    expect(JSON.parse(String(main!.numericJson)).state).toBe('available')
    expect(JSON.parse(String(sibling!.numericJson))).toMatchObject({ state: 'missing' })
  })

  it('解析不出的展示串按轮计数进写入汇总（与「源没给值」分开）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const counts = writeOfficialSourceRows(database, { observedAt: '2026-11-10T13:31:00.000Z', parserVersion: 'v1',
      revisions: [revision({ actual: { displayValue: '--' }, previous: undefined, consensus: undefined })] })
    expect(counts.numericUnparsed).toBe(1)
    expect(stored(database)).toMatchObject({ state: 'unparsed' })
  })

  it('一次官方同步把「数值解析不出」带出汇总行，供 app.log 查', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const synced = syncOfficialStandardRows(database, {
      listEffectiveMonthAsOf: () => [revision({ actual: { displayValue: '--' }, previous: undefined, consensus: undefined })],
      months: ['2026-11'], asOf: '2026-11-10T13:31:00.000Z', parserVersion: 'v1'
    })
    expect(synced.numericUnparsed).toBe(1)
  })
})
