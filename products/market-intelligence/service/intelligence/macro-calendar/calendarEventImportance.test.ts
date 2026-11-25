import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { createMacroCalendarRepository } from './macroCalendarRepository'
import { prepareRevision } from './macroCalendarRevisionRows'
import {
  calendarImportanceRows, gradeCalendarEvent, jurisdictionOf, linkedCalendarImportance,
  type CalendarImportanceRow
} from './calendarEventImportance'
import { ensureCalendarStandardTables } from './marketCalendarStandardSchema'
import { upsertCalendarStandardRow } from './marketCalendarStandardTable'
import type { MacroCalendarRevision } from './macroCalendarContracts'

/**
 * R44 S1（方案 `02-tech-design.md` §1/§2/§8）：**判定一份、落在两个唯一写入口**。
 *
 * 判据按方案 §8 的 1 / 2 / 3 / 6 / 7；§4/§5 的读侧三处与发布聚合属 S2，这里不用夹具假装验过。
 */

const withoutRow = (predicate: (row: CalendarImportanceRow) => boolean): readonly CalendarImportanceRow[] =>
  calendarImportanceRows.filter((row) => !predicate(row))

describe('§8.1 美国 CPI → 高；删掉这一行就变未分级', () => {
  it('US.CPI.NSA.YOY → high，族取自码的第二段', () => {
    const verdict = gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.CPI.NSA.YOY' })
    expect(verdict?.tier).toBe('high')
    expect(verdict?.family).toBe('CPI')
    expect(verdict?.basis).toContain('利率路径')
  })

  it('红证：删掉 (US, CPI) 这一行 → 同一条事件变未分级（不是低）', () => {
    const rows = withoutRow((row) => row.country === 'US' && row.family === 'CPI')
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.CPI.NSA.YOY' }, rows)).toBeUndefined()
  })

  it('核心里两个例外：核心 CPI 是另一族、核心 PCE 同理（同档、各自有行）', () => {
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.CORE_CPI.NSA.YOY' })?.family).toBe('CORE_CPI')
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.CORE_PCE.SA.YOY' })?.family).toBe('CORE_PCE')
  })
})

describe('§8.2 纽约联储制造业 → 中；改成高就变高', () => {
  it('EMPIRE_STATE_MANUFACTURING → medium', () => {
    const verdict = gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL' })
    expect(verdict?.tier).toBe('medium')
    expect(verdict?.family).toBe('EMPIRE_STATE_MANUFACTURING')
  })

  it('红证：把这一族改成高（只改数据）→ 同一条事件变高', () => {
    const rows = calendarImportanceRows.map((row) => row.family === 'EMPIRE_STATE_MANUFACTURING'
      ? { ...row, tier: 'high' as const } : row)
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL' }, rows)?.tier)
      .toBe('high')
  })

  it('同族的分项也同档（族由码第二段定，不由测度定）', () => {
    expect(gradeCalendarEvent({ countryCode: 'US',
      metricKey: 'US.PHILLY_FED_MANUFACTURING.EMPLOYMENT.SA.LEVEL' })?.tier).toBe('medium')
    expect(gradeCalendarEvent({ countryCode: 'US',
      metricKey: 'US.DALLAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL' })?.tier).toBe('medium')
  })
})

describe('§8.3 未登记身份 → 未分级（不是低）', () => {
  it('表里没有的组合、认不出的身份都返回 undefined', () => {
    expect(gradeCalendarEvent({ countryCode: 'BR', metricKey: 'BR.INDUSTRIAL_PRODUCTION.NONE.MOM' })).toBeUndefined()
    // 这一族今天确实不在表里（PRD §10 定的是真库存在的族；没登记的就是没登记）。
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.NOT_A_FAMILY.SA.LEVEL' })).toBeUndefined()
    expect(gradeCalendarEvent({ countryCode: 'US' })).toBeUndefined()
  })

  it('身份认得、辖区没定档 → 未分级（德国不在进表辖区里，PRD §9.1 v2）', () => {
    expect(gradeCalendarEvent({ countryCode: 'DE', metricKey: 'DE.CPI.NSA.YOY' })).toBeUndefined()
  })

  it('红证：任何输入都不会返回 low 来冒充未分级', () => {
    for (const input of [
      { countryCode: 'US' },
      { countryCode: 'BR', metricKey: 'BR.CPI.NONE.YOY' },
      { countryCode: 'US', metricKey: 'US.NOT_A_CODE.NONE.LEVEL' }
    ]) {
      expect(gradeCalendarEvent(input)?.tier).not.toBe('low')
    }
  })
})

