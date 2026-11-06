/**
 * 指标显示名：**一份表、一个入口**。
 *
 * 两条来源合并在这里，不许在别处再查一次：
 * - **已注册指标**（稳定标识 `eventNameKey`，如 `cpi`）：按标识查；
 * - **自由文本指标**（0xRouter 那条路只有源站标题）：按**源站标题 trim 后逐字**查。
 *
 * 两处都查不到 → **用源站原文**（中文界面里出现英文指标名就是某种已知欠账的现状），
 * **绝不整条降级成兜底句**——漏一条只是维持现状，不是更糟。
 *
 * 下面这批自由文本条目全部有出处：本机 `macro-calendar` 库 `mi_macro_calendar_market_event_observations`
 * 里 2026-10 ~ 2026-11 实际出现过的美国标题（次数与最近日期写在每条后面）。
 * **已知限制**：标题尾部带期号（`(Sep)`、`(to 1030)`、`(Q3)`），换月就会失配；这是当前按标题查的固有代价，
 * 补条目时照实际出现的标题追加即可，不用改通知代码。
 */
export type IndicatorName = Readonly<{ zh: string; en: string }>

export const indicatorNames: Readonly<Record<string, IndicatorName>> = Object.freeze({
  // ── 九个已注册指标（`eventNameKey` 就是这些 id） ──
  cpi: { zh: '消费者物价指数（CPI）', en: 'CPI' },
  'core-cpi': { zh: '核心 CPI', en: 'Core CPI' },
  'nonfarm-payrolls': { zh: '非农就业人数', en: 'Nonfarm payrolls' },
  unemployment: { zh: '失业率', en: 'Unemployment rate' },
  'average-hourly-earnings': { zh: '平均时薪', en: 'Average hourly earnings' },
  pce: { zh: 'PCE 物价', en: 'PCE' },
  'core-pce': { zh: '核心 PCE', en: 'Core PCE' },
  gdp: { zh: 'GDP', en: 'GDP' },
  fomc: { zh: '美联储议息会议', en: 'FOMC decision' },

  // ── 自由文本标题（按源站原文逐字） ──
  'us-government-budget': { zh: '政府预算（十亿美元）', en: 'Government budget (billion USD)' }, // 8 次，2026-10-28
  'us-durable-goods-ex-defense': { zh: '扣除国防的耐用品订单（环比·修正）', en: 'Durable goods orders ex defense (MoM, revised)' }, // 5 次，2026-11-03
  'us-durable-goods-ex-transport': { zh: '扣除运输的耐用品订单（环比·修正）', en: 'Durable goods orders ex transportation (MoM, revised)' }, // 4 次，2026-11-03
  'us-rig-count': { zh: '当周钻井总数（口）', en: 'Wells drilled in the week (rigs)' }, // 3 次，2026-10-30
  'us-oil-rig-count': { zh: '当周石油钻井总数（口）', en: 'Oil wells in the week (rigs)' }, // 3 次，2026-10-30
  'us-gas-rig-count': { zh: '当周天然气钻井总数（口）', en: 'Natural gas wells in the week (rigs)' }, // 3 次，2026-10-30
  'us-challenger-layoffs': { zh: '挑战者裁员人数（万人）', en: 'Layoffs by Challenger (10,000)' }, // 3 次，2026-11-05
  'us-mba-mortgage-rate': { zh: '上周 MBA30 年期固定抵押贷款利率', en: 'MBA 30-year fixed mortgage rate' }, // 3 次，2026-10-28
  'us-initial-claims-4wk': { zh: '上周季调后初请失业金人数四周均值（万人）', en: 'Initial claims four-week average (10,000)' }, // 3 次，2026-11-05
  'us-eia-gasoline-stocks': { zh: '上周 EIA 汽油库存变化（万桶）', en: 'EIA gasoline stocks last week (10,000 barrels)' }, // 3 次，2026-10-28
  'us-eia-crude-stocks': { zh: '上周 EIA 原油库存变化（万桶）', en: 'EIA crude stocks last week (10,000 barrels)' }, // 3 次，2026-10-28
  'us-eia-refinery-utilization': { zh: '上周 EIA 炼厂设备利用率', en: 'EIA refinery utilisation last week' }, // 3 次，2026-10-28
  'us-durable-goods': { zh: '耐用品订单（环比·修正）', en: 'Durable goods orders (MoM, revised)' }, // 3 次，2026-11-03
  'us-core-capex-orders': { zh: '扣除飞机的非国防资本耐用品订单（修正）', en: 'Core capital goods orders (revised)' } // 3 次，2026-11-03
})

/** 已注册指标的稳定标识 → 表里的 id（这九个恰好同名，仍单列一张映射，别让两处各推一次）。 */
const registeredEventKeyIds: Readonly<Record<string, string>> = Object.freeze({
  cpi: 'cpi',
  'core-cpi': 'core-cpi',
  'nonfarm-payrolls': 'nonfarm-payrolls',
  unemployment: 'unemployment',
  'average-hourly-earnings': 'average-hourly-earnings',
  pce: 'pce',
  'core-pce': 'core-pce',
  gdp: 'gdp',
  fomc: 'fomc'
})

