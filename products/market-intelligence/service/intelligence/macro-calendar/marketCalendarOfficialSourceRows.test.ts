import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import type { MacroCalendarRevision } from './macroCalendarContracts'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'
import { officialLifecycleToReleaseStatus, officialRevisionsToSourceRows, writeOfficialSourceRows }
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
    expect(counts).toEqual({ written: 10, failed: 0 })
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