describe('身份顺序与两张小表（方案 §1.1/§1.2）', () => {
  it('指标码优先；没有码才看事件键；再没有才看登记标题键；最后才是官方 eventFamily', () => {
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.CPI.NSA.YOY',
      eventKey: 'evt.fomc', titleKey: 'gdp', eventFamily: 'gdp' })?.family).toBe('CPI')
    expect(gradeCalendarEvent({ countryCode: 'US', eventKey: 'US.FOMC.2026-12-09' })?.family).toBe('FOMC')
    expect(gradeCalendarEvent({ countryCode: 'US', eventKey: 'evt.fomc' })?.tier).toBe('high')
    expect(gradeCalendarEvent({ countryCode: 'US', titleKey: 'nonfarm-payrolls' })?.tier).toBe('high')
    // 修订行只有 eventFamily：8 行封闭表里认得才有档。
    expect(gradeCalendarEvent({ countryCode: 'US', eventFamily: 'cpi' })?.tier).toBe('high')
    expect(gradeCalendarEvent({ countryCode: 'US', eventFamily: 'mystery-family' })).toBeUndefined()
  })

  it('辖区归一：US/USA、GB/GBR、JP/JPN、CN/CHN、EMU 各归一个值', () => {
    expect(jurisdictionOf('USA')).toBe('US')
    expect(jurisdictionOf('GBR')).toBe('GB')
    expect(jurisdictionOf('JPN')).toBe('JP')
    expect(jurisdictionOf('CHN')).toBe('CN')
    expect(jurisdictionOf('EMU')).toBe('EMU')
    expect(jurisdictionOf('DEU')).toBe('DE')
  })

  it('可复现：同一身份判两次必同档（纯函数）', () => {
    const input = { countryCode: 'US', metricKey: 'US.RETAIL_SALES.SA.MOM' } as const
    expect(gradeCalendarEvent(input)).toEqual(gradeCalendarEvent(input))
    expect(gradeCalendarEvent(input)?.tier).toBe('medium')
  })

  it('`rest` 是显式决策行：FX 储备与 M2 在任何辖区都是低', () => {
    expect(gradeCalendarEvent({ countryCode: 'CN', metricKey: 'CN.FX_RESERVES.NONE.LEVEL' })?.tier).toBe('low')
    expect(gradeCalendarEvent({ countryCode: 'BR', metricKey: 'BR.MONEY_SUPPLY.NONE.YOY' })?.tier).toBe('low')
  })
})

describe('§8.6 写入口自己算档、忽略源给的档（标准行）', () => {
  it('源写 medium、我们判 high → 落 importance_grade=high，旧 importance 仍是源值', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, {
      countryCode: 'US', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10',
      scheduledDate: '2026-11-10', timePrecision: 'date', valuesJson: JSON.stringify({ actual: '3.7%' }),
      valueState: 'present', importance: 'medium',
      sourceProviderId: 'narwhal', sourceEventId: 'n-1', parserVersion: 'v1',
      observedAt: '2026-11-10T13:31:00.000Z', firstSeenAt: '2026-11-10T13:31:00.000Z'
    })
    const stored = database.prepare('select importance, importance_grade from mi_calendar_events')
      .get() as { importance: string | null; importance_grade: string | null }
    // 我们的档＝高；源给的档原样留在旧列，不被覆盖、也不被采用。
    expect(stored).toEqual({ importance: 'medium', importance_grade: 'high' })
  })

  it('身份判不出档 → 落 NULL（未分级），不是 low、也不是源的档', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, {
      countryCode: 'US', metricKey: 'US.NOT_A_FAMILY.SA.LEVEL', periodKey: '2026-10',
      scheduledDate: '2026-11-05', timePrecision: 'date', valuesJson: JSON.stringify({ actual: '1' }),
      valueState: 'present', importance: 'high',
      sourceProviderId: 'narwhal', sourceEventId: 'n-2', parserVersion: 'v1',
      observedAt: '2026-11-05T13:31:00.000Z', firstSeenAt: '2026-11-05T13:31:00.000Z'
    })
    const stored = database.prepare('select importance, importance_grade from mi_calendar_events')
      .get() as { importance: string | null; importance_grade: string | null }
    expect(stored).toEqual({ importance: 'high', importance_grade: null })
  })
})