/** 自由文本标题（源站原文，`trim` 后逐字）→ 表里的 id。 */
const titleIds: Readonly<Record<string, string>> = Object.freeze({
  'Government Budget (billion USD)': 'us-government-budget',
  'Durable goods orders excluding national defense (MoM) (Revised)': 'us-durable-goods-ex-defense',
  'Durable goods orders excluding transportation (MoM) (Revised)': 'us-durable-goods-ex-transport',
  'Total number of wells drilled in the week (rigs)': 'us-rig-count',
  'Total number of oil wells in the week (rigs)': 'us-oil-rig-count',
  'Total number of natural Ki wells drilled in the week (rigs)': 'us-gas-rig-count',
  'Number of Layoffs By Challenger Companies (10,000)': 'us-challenger-layoffs',
  'Last week, MBA30-annum fixed mortgage rate': 'us-mba-mortgage-rate',
  "Last week's seasonally adjusted four-week Mean of initial K'in claims (10,000 people)": 'us-initial-claims-4wk',
  'EIA gasoline inventory transmutation last week (10,000 barrels)': 'us-eia-gasoline-stocks',
  'EIA crude oil inventory transmutation last week (10,000 barrels)': 'us-eia-crude-stocks',
  'EIA Refinery Equipment Exploitation Rate Last Week': 'us-eia-refinery-utilization',
  'Durable goods orders (MoM) (Revised)': 'us-durable-goods',
  'Deduct aircraft non-defense capital durable goods orders (Revised)': 'us-core-capex-orders'
})

/**
 * 期号是**数据的形状，不是名字的一部分**：`(Sep)`、`(Q3)`、`(to 1030)`、`(2026)` 会随期次变，
 * 不剥掉的话这张表下个月就自己失效一半。**别把这条当脏活删掉**。
 *
 * 剥法刻意窄：**只剥末尾、且只剥看起来像期号的括号段**，遇到单位括号（`(billion USD)`、`(%)`）
 * 立刻停——宽剥会把单位一起剥掉，让「政府预算（十亿美元）」和别的政府预算条目撞成一个键。
 */
const PERIOD_SUFFIX = /\((?:[A-Za-z]{3}(?:\s+\d{4})?|Q[1-4]|\d{4}|to\s*\d{1,4})\)$/i

export function stripPeriodSuffix(title: string): string {
  let base = title.trim()
  for (;;) {
    const next = base.replace(PERIOD_SUFFIX, '').trim()
    // 剥到空就是「这个标题只有一个期号」：返回空串，调用方按不匹配处理。
    if (next === '') return ''
    if (next === base) return base
    base = next
  }
}

/**
 * 一个入口：先按稳定标识，再按源站标题——**先逐字，再剥掉末尾期号**。都不中返回 `undefined`，
 * 由调用方用原文——**不许在这里回退成兜底句或空串**。
 */
export function resolveIndicatorNameId(input: Readonly<{ eventNameKey?: string; title?: string }>): string | undefined {
  const byKey = input.eventNameKey === undefined ? undefined : registeredEventKeyIds[input.eventNameKey]
  if (byKey !== undefined) return byKey
  const title = input.title?.trim()
  if (title === undefined || title === '') return undefined
  const exact = titleIds[title]
  if (exact !== undefined) return exact
  const base = stripPeriodSuffix(title)
  // 剥完为空（标题本身就是 `(Sep)` 这种）→ 不匹配，走原文。
  if (base === '' || base === title) return undefined
  return titleIds[base]
}

/** 通知文案表用的键后缀：有了 id 才有可翻的句子；没有就是原文。 */
export function indicatorNameOf(id: string): IndicatorName | undefined {
  return indicatorNames[id]
}

/** 供产品文案（事件卡片等）按语言取名字；值仍来自同一张表，不另存一份。
 *
 * 键显式列出（九个已注册指标），因为事件卡片的键类型要求它们是字面量联合；
 * 值一律引用 `indicatorNames`，不是第二份措辞。
 */
export const registeredEventNames = Object.freeze({
  'zh-CN': Object.freeze({
    'cpi': indicatorNames['cpi']!.zh,
    'core-cpi': indicatorNames['core-cpi']!.zh,
    'nonfarm-payrolls': indicatorNames['nonfarm-payrolls']!.zh,
    'unemployment': indicatorNames['unemployment']!.zh,
    'average-hourly-earnings': indicatorNames['average-hourly-earnings']!.zh,
    'pce': indicatorNames['pce']!.zh,
    'core-pce': indicatorNames['core-pce']!.zh,
    'gdp': indicatorNames['gdp']!.zh,
    'fomc': indicatorNames['fomc']!.zh,
  }),
  'en-US': Object.freeze({
    'cpi': indicatorNames['cpi']!.en,
    'core-cpi': indicatorNames['core-cpi']!.en,
    'nonfarm-payrolls': indicatorNames['nonfarm-payrolls']!.en,
    'unemployment': indicatorNames['unemployment']!.en,
    'average-hourly-earnings': indicatorNames['average-hourly-earnings']!.en,
    'pce': indicatorNames['pce']!.en,
    'core-pce': indicatorNames['core-pce']!.en,
    'gdp': indicatorNames['gdp']!.en,
    'fomc': indicatorNames['fomc']!.en,
  })
})

export type RegisteredEventNameKey = keyof typeof registeredEventNames['zh-CN']
