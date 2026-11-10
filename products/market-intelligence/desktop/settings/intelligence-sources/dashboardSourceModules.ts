/**
 * 看板「模块 → 源」映射：**一份数据，两处渲染**（看板页签的分组、源详情那行「用在哪些模块」）。
 *
 * 来源：`docs-private/iterations/dashboard-modules-by-panel-2026-11-10.md`（按看板实际用到的模块，
 * 顺序照文档）。**这里只写 id 与键，不写文案**：组头文字走 `productText`，能复用既有标题键的一律复用
 * （恐惧与贪婪 / 永续持仓与资金费率 / 经济日历 / 资金面 / 跨资产 / 重点舆情），没有现成标题键的才新建。
 *
 * 两条规矩：
 * - 一个源被多个模块共用就**在每个模块下各出现一次**（读者按模块找源，不是按源找模块）；
 * - 反查（源 → 模块）由这里算，组件里不许再存第二份映射。
 */
export type DashboardSourceModule = Readonly<{
  id: string
  /** 组头文案的键（读者叫法）。 */
  labelKey: string
  sourceIds: readonly string[]
}>

const TITLES = 'settings.intelligenceSources.dashboardModuleTitles'

export const DASHBOARD_SOURCE_MODULES: readonly DashboardSourceModule[] = [
  /* 「最新 AI 结论」与「来源状态条」在文档里明说不挂源，所以不在这里出现。 */
  {
    id: 'cross-asset',
    // 沿用既有「跨资产」那一档，不为模块名另造「跨资产观察」。
    labelKey: 'pages.intelligence.portal.analysisWorkspace.readableNames.domain.cross-asset',
    sourceIds: ['binance-futures-positioning', 'realmarketapi-market', 'twelve-data-market']
  },
  {
    id: 'policy-path',
    // 既有文案里只有错误句（「政策路径数据不可用」），没有标题键 → 新建这一个。
    labelKey: `${TITLES}.policyPath`,
    sourceIds: ['policy-path-market']
  },
  {
    id: 'fear-greed',
    labelKey: 'pages.intelligence.portal.dashboard.fearGreed.title',
    sourceIds: ['alternative-fear-greed']
  },
  {
    id: 'capital',
    labelKey: 'pages.intelligence.portal.analysisWorkspace.readableNames.domain.capital',
    sourceIds: ['defillama-stablecoins', '0xrouter-aggregate-provider']
  },
  {
    id: 'positioning',
    labelKey: 'pages.intelligence.portal.dashboard.positioning.title',
    sourceIds: ['binance-futures-positioning']
  },
  {
    id: 'divergence',
    labelKey: `${TITLES}.divergence`,
    sourceIds: ['defillama-stablecoins', '0xrouter-aggregate-provider', 'binance-futures-positioning']
  },
  {
    id: 'macro-calendar',
    labelKey: 'pages.intelligence.portal.dashboard.macroReleaseDynamics.sourceName',
    sourceIds: [
      'macro-calendar-fed',
      'macro-calendar-bea',
      'macro-calendar-bls',
      'macro-calendar-0xrouter-economic-data',
      'macro-calendar-0xrouter-financial-events',
      'macro-calendar-0xrouter-central-bank-activities'
    ]
  },
  {
    id: 'quotes',
    labelKey: `${TITLES}.quotes`,
    sourceIds: ['binance-futures-positioning', 'realmarketapi-market', 'twelve-data-market', 'fred-rates-liquidity']
  },
  {
    id: 'news',
    labelKey: 'pages.intelligence.portal.newsSentiment.title',
    sourceIds: ['sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements']
  }
]

/**
 * 看板页签末尾那一组：**只放 4 个只进分析快照的源**（用户 2026-11-10 拍）。
 * 维护备用 9 个与未接入/隐藏 8 个不在看板页签出现——它们没有读者可见产出，摆进来只是让筛选里多一堆空源；
 * 它们在「全部」和来源设置页照旧可见可开关。
 */
export const AI_ANALYSIS_MODULE: DashboardSourceModule = {
  id: 'ai-analysis',
  labelKey: `${TITLES}.aiAnalysis`,
  sourceIds: ['binance-spot-market', 'okx-api-announcements', 'coingecko-market', 'defillama-tvl']
}

/** 看板页签里出现分组：各模块 + 末尾的「AI 分析用」。 */
export const DASHBOARD_TAB_MODULES: readonly DashboardSourceModule[] = [...DASHBOARD_SOURCE_MODULES, AI_ANALYSIS_MODULE]

/** 反查：这个源被哪些模块用（详情那行「用在哪些模块」读它，顺序与分组一致）。 */
export function modulesUsingSource(sourceId: string): readonly DashboardSourceModule[] {
  return DASHBOARD_TAB_MODULES.filter((module) => module.sourceIds.includes(sourceId))
}