describe('§8.7 迁移：两表各加一列、幂等、不回填', () => {
  const revision = (over: Partial<MacroCalendarRevision> = {}): MacroCalendarRevision => ({
    revisionId: 'rev-1', eventKey: 'US.CPI.RELEASE.2026-M10', releaseGroupKey: 'US.CPI.RELEASE.2026-M10',
    eventFamily: 'cpi', eventNameKey: 'cpi', countryCode: 'US', importance: 'high',
    periodKey: '2026-M10', lifecycleState: 'released', revisionKind: 'official-release',
    scheduledDate: '2026-11-10', detectedAt: '2026-11-10T13:30:00.000Z',
    recordedAt: '2026-11-10T13:31:00.000Z', actual: { displayValue: '3.7%' },
    providerId: 'macro-calendar-bls', descriptorId: 'd', sourceUrl: 'https://x.invalid',
    evidenceHash: 'h', evidenceRefs: [], snapshotHash: 's', parserVersion: 'v1', caveats: [], ...over
  })

  it('旧库（无列）补列、旧行保持 NULL、第二次跑不动', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 旧行：加列前写的
    database.prepare(`insert into mi_calendar_events
      (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision, status,
       identity_kind, value_state, values_json, source_provider_id, source_event_id, parser_version,
       observed_at, first_seen_at, release_count)
      values ('US','US.CPI.NSA.YOY','2026-09','2026-10-10','2026-10-10','date','published','code','present',
        '{"actual":"3.1%"}','narwhal','old-1','v1','2026-10-10T12:00:00.000Z','2026-10-10T12:00:00.000Z',1)`).run()
    // 模拟旧库：把列拆掉，再走一次 ensure。
    database.exec('alter table mi_calendar_events drop column importance_grade')
    ensureCalendarStandardTables(database)
    const columns = (database.prepare('pragma table_info(mi_calendar_events)').all() as { name: string }[])
      .map((column) => column.name)
    expect(columns).toContain('importance_grade')
    // 不回填：旧行仍是 NULL＝未分级。
    expect((database.prepare("select importance_grade from mi_calendar_events where source_event_id = 'old-1'")
      .get() as { importance_grade: string | null }).importance_grade).toBeNull()
    // 第二次 ensure 幂等：列还在、值没变。
    ensureCalendarStandardTables(database)
    expect((database.prepare('select count(*) as n from mi_calendar_events').get() as { n: number }).n).toBe(1)
  })

  it('修订行写入口：prepareRevision 自己算档，源 importance 不动', () => {
    const stored = prepareRevision(revision())
    expect(stored.importance).toBe('high')      // 源给的，原样
    expect(stored.importanceGrade).toBe('high')  // 我们判的

    // 故意造一个**表外**的官方族：`eventFamily` 是封闭联合，这里不改类型、用显式断言造越界值，
    // 验的是行为（判不出 → 不写这一列），不是类型。放宽类型会把「封闭表」变成开放表。
    const unlistedFamily = { eventFamily: 'mystery-family' } as unknown as Partial<MacroCalendarRevision>
    expect(prepareRevision(revision(unlistedFamily)).importanceGrade).toBeUndefined()
  })

  it('修订行真的落库：追加后能在表里读到 importance_grade', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const appended = repository.appendIfNew(revision())
    expect(appended.revision.importanceGrade).toBe('high')
    expect(repository.getEffectiveEventAsOf({ eventKey: 'US.CPI.RELEASE.2026-M10',
      asOf: '2026-11-11T00:00:00.000Z' })?.importanceGrade).toBe('high')
  })
})
/**
 * **linked 对的档**（R44 技术方案 §4.1 末条）：标准行与官方修订行是同一次发布的两条物理记录。
 * 标准行有码、判据更硬，所以它的档先；标准行未分级才回退官方那条；两边都没有 → 未分级。
 *
 * 一个函数，两个读取端共用（简报的合并、日历的日模型）——各自写一遍就会出现
 * 「同一次发布在日历上是高、在简报上是未分级」。
 */
