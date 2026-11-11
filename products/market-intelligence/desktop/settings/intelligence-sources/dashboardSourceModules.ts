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
  /**
   * 格级启停的**稳定键**（不是数组下标——模块顺序一变就会串格）。
   * 全局 `cellId = <moduleId>:<cellKey>`，卡片渲染、看板判断、以后存储迁移都读这一处。
   */
  cellKey: string
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

/**
 * 格名 → 稳定键。**这一份是唯一出处**：卡片渲染、看板按格判断、以后的存储迁移都从这里取，
 * 别处不许再按格名或下标拼键。新加一格 = 在这张表里加一行（漏了会编译不过，因为 `cellKey` 必填）。
 *
 * 不含 `macro-calendar:*` / `news:*`：日历与舆情在业务设置里是**平铺源名**、没有格，
 * 等选源模型定它们要不要格级开关（用户 2026-11-11）。
 */
const CELL_SLUGS: Readonly<Record<string, string>> = {
  纳指: 'ndx',
  美元: 'usd',
  '美元（备用）': 'usd-fallback',
  黄金: 'gold',
  '黄金（备用）': 'gold-fallback',
  BTC: 'btc',
  ETH: 'eth',
  '美债 10 年期': 'ust10y',
  政策路径概率: 'probability',
  恐惧与贪婪: 'index',
  稳定币: 'stablecoin',
  ETF: 'etf',
  永续持仓名义额: 'oi',
  资金费率: 'funding',
}

/** `[格名, 源 id, 是不是备用行]` → 模块；`sourceIds` 由 cells 派生，两处不会不一致。 */
function moduleOf(
  id: string,
  labelKey: string,
  rows: ReadonlyArray<readonly [string, string, boolean?, string?]>
): DashboardSourceModule {
  const cells: DashboardCell[] = rows.map(([label, sourceId, fallback, explicitKey]) => ({
    label,
    /* 键的优先级：显式给的最优先（同一格名出现两次时必须显式区分，例如背离卡的两条「资金腿」），
       其次是 `CELL_SLUGS` 的表，最后退回格名本身；没有格名的行（今天已不存在）退回源 id。 */
    cellKey: explicitKey ?? (label === '' ? sourceId : (CELL_SLUGS[label] ?? label)),
    sourceId,
    ...(fallback === true ? { fallback: true } : {})
  }))
  return { id, labelKey, cells, sourceIds: [...new Set(cells.map((cell) => cell.sourceId))] }
}

export const DASHBOARD_SOURCE_MODULES: readonly DashboardSourceModule[] = [
  /* 「最新 AI 结论」与「来源状态条」在文档里明说不挂源，所以不在这里出现（也不出卡）。 */
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
  moduleOf('macro-calendar', 'pages.intelligence.portal.dashboard.macroReleaseDynamics.sourceName', [
    ['Fed 官方日程', 'macro-calendar-fed'],
    ['BEA 官方发布', 'macro-calendar-bea'],
    ['BLS 官方日程', 'macro-calendar-bls'],
    ['0xRouter 经济数据', 'macro-calendar-0xrouter-economic-data'],
    ['0xRouter 财经事件', 'macro-calendar-0xrouter-financial-events'],
    ['0xRouter 央行活动', 'macro-calendar-0xrouter-central-bank-activities']
  ]),
  moduleOf('quotes', `${TITLES}.marketState`, [
    ['BTC', 'binance-futures-positioning'],
    ['ETH', 'binance-futures-positioning'],
    ['纳指', 'binance-futures-positioning'],
    ['美元', 'realmarketapi-market'],
    ['美元（备用）', 'twelve-data-market', true],
    ['黄金', 'realmarketapi-market'],
    ['黄金（备用）', 'twelve-data-market', true],
    /* 卡片标题用读者能看懂的名字：`10Y` 不是每个人都当它是美债十年期（用户 2026-11-11）。 */
    ['美债 10 年期', 'fred-rates-liquidity']
  ]),
  moduleOf('news', 'pages.intelligence.portal.newsSentiment.title', [
    // 四条同为「新闻条目」：显式按源给键，避免同模块内 cellId 撞车。
    ['新闻条目', 'sec-rss', false, 'sec-rss'],
    ['新闻条目', 'coindesk-rss', false, 'coindesk-rss'],
    ['新闻条目', 'binance-announcements', false, 'binance-announcements'],
    ['新闻条目', 'okx-latest-announcements', false, 'okx-latest-announcements']
  ])
]

/**
 * 曾经这里有一张「AI 分析用」卡（`binance-spot-market` / `okx-api-announcements` /
 * `coingecko-market` / `defillama-tvl`）。
 *
 * 它**按用途字段推出来的，不是真的**（用户 2026-11-11 追问后查清并删除）：这四个源在注册表里
 * 标成 `purposes: ['analysis']`，那个值只表示「不供看板 / 日历 / 日报 / 舆情用」，**没有任何分析面
 * 读它们**——分析侧的源访问表里没有它们（`marketAnalysisContextQuery.ts` 甚至给 OKX 两条写着
 * 「没有分析面读它们」）。它们的真实角色是指标事件源：抓数 → 分类器 / 影响规则 → 事件管道。
 *
 * 所以别再加回来：要给它们做界面，先证明有分析面在读。
 */
