import { describe, expect, it } from 'vitest'

import { eventTypeNameByCode, nameByMetricKey, nameForMetricKey } from './marketCalendarCodeNames'
import { narwhalMeasureMetricKeys, zeroXRouterIndicatorIdentities } from './marketCalendarMetricIdentity'

/** 38 条已上线码名的**冻结期望值**：抄自 20 号表的现名，改一个字节这里就该红。 */
const EXPECTED_LOCKED_NAMES: Readonly<Record<string, readonly [string, string, string, string]>> = Object.freeze({
  'US.ADP.SA.CHANGE': ['ADP 就业人数变动', 'ADP 就业', 'ADP Employment Change', 'ADP Employment'],
  'US.AHE.SA.MOM': ['平均每小时工资月率', '平均时薪（月率）', 'Average Hourly Earnings, MoM', 'Avg Hourly Earnings'],
  'US.CONSTRUCTION_SPENDING.SA.MOM': ['营建支出月率', '营建支出', 'Construction Spending, MoM', 'Construction Spending'],
  'US.CONSUMER_CONFIDENCE.SA.LEVEL': ['消费者信心指数', '消费者信心', 'Consumer Confidence Index', 'Consumer Confidence'],
  'US.CONSUMER_CREDIT.SA.CHANGE': ['消费信贷变动', '消费信贷', 'Consumer Credit Change', 'Consumer Credit'],
  'US.CORE_CPI.NSA.YOY': ['核心消费者物价指数年率', '核心 CPI 年率', 'Core Consumer Price Index, YoY', 'Core CPI YoY'],
  'US.CORE_CPI.SA.MOM': ['核心消费者物价指数月率', '核心 CPI 月率', 'Core Consumer Price Index, MoM', 'Core CPI MoM'],
  'US.CORE_PCE.NSA.YOY': ['核心个人消费支出物价指数年率', '核心 PCE 年率', 'Core PCE Price Index, YoY', 'Core PCE YoY'],
  'US.CORE_PPI.NSA.YOY': ['核心生产者物价指数年率', '核心 PPI 年率', 'Core Producer Price Index, YoY', 'Core PPI YoY'],
  'US.CORE_PPI.SA.MOM': ['核心生产者物价指数月率', '核心 PPI 月率', 'Core Producer Price Index, MoM', 'Core PPI MoM'],
  'US.CPI.NSA.YOY': ['消费者物价指数（CPI）年率', 'CPI 年率', 'Consumer Price Index (CPI), YoY', 'CPI YoY'],
  'US.EXISTING_HOME_SALES.SA.COUNT': ['成屋销售总数（年化）', '成屋销售', 'Existing Home Sales, Annualized', 'Existing Home Sales'],
  'US.FACTORY_ORDERS_EX_TRANSPORT.SA.MOM': ['工厂订单（除运输）月率', '工厂订单除运输', 'Factory Orders ex Transportation, MoM', 'Factory Orders ex Transport'],
  'US.FEDERAL_BUDGET.NONE.DIFF': ['联邦预算收支', '联邦预算', 'Federal Budget Balance', 'Federal Budget'],
  'US.GDP_NOWCAST.SA.ANNUALIZED_QOQ': ['GDP 即时预测（年化季率）', 'GDP 即时预测', 'GDP Nowcast, Annualized QoQ', 'GDP Nowcast'],
  'US.GOVERNMENT_PAYROLLS.SA.CHANGE': ['政府部门就业人数变动', '政府就业', 'Government Payrolls Change', 'Government Payrolls'],
  'US.INFLATION_EXPECTATIONS.NONE.LEVEL': ['通胀预期', '通胀预期', 'Inflation Expectations', 'Inflation Expectations'],
  'US.ISM_MANUFACTURING_EMPLOYMENT.SA.LEVEL': ['ISM 制造业就业指数', 'ISM 制造业就业', 'ISM Manufacturing Employment Index', 'ISM Mfg Employment'],
  'US.ISM_SERVICES_BUSINESS_ACTIVITY.SA.LEVEL': ['ISM 服务业商业活动指数', 'ISM 服务业活动', 'ISM Services Business Activity Index', 'ISM Svcs Activity'],
  'US.JOBLESS_CLAIMS_CONTINUING.SA.COUNT': ['续请失业金人数', '续请失业金', 'Continuing Jobless Claims', 'Continuing Claims'],
  'US.JOLTS_OPENINGS.SA.COUNT': ['JOLTS 职位空缺', '职位空缺', 'JOLTS Job Openings', 'Job Openings'],
  'US.LEI_EMPLOYMENT_TRENDS.NONE.LEVEL': ['领先指标·就业趋势指数', '就业趋势', 'Leading Indicators Employment Trends', 'LEI Employment Trends'],
  'US.LOGISTICS_MANAGERS_INDEX.NONE.LEVEL': ['物流经理指数', '物流经理指数', 'Logistics Managers Index', 'LMI'],
  'US.MICHIGAN_CURRENT.NONE.LEVEL': ['密歇根大学现况指数', '密歇根现况', 'Michigan Current Conditions', 'Michigan Current'],
  'US.MORTGAGE_RATE_15Y.NONE.RATE': ['15 年期固定抵押贷款利率', '15 年房贷利率', '15-Year Fixed Mortgage Rate', '15Y Mortgage Rate'],
  'US.MORTGAGE_RATE_30Y.NONE.RATE': ['30 年期固定抵押贷款利率', '30 年房贷利率', '30-Year Fixed Mortgage Rate', '30Y Mortgage Rate'],
  'US.NFIB_OPTIMISM.NONE.LEVEL': ['NFIB 小型企业信心指数', 'NFIB 小企业信心', 'NFIB Small Business Optimism Index', 'NFIB Optimism'],
  'US.NONFARM.SA.CHANGE': ['非农业就业人数变动', '新增就业', 'Nonfarm Payrolls Change', 'Nonfarm Payrolls'],
  'US.PARTICIPATION_RATE.SA.RATE': ['劳动力参与率', '参与率', 'Labor Force Participation Rate', 'Participation Rate'],
  'US.REDBOOK_RETAIL_SALES.NONE.YOY': ['红皮书商业零售销售年率', '红皮书零售', 'Redbook Retail Sales, YoY', 'Redbook'],
  'US.SP_COMPOSITE_PMI.SA.LEVEL': ['标普全球综合 PMI', '综合 PMI', 'S&P Global Composite PMI', 'Composite PMI'],
  'US.SP_MANUFACTURING_PMI.SA.LEVEL': ['标普全球制造业 PMI', '制造业 PMI', 'S&P Global Manufacturing PMI', 'Mfg PMI'],
  'US.SP_SERVICES_PMI.SA.LEVEL': ['标普全球服务业 PMI', '服务业 PMI', 'S&P Global Services PMI', 'Services PMI'],
  'US.TRADE_BALANCE.NONE.DIFF': ['贸易帐', '贸易帐', 'Trade Balance', 'Trade Balance'],
  'US.UNEMPLOYMENT.SA.RATE': ['失业率', '失业率', 'Unemployment Rate', 'Unemployment Rate'],
  'US.USED_CAR_PRICES.NONE.MOM': ['二手车价格月率', '二手车价格', 'Used Car Prices, MoM', 'Used Car Prices'],
  'US.VEHICLE_SALES.SA.COUNT': ['汽车销量（年化）', '汽车销量', 'Vehicle Sales, Annualized', 'Vehicle Sales'],
  'US.WHOLESALE_INVENTORIES.SA.MOM': ['批发库存月率', '批发库存', 'Wholesale Inventories, MoM', 'Wholesale Inventories'],
})