describe('linked 对：标准行的档优先，官方行只做回退', () => {
  it('标准行判高、官方那条没判 → 高（标准行的判据更硬）', () => {
    expect(linkedCalendarImportance('high', undefined)).toBe('high')
  })

  it('标准行没判、官方判中 → 中（回退，不是当高也不是当低）', () => {
    expect(linkedCalendarImportance(undefined, 'medium')).toBe('medium')
  })

  it('两边都没判 → 未分级（undefined），不兜成低', () => {
    expect(linkedCalendarImportance(undefined, undefined)).toBeUndefined()
  })

  it('两边都有档 → 取标准行那个（它是按身份判的，官方那条是同一份发布的另一行）', () => {
    expect(linkedCalendarImportance('medium', 'high')).toBe('medium')
  })
})

/**
 * **PRD §10 附录**：真库 69 个「美国、有码、PRD §2 没列这一族」的逐族定档（产品 2026-11-24 拍）。
 *
 * 68 族补表行；`FEDERAL_FUNDS_BENCHMARK` 核出就是 FOMC 决议那一场（核查见 S4 报告 §6），
 * **归并进 FOMC 族**——不另立第二个高族。三条规则：R1 子族跟父族、R2 周度高频一律低、
 * R3 房产不整批判低（Case-Shiller 变体中、开工/许可/销量/支出低）。
 *
 * 这张清单是**决定的副本**：删掉表里任一行，对应那条就红（`toBe(expected)` 收 undefined）。
 */
