/**
 * 看板「模块 → 格 → 源」清单：**一份数据，三处渲染**
 * （业务设置的模块卡片、源详情那行「用在哪些模块」、情报源那面按模块分组的树）。
 *
 * 来源：`docs-private/iterations/dashboard-modules-by-panel-2026-11-10.md`（按看板实际用到的模块，
 * 顺序照文档）。**这里只写 id 与文案键，不写文案**：卡头文字走 `productText`，能复用既有标题键的一律复用。
 *
 * 三条写死的规矩：
 * - 一行一项：`格名 → 源`。**备源拆成单独一行**（`美元` / `美元（备用）`），值那栏只写源名——
 *   备源是真实的回落关系，不是说明句，不塞进括号挂在值里（用户 2026-11-11 定）。
 * - 一个源被多个模块用就**在每个模块下各出现一次**（读者按模块找源）。
 * - 反查（源 → 模块）由 `modulesUsingSource` 算，组件里不许再存第二份映射。
 */
export type DashboardCell = Readonly<{
  /** 格名（读数格叫法，取自冻结文档 §1/§3）；`''` = 这一行不写格名、只列源名。 */
  label: string
  sourceId: string
  /** 这一行是主源的备用回落（格名写成「美元（备用）」这种）。 */
  fallback?: boolean
}>

export type DashboardSourceModule = Readonly<{
  id: string
  /** 卡头文案的键（读者叫法）。 */
  labelKey: string
  /** 卡内容：一行一格 → 源。 */
  cells: readonly DashboardCell[]
  /** 这一模块用到的全部源（由 cells 派生）；反查「用在哪些模块」读它。 */
  sourceIds: readonly string[]
}>

const TITLES = 'settings.intelligenceSources.dashboardModuleTitles'

/** `[格名, 源 id, 是不是备用行]` → 模块；`sourceIds` 由 cells 派生，两处不会不一致。 */
function moduleOf(
  id: string,
  labelKey: string,
  rows: ReadonlyArray<readonly [string, string, boolean?]>
): DashboardSourceModule {
  const cells: DashboardCell[] = rows.map(([label, sourceId, fallback]) => ({
    label,
    sourceId,
    ...(fallback === true ? { fallback: true } : {})
  }))
  return { id, labelKey, cells, sourceIds: [...new Set(cells.map((cell) => cell.sourceId))] }
}

export const DASHBOARD_SOURCE_MODULES: readonly DashboardSourceModule[] = [
  /* 「最新 AI 结论」与「来源状态条」在文档里明说不挂源，所以不在这里出现（也不出卡）。 */
  moduleOf('cross-asset', 'pages.intelligence.portal.analysisWorkspace.readableNames.domain.cross-asset', [
    ['纳指', 'binance-futures-positioning'],
    ['美元', 'realmarketapi-market'],
    ['美元（备用）', 'twelve-data-market', true],
    ['黄金', 'realmarketapi-market'],
    ['黄金（备用）', 'twelve-data-market', true]
  ]),
  // 既有文案里只有错误句（「政策路径数据不可用」），没有标题键 → 新建这一个。
  moduleOf('policy-path', `${TITLES}.policyPath`, [['政策路径概率', 'policy-path-market']]),
  moduleOf('fear-greed', 'pages.intelligence.portal.dashboard.fearGreed.title', [['恐惧与贪婪', 'alternative-fear-greed']]),
  moduleOf('capital', 'pages.intelligence.portal.analysisWorkspace.readableNames.domain.capital', [
    ['稳定币', 'defillama-stablecoins'],
    ['ETF', '0xrouter-aggregate-provider']
  ]),
  moduleOf('positioning', 'pages.intelligence.portal.dashboard.positioning.title', [
    ['永续持仓名义额', 'binance-futures-positioning'],
    ['资金费率', 'binance-futures-positioning']
  ]),
  moduleOf('divergence', `${TITLES}.divergence`, [
    ['资金腿', 'defillama-stablecoins'],
    ['资金腿', '0xrouter-aggregate-provider'],
    ['杠杆腿', 'binance-futures-positioning'],
    ['价格腿', 'binance-futures-positioning']
  ]),
  moduleOf('macro-calendar', 'pages.intelligence.portal.dashboard.macroReleaseDynamics.sourceName', [
    ['Fed 官方日程', 'macro-calendar-fed'],
    ['BEA 官方发布', 'macro-calendar-bea'],
    ['BLS 官方日程', 'macro-calendar-bls'],
    ['0xRouter 经济数据', 'macro-calendar-0xrouter-economic-data'],
    ['0xRouter 财经事件', 'macro-calendar-0xrouter-financial-events'],
    ['0xRouter 央行活动', 'macro-calendar-0xrouter-central-bank-activities']
  ]),
  moduleOf('quotes', `${TITLES}.quotes`, [
    ['BTC', 'binance-futures-positioning'],
    ['ETH', 'binance-futures-positioning'],
    ['纳指', 'binance-futures-positioning'],
    ['美元', 'realmarketapi-market'],
    ['美元（备用）', 'twelve-data-market', true],
    ['黄金', 'realmarketapi-market'],
    ['黄金（备用）', 'twelve-data-market', true],
    ['离岸人民币', 'twelve-data-market'],
    ['10Y', 'fred-rates-liquidity']
  ]),
  moduleOf('news', 'pages.intelligence.portal.newsSentiment.title', [
    ['新闻条目', 'sec-rss'],
    ['新闻条目', 'coindesk-rss'],
    ['新闻条目', 'binance-announcements'],
    ['新闻条目', 'okx-latest-announcements']
  ])
]

/**
 * 「AI 分析用」这张卡：**四行只写源名、不写格名**（左列源名、右列留空，行样式与别的行一致）。
 *
 * 这是**唯一的无格名例外**：这 4 个源不进任何读数格，只进 AI 分析快照；硬给一个格名会造出
 * 界面上不存在的读数格（用户 2026-11-11 定，别当漏写）。卡头那颗 ⓘ 说明「这些源没有看板位，
 * 数据只给 AI 分析读」。
 */
export const AI_ANALYSIS_MODULE: DashboardSourceModule = moduleOf('ai-analysis', `${TITLES}.aiAnalysis`, [
  ['', 'binance-spot-market'],
  ['', 'okx-api-announcements'],
  ['', 'coingecko-market'],
  ['', 'defillama-tvl']
])

/** 看板业务里出现的卡：各模块 + 末尾「AI 分析用」。 */
export const DASHBOARD_TAB_MODULES: readonly DashboardSourceModule[] = [...DASHBOARD_SOURCE_MODULES, AI_ANALYSIS_MODULE]

/** 反查：这个源被哪些模块用（详情那行「用在哪些模块」读它，顺序与卡片一致）。 */
export function modulesUsingSource(sourceId: string): readonly DashboardSourceModule[] {
  return DASHBOARD_TAB_MODULES.filter((module) => module.sourceIds.includes(sourceId))
}