/**
 * 名表两件事：**旧名字一个字节都不许变**、**在用的码不许没名字**。
 */
describe('码名', () => {
  it('回归基准：38 条已上线码名逐字不变', () => {
    // 期望值来自产品经理 20 号表的现名——那 38 个名字已经在卡片和日历行里，
    // 重构改动它们就是一次没人申报的文案变更。
    const locked = Object.entries(nameByMetricKey).filter(([, entry]) => entry.locked)
    expect(locked).toHaveLength(39)   // 2026-11-14：官方 GDP 的码补上名字后 +1
    // 期望值是**字面常量**（抄自 20 号表现名），不是从表里自己比自己——那样改了也不会红。
    for (const [metricKey, expected] of Object.entries(EXPECTED_LOCKED_NAMES)) {
      const actual = nameForMetricKey(metricKey)!
      expect([actual.zhFull, actual.zhShort, actual.enFull, actual.enShort], metricKey).toEqual([...expected])
    }
    expect(nameForMetricKey('US.CPI.NSA.YOY')?.zhShort).toBe('CPI 年率')
    expect(nameForMetricKey('US.NONFARM.SA.CHANGE')?.zhShort).toBe('新增就业')
    expect(nameForMetricKey('US.CORE_PCE.NSA.YOY')?.zhShort).toBe('核心 PCE 年率')
    for (const [metricKey, entry] of locked) {
      expect(nameForMetricKey(metricKey), metricKey).toMatchObject({
        zhFull: entry.zhFull, zhShort: entry.zhShort, enFull: entry.enFull, enShort: entry.enShort
      })
    }
  })

  it('事件型有显示名（20 条，取自 20 号表）', () => {
    expect(Object.keys(eventTypeNameByCode)).toHaveLength(20)
    expect(nameForMetricKey('evt.central-bank-speech')?.zhShort).toBeTruthy()
    expect(nameForMetricKey('evt.fomc')?.zhFull).toBe('美联储议息会议')
  })

  it('四列各自唯一（简称撞车读者就分不清）', () => {
    const entries = Object.values(nameByMetricKey)
    for (const field of ['zhFull', 'zhShort', 'enFull', 'enShort'] as const) {
      const seen = new Map<string, string>()
      for (const [metricKey, entry] of Object.entries(nameByMetricKey)) {
        const value = entry[field]
        expect(seen.get(value) ?? metricKey, `${field} 撞车：${value}`).toBe(metricKey)
        seen.set(value, metricKey)
      }
    }
    expect(entries.length).toBe(183)
  })

  it('覆盖守卫：每一个在用码都有名字，一个都不许缺', () => {
    const inUse = new Set<string>([
      ...Object.values(narwhalMeasureMetricKeys),
      ...Object.values(zeroXRouterIndicatorIdentities).map((entry) => entry.metricKey)
    ])
    const uncovered = [...inUse].filter((key) => nameForMetricKey(key) === undefined)
    expect(uncovered, `这些在用码没有名字：\n${uncovered.join('\n')}`).toEqual([])
    expect(inUse.size).toBe(163)
  })
})