describe('PRD §10：69 族逐族定档', () => {
  it.each([
    ['CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE', 'high'],
    ['PERSONAL_CONSUMPTION_EXPENDITURE_PRICE', 'high'],
    ['PERSONAL_CONSUMPTION_EXPENDITURE', 'high'],
    ['PERSONAL_INCOME', 'high'],
    ['PERSONAL_SPENDING', 'high'],
    ['ACTUAL_PERSONAL_CONSUMPTION_EXPENDITURE', 'high'],
    ['REAL_GDP', 'high'],
    ['ANNUM_REAL_GDP', 'high'],
    ['CHALLENGER_JOB_CUTS', 'medium'],
    ['ISM_MANUFACTURING_NEW_ORDERS', 'medium'],
    ['SP_COMPOSITE_PMI', 'medium'],
    ['CORE_CAPEX_ORDERS', 'medium'],
    ['ISM_SERVICES_NEW_ORDERS', 'medium'],
    ['SP_MANUFACTURING_PMI', 'medium'],
    ['ISM_MANUFACTURING_EMPLOYMENT', 'medium'],
    ['ISM_MANUFACTURING_PRODUCTION', 'medium'],
    ['ISM_MANUFACTURING_INVENTORIES', 'medium'],
    ['ISM_MANUFACTURING_PRICES', 'medium'],
    ['SP_SERVICES_PMI', 'medium'],
    ['ISM_SERVICES_PRICES', 'medium'],
    ['ISM_SERVICES_SUPPLIER_DELIVERIES', 'medium'],
    ['ISM_SERVICES_INVENTORIES', 'medium'],
    ['ISM_SERVICES_EMPLOYMENT', 'medium'],
    ['NFIB_OPTIMISM', 'medium'],
    ['DEDUCT_AIRCRAFT_DEFENSE_CAPITAL_DURABLE_GOODS_ORDERS', 'medium'],
    ['DURABLE_GOODS_ORDERS_EXCLUDING_NATIONAL_DEFENSE', 'medium'],
    ['DURABLE_GOODS_ORDERS_EXCLUDING_TRANSPORTATION', 'medium'],
    ['UNSEASONALLY_HOUSE_PRICE_20_MAJOR_CITIES_S_P_CS', 'medium'],
    ['S_P_CS_HOUSE_PRICE_10_MAJOR_CITIES', 'medium'],
    ['S_P_CS_UNSEASONALLY_HOUSE_PRICE_10_MAJOR_CITIES', 'medium'],
    ['ADP', 'medium'],
    ['UNIT_LABOR_COSTS', 'medium'],
    ['PRODUCTIVITY', 'medium'],
    ['BAKER_HUGHES_OIL_RIGS', 'low'],
    ['BAKER_HUGHES_GAS_RIGS', 'low'],
    ['BAKER_HUGHES_TOTAL_RIGS', 'low'],
    ['REDBOOK_RETAIL_SALES', 'low'],
    ['API_CUSHING_STOCKS', 'low'],
    ['MBA_APPLICATIONS', 'low'],
    ['MBA_PURCHASE_INDEX', 'low'],
    ['MBA_RATE_30Y', 'low'],
    ['MBA_REFINANCE_INDEX', 'low'],
    ['EIA_NATURAL_GAS_STOCKS', 'low'],
    ['API_CRUDE_STOCKS', 'low'],
    ['API_DISTILLATE_STOCKS', 'low'],
    ['API_GASOLINE_STOCKS', 'low'],
    ['EIA_CRUDE_STOCKS', 'low'],
    ['EIA_REFINERY_UTILIZATION', 'low'],
    ['EIA_DISTILLATE_STOCKS', 'low'],
    ['EIA_GASOLINE_STOCKS', 'low'],
    ['EIA_CUSHING_STOCKS', 'low'],
    ['EXISTING_HOME_SALES', 'low'],
    ['CONSTRUCTION_SPENDING', 'low'],
    ['CONSUMER_CREDIT', 'low'],
    ['FACTORY_ORDERS', 'low'],
    ['EXPORTS', 'low'],
    ['IMPORTS', 'low'],
    ['FEDERAL_BUDGET', 'low'],
    ['NET_LONG_TERM_CAPITAL_INFLOWS', 'low'],
    ['NET_FOREIGN_PURCHASES_GOVERNMENT_BONDS', 'low'],
    ['NET_INTERNATIONAL_CAPITAL_INFLOW', 'low'],
    ['NEW_HOME_SALES_ANNUALIZED', 'low'],
    ['NEW_HOME_STARTS_ANNUALIZED', 'low'],
    ['GSCPI', 'low'],
    ['TOTAL_NUMBER_CONSTRUCTION_PERMITS', 'low'],
    ['COINCIDENT_INDEX', 'low'],
    ['CONFERENCE_BOARD_LAG_METRIC', 'low'],
    ['WHOLESALE_INVENTORY', 'low'],
  ] as const)('US.%s → %s（族取自码第二段）', (family, tier) => {
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: `US.${family}.SA.LEVEL` })?.tier).toBe(tier)
  })

  it('FEDERAL_FUNDS_BENCHMARK 归并进 FOMC 族：高，族名是 FOMC，不是第二个高族', () => {
    const verdict = gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.FEDERAL_FUNDS_BENCHMARK.NONE.RATE' })
    expect(verdict?.tier).toBe('high')
    expect(verdict?.family).toBe('FOMC')
  })

  it('房产三档都对：Case-Shiller 变体是中，开工/许可/销量/支出是低', () => {
    for (const family of ['UNSEASONALLY_HOUSE_PRICE_20_MAJOR_CITIES_S_P_CS',
      'S_P_CS_HOUSE_PRICE_10_MAJOR_CITIES', 'S_P_CS_UNSEASONALLY_HOUSE_PRICE_10_MAJOR_CITIES']) {
      expect(gradeCalendarEvent({ countryCode: 'US', metricKey: `US.${family}.SA.LEVEL` })?.tier).toBe('medium')
    }
    for (const family of ['EXISTING_HOME_SALES', 'NEW_HOME_SALES_ANNUALIZED', 'CONSTRUCTION_SPENDING',
      'NEW_HOME_STARTS_ANNUALIZED', 'TOTAL_NUMBER_CONSTRUCTION_PERMITS', 'WHOLESALE_INVENTORY']) {
      expect(gradeCalendarEvent({ countryCode: 'US', metricKey: `US.${family}.SA.LEVEL` })?.tier).toBe('low')
    }
  })

  it('SP_* 三个 PMI 中、且不并进 ISM（族名仍是自己的）', () => {
    for (const family of ['SP_COMPOSITE_PMI', 'SP_MANUFACTURING_PMI', 'SP_SERVICES_PMI']) {
      const verdict = gradeCalendarEvent({ countryCode: 'US', metricKey: `US.${family}.SA.LEVEL` })
      expect(verdict?.tier).toBe('medium')
      expect(verdict?.family).toBe(family)
    }
  })
})