export const DASHBOARD_TAB_MODULES: readonly DashboardSourceModule[] = DASHBOARD_SOURCE_MODULES

/** 反查：这个源被哪些模块用（详情那行「用在哪些模块」读它，顺序与卡片一致）。 */
export function modulesUsingSource(sourceId: string): readonly DashboardSourceModule[] {
  return DASHBOARD_TAB_MODULES.filter((module) => module.sourceIds.includes(sourceId))
}

/**
 * 反查：这个源在**采集与数据**里有哪些格（`cellId` + 是否备用行）。
 *
 * 「数据源」那一行的启用状态要和「采集与数据」的开关一致（用户 2026-11-12），
 * 所以两处必须从同一张表取格：这里只做反查，不另存一份格清单。
 */
export function cellsUsingSource(sourceId: string): readonly { cellId: string; fallback: boolean }[] {
  return DASHBOARD_SOURCE_MODULES.flatMap((module) => module.cells
    .filter((cell) => cell.sourceId === sourceId)
    .map((cell) => ({ cellId: cellIdOf(module.id, cell), fallback: cell.fallback === true })))
}

/**
 * 一格在界面上的启用值：**缺键按卡片默认**（主格开、备用行关）。
 *
 * 「采集与数据」的卡片与「数据源」的行状态读同一个函数——第二个表达式（`?? cell.fallback !== true`）
 * 就是两套口径的开始，所以只留这一处。
 */
export function cellEnabledOrDefault(value: boolean | undefined, fallback: boolean): boolean {
  return value ?? !fallback
}

/**
 * 三张业务各自挂哪些模块（用户 2026-11-11）：
 * - 看板 = 主列那 6 个模块（不挂源的「最新 AI 结论」与「来源状态条」不在清单里）；
 * - 日历 = 经济日历那个模块（六个日历源，平铺列源名）；
 * - 舆情 = 新闻／舆情那个模块（四个源，平铺列源名）。
 * 副标题里的数字从这里算，不写死。
 */
export const BUSINESS_MODULE_IDS = {
  dashboard: ['policy-path', 'fear-greed', 'capital', 'positioning', 'quotes'],
  calendar: ['macro-calendar'],
  sentiment: ['news']
} as const

export function modulesForBusiness(business: keyof typeof BUSINESS_MODULE_IDS): readonly DashboardSourceModule[] {
  return BUSINESS_MODULE_IDS[business].map(
    (id) => DASHBOARD_SOURCE_MODULES.find((module) => module.id === id)!
  )
}

/** 这张业务用到多少个源（去重；副标题「N 个源」读它）。按 cells 现算——卡片少一行，这里的数就变。 */
export function sourceCountForBusiness(business: keyof typeof BUSINESS_MODULE_IDS): number {
  return new Set(modulesForBusiness(business).flatMap((module) => module.cells.map((cell) => cell.sourceId))).size
}

/** 全局格 id：`<moduleId>:<cellKey>`。卡片、看板判断、存储都读它。 */
export function cellIdOf(moduleId: string, cell: DashboardCell): string {
  return `${moduleId}:${cell.cellKey}`
}

/**
 * 反查：这个源在某个模块里对应哪一格（`cellId`）。
 *
 * 供「点卡片上的源名落到那一格」用：`cellId` 只从这张表算，调用点不手拼（日历那几格的
 * `cellKey` 是中文格名，手拼一次就是把第二份名字写在别处）。找不到返回 `undefined`，
 * 由调用方退回「只按模块卡定位」——那是真的没有这一格，不是猜一个 id。
 */
export function cellIdForSource(moduleId: string, sourceId: string): string | undefined {
  const module = DASHBOARD_SOURCE_MODULES.find((candidate) => candidate.id === moduleId)
  const cell = module?.cells.find((candidate) => candidate.sourceId === sourceId)
  return cell === undefined ? undefined : cellIdOf(moduleId, cell)
}

/**
 * 守卫：**同一模块内 `cellId` 不得重复**（`quotes:*` 与 `cross-asset:*` 里都有「美元」是允许的，
 * 那是不同模块）。同一个模块里**格名重复必须有显式唯一键**，否则 cellId 撞车——这条守卫就是它。
 */
export function duplicateCellIds(): readonly string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const module of DASHBOARD_TAB_MODULES) {
    for (const cell of module.cells) {
      const id = cellIdOf(module.id, cell)
      if (seen.has(id)) dupes.add(id)
      seen.add(id)
    }
  }
  return [...dupes]
}

/**
 * 守卫：同一个 `sourceId + cellKey` 不许在两张卡里各出现一次。
 * 「跨资产」与「行情卡」曾经是两张卡，纳指/美元/黄金在两边各列一遍——用户看到的就是大量重复。
 * 同一个源供给多个格是允许的（BTC/ETH/纳指 都是 `binance-futures-positioning`），重复指的是**同一个格**。
 */
export function duplicateCardCells(): readonly string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const module of DASHBOARD_TAB_MODULES) {
    for (const cell of module.cells) {
      const key = `${cell.sourceId}::${cell.cellKey}`
      if (seen.has(key)) dupes.add(key)
      seen.add(key)
    }
  }
  return [...dupes]
}
