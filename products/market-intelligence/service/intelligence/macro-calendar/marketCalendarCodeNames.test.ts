import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { eventTypeNameByCode, nameByMetricKey, nameForMetricKey, registeredSourceIdentityName,
  sourceInternalIdOf } from './marketCalendarCodeNames'
import { zeroXRouterIndicatorIdentities } from './marketCalendarMetricIdentity'
import { narwhalMeasureMetricKeys } from './marketCalendarNarwhalMeasureKeys'

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
    expect(entries.length).toBe(189)
  })

  /**
   * 0.4.5 #14：源内身份有没有登记显示名，**只问登记表**，不读名字用了哪些字。
   * 解析只有一处实现（`sourceInternalIdOf`）：身份第一段是源自己给的，不是我们猜的映射。
   */
  it('登记的源内身份给出中英名；没登记返回 undefined（回退源原文名，不编名字）', () => {
    // 身份第一段只是「记录 id」，每期都换；登记表按**源的稳定指标 id**（series_id）查。
    expect(sourceInternalIdOf('["9553",79090]')).toBe('id:9553')
    expect(sourceInternalIdOf('US.CPI.NSA.YOY')).toBe('US.CPI.NSA.YOY')
    expect(registeredSourceIdentityName('9553')).toEqual({
      zh: '批发物价指数(年率)', en: 'Wholesale Price Index (YoY)'
    })
    expect(registeredSourceIdentityName('45210')).toBeUndefined()
    // 没有稳定 id 就是「不知道是哪一条」，不许按别的字段猜。
    expect(registeredSourceIdentityName(undefined)).toBeUndefined()
    expect(registeredSourceIdentityName('  ')).toBeUndefined()
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

/**
 * 码本体只认名称表（裁定 `0.4.5-指标码单源`，2026-11-25）。
 *
 * 这一组替代了原来那条「散落在别处的码必须在 catalog 里」：catalog 的键集就是这些表的**并集**，
 * 等于自己判自己；而且它只扫 8 个文件，36 个带码文件里漏了 28 个（覆盖 572/1849 处字面量）。
 * 现在判据是「在 `nameByMetricKey` 里」，扫描面是整个模块，白名单外的文件一个漏网的码都不许有。
 */
const MODULE_ROOT = join(process.cwd(), 'products/market-intelligence')

/** 指标码的形状：`US.<测度>.<口径>.<量纲>`，四段起。两段的 `US.CPI` 是发布前缀，不是码。 */
const CODE_LITERAL = /'([A-Z]{2,4})\.[A-Z0-9_]+(?:\.[A-Z0-9_]+){2,}'/g

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walkSourceFiles(full, out)
      continue
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue
    out.push(full)
  }
  return out
}

function modulePathOf(file: string): string {
  return relative(MODULE_ROOT, file).split(sep).join('/')
}

function codesIn(text: string): string[] {
  return [...text.matchAll(CODE_LITERAL)].map((match) => match[0].slice(1, -1))
}

/**
 * 白名单：码**不属于 US 标准码**的那个命名空间。每条必须写清为什么，且只收「整文件」；
 * 唯一的目录例外是 0xRouter 的 20 个国家分片——一个国家一文件，逐个列 20 行只是噪音。
 */
const SOURCE_STYLE_DIRECTORY = {
  path: 'service/intelligence/macro-calendar/marketCalendarCountrySourceMappings-byCountry',
  reason: '0xRouter 按国家分片：值是产品码表那套风格（`US.REAL_GDP.NONE.ANNUALIZED_QOQ`），'
    + '与标准码是两套身份，本版不合并（裁定 §3.2）。'
} as const

const SOURCE_STYLE_FILES = [
  {
    path: 'service/intelligence/macro-calendar/marketCalendarGermanSourceMappings.ts',
    reason: '德源映射：键是德语原文串，值是德源那套码（`DE.…`），不是 US 标准码。'
  },
  {
    path: 'service/intelligence/macro-calendar/marketCalendarPendingProductCodePairs.ts',
    optional: true,
    reason: 'R45 的「一指标两码」挂起清单：picked / deferred 两个码都取自产品码表那套，'
      + '本版不并（裁定 §3.2）。文件 2026-11-25 才落地，所以标 optional：还没出现时不要求它在。'
  }
] as const

/** 这些文件必须被扫到（每个都带着 US 标准码）：守卫把遍历改窄就红，而不是悄悄变绿。 */
const FILES_THAT_MUST_BE_SCANNED = [
  'contracts/metricKeyConcept.ts',
  'service/intelligence/macro-calendar/macroCalendarReleaseValueMappingPolicy.ts',
  'service/intelligence/macro-calendar/marketCalendarCodeNames.ts',
  'service/intelligence/macro-calendar/marketCalendarDisplayNameTables.ts',
  'service/intelligence/macro-calendar/marketCalendarMetricIdentity.ts',
  'service/intelligence/macro-calendar/marketCalendarNarwhalMeasureKeys.ts',
  'service/intelligence/macro-calendar/marketCalendarReleaseGroups.ts',
  'service/intelligence/macro-calendar/marketCalendarZeroXRouterSourceMappings.ts',
  'service/intelligence/macro-calendar/fredIndicatorYoY.ts',
  'service/intelligence/macro-calendar/narwhal-calendar/narwhalSeriesPrimaryMetric.ts'
] as const