describe('PRD §10.2：回填后仍缺档的 18 族逐族定档（中 4 / 低 14 / 无高）', () => {
  it.each([
    ['CHICAGO_PMI', 'medium'],
    ['INFLATION_EXPECTATIONS', 'medium'],
    ['ISM_SERVICES_BUSINESS_ACTIVITY', 'medium'],
    ['RETAIL_SALES_CONTROL_GROUP', 'medium'],
    ['FACTORY_ORDERS_EX_TRANSPORT', 'low'],
    ['LEI_EMPLOYMENT_TRENDS', 'low'],
    ['NEW_HOME_SALES', 'low'],
    ['PENDING_HOME_SALES', 'low'],
    ['NAHB_HOUSING_MARKET', 'low'],
    ['MORTGAGE_RATE_15Y', 'low'],
    ['MORTGAGE_RATE_30Y', 'low'],
    ['CHICAGO_FED_NATIONAL_ACTIVITY', 'low'],
    ['LEI', 'low'],
    ['BUSINESS_INVENTORIES', 'low'],
    ['CORPORATE_PROFITS', 'low'],
    ['EXPORT_PRICES', 'low'],
    ['LOGISTICS_MANAGERS_INDEX', 'low'],
    ['GDP_NOWCAST', 'low'],
  ] as const)('US.%s → %s', (family, tier) => {
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: `US.${family}.SA.LEVEL` })?.tier).toBe(tier)
  })

  it('这一批没有一个是高：18 族逐族断言，避免「顺手给高」', () => {
    for (const family of ['CHICAGO_PMI', 'INFLATION_EXPECTATIONS', 'ISM_SERVICES_BUSINESS_ACTIVITY',
      'RETAIL_SALES_CONTROL_GROUP', 'FACTORY_ORDERS_EX_TRANSPORT', 'LEI_EMPLOYMENT_TRENDS', 'NEW_HOME_SALES',
      'PENDING_HOME_SALES', 'NAHB_HOUSING_MARKET', 'MORTGAGE_RATE_15Y', 'MORTGAGE_RATE_30Y',
      'CHICAGO_FED_NATIONAL_ACTIVITY', 'LEI', 'BUSINESS_INVENTORIES', 'CORPORATE_PROFITS', 'EXPORT_PRICES',
      'LOGISTICS_MANAGERS_INDEX', 'GDP_NOWCAST']) {
      expect(gradeCalendarEvent({ countryCode: 'US', metricKey: `US.${family}.SA.LEVEL` })?.tier).not.toBe('high')
    }
  })

  it('两族与 PRD 已列族不合并：15Y/30Y 各自一行，NEW_HOME_SALES 不并进 NEW_HOME_SALES_ANNUALIZED', () => {
    for (const family of ['MORTGAGE_RATE_15Y', 'MORTGAGE_RATE_30Y', 'NEW_HOME_SALES']) {
      expect(gradeCalendarEvent({ countryCode: 'US', metricKey: `US.${family}.NONE.RATE` })?.family).toBe(family)
    }
  })

  it('GDP_NOWCAST 是低而不是未分级：判过的族一律进表，不吃「不补」', () => {
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.GDP_NOWCAST.SA.ANNUALIZED_QOQ' })?.tier).toBe('low')
  })
})