function isWhitelisted(modulePath: string): boolean {
  return modulePath.startsWith(`${SOURCE_STYLE_DIRECTORY.path}/`)
    || SOURCE_STYLE_FILES.some((entry) => entry.path === modulePath)
}

describe('码本体：散落各处的码必须在名称表里', () => {
  it('每个码字面量都在 nameByMetricKey 里（白名单外一个都不许有）', () => {
    const violations: string[] = []
    let scannedFiles = 0
    let scannedLiterals = 0
    for (const file of walkSourceFiles(MODULE_ROOT)) {
      const modulePath = modulePathOf(file)
      if (isWhitelisted(modulePath)) continue
      const codes = codesIn(readFileSync(file, 'utf8'))
      if (codes.length === 0) continue
      scannedFiles += 1
      scannedLiterals += codes.length
      for (const code of new Set(codes)) {
        if (nameByMetricKey[code] === undefined) violations.push(`${modulePath}: ${code}`)
      }
    }
    expect(violations.sort(), `这些码不在名称表里：\n${violations.join('\n')}`).toEqual([])
    /* 棘轮：白名单外的文件数与字面量数只许涨（2026-11-25 实测 13 个文件 / 960 处）。
       改窄遍历会先在这里红，而不是让上面那条悄悄变成空转。 */
    expect(scannedFiles).toBeGreaterThanOrEqual(12)
    expect(scannedLiterals).toBeGreaterThanOrEqual(900)
  })

  it('扫描面覆盖到每一个必须被扫的带码文件', () => {
    const scanned = new Set(walkSourceFiles(MODULE_ROOT)
      .filter((file) => codesIn(readFileSync(file, 'utf8')).length > 0)
      .map(modulePathOf))
    for (const required of FILES_THAT_MUST_BE_SCANNED) {
      expect(scanned.has(required), `${required} 没有被扫到`).toBe(true)
    }
  })

  it('白名单条目：必选的要真在、且确实带码；可选的在出现了也要带码（别留空挂）', () => {
    for (const entry of SOURCE_STYLE_FILES) {
      const full = join(MODULE_ROOT, entry.path)
      const optional = 'optional' in entry && entry.optional === true
      if (optional && !existsSync(full)) continue
      expect(existsSync(full), entry.path).toBe(true)
      expect(codesIn(readFileSync(full, 'utf8')).length, entry.path).toBeGreaterThan(0)
    }
    const shardDir = join(MODULE_ROOT, SOURCE_STYLE_DIRECTORY.path)
    expect(existsSync(shardDir), SOURCE_STYLE_DIRECTORY.path).toBe(true)
    expect(readdirSync(shardDir).filter((name) => name.endsWith('.ts')).length).toBeGreaterThanOrEqual(20)
  })
})

/**
 * 两套美国码（裁定 §3.2）。实测：**标准码** 189 个在名称表（`US.CPI.NSA.YOY`）；
 * **产品目录码** 在 `marketCalendarCountryCodeTable.json`（616 条，其中 US 94 条），
 * 例 `US.REAL_GDP.NONE.ANNUALIZED_QOQ`。两套交集 **0**，是两种身份；本版不合并（产品级重命名），
 * 但同一个字符串同时出现在两套里必须能红。
 *
 * 两条实测校正（写在这里，免得下一个人照文档抄错）：
 * 1. `marketCalendarCodeTable.json`（225 条）不是第二套——它的 189 个 US 键**就是**名称表这 189 个
 *    标准码（DE 36 条是德源码），属同一套身份；
 * 2. 按国家分片不是纯产品码：`byCountry/us.ts` 里多数是标准码，另有若干只在分片里的产品码。
 *    所以产品码族只按国家码表 JSON 定义，不拿分片定义。
 */
function productCatalogCodes(): ReadonlySet<string> {
  const parsed = JSON.parse(readFileSync(
    join(MODULE_ROOT, 'service/intelligence/macro-calendar/marketCalendarCountryCodeTable.json'), 'utf8'
  )) as Record<string, unknown>
  return new Set(Object.keys(parsed))
}

describe('两套美国码不混用', () => {
  it('产品目录码不许进名称表（同一个字符串只能属于一套身份）', () => {
    const productCodes = productCatalogCodes()
    expect(productCodes.size).toBeGreaterThan(500)
    expect([...productCodes].filter((code) => code.startsWith('US.')).length).toBeGreaterThan(80)
    const mixed = Object.keys(nameByMetricKey).filter((code) => productCodes.has(code))
    expect(mixed.sort(), `这两套码混用了：\n${mixed.join('\n')}`).toEqual([])
  })

  it('产品目录码不许出现在白名单外的文件里（卡片行也一样）', () => {
    const productCodes = productCatalogCodes()
    const violations: string[] = []
    for (const file of walkSourceFiles(MODULE_ROOT)) {
      const modulePath = modulePathOf(file)
      if (isWhitelisted(modulePath)) continue
      for (const code of new Set(codesIn(readFileSync(file, 'utf8')))) {
        if (productCodes.has(code)) violations.push(`${modulePath}: ${code}`)
      }
    }
    expect(violations.sort(), `这些是产品目录那套码，别拿来当运行时身份：\n${violations.join('\n')}`)
      .toEqual([])
  })
})
