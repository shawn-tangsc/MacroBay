import type { MarketFactId } from '../../../contracts/factSources'

/**
 * 数据源注册表的**契约**：源定义、提供方定义、激活分组、面板。
 *
 * 这里只有类型，没有数据也没有逻辑——拆分前它们和 500 行的定义表挤在一个文件里，
 * 想看清一个字段就得翻过一百多行数据。数据在 `providerDefinitions.ts`，
 * 面板与激活分组在 `activationRegistry.ts`，对外的 import 面仍由 `providerRegistry.ts` 出口。
 */

export type AgentId = 'crypto' | 'stocks' | 'futures'
export type PanelId = 'dashboard' | 'economic-calendar'
/**
 * 一个源**供给哪些模块**。这是唯一的声明；`panels` 由它派生（见 `src()`），
 * 所以「这个源出现在哪一屏」只有一处事实，不会两处各写一份。
 *
 * `briefing` / `sentiment` 对应的是日报与舆情两条**消费线**，它们没有「面板」这一层，
 * 因此不映射到任何 `PanelId`——把其中一个映射成面板，会让源凭空出现在看板上。
 */
export type SourcePurpose = 'dashboard' | 'calendar' | 'briefing' | 'sentiment' | 'analysis'
export type SourceCategory = 'macro' | 'crypto' | 'aggregate' | 'system'
export type SourceVisibility = 'visible' | 'pending' | 'advanced' | 'hidden'
export type SourceCollection = 'adapter' | 'provider' | 'job' | 'none'
export type SourceTier = 'required' | 'recommended' | 'optional'
export type SourceKind = 'feed' | 'official-calendar' | 'market-calendar' | 'status'
export type SourceReadiness = 'live' | 'fixture-ready' | 'planned'

export type SourceCapabilities = {
  runNow: 'adapter' | 'provider' | 'job' | 'none'
  testConnection: boolean
  blsSync?: boolean
}

export type SourceDefinition = {
  sourceId: string
  providerId: string
  displayName: string
  agents: AgentId[]
  /**
   * 供给哪些模块。唯一声明；`panels` 是它的投影，见 `src()`。
   *
   * **定义上可选**：`src()` 总会填（真实数据没有 undefined），但全仓很多测试夹具在直接构造
   * `SourceDefinition`，把它设成必填会让那些文件变红——而它们不是这条的判据。
   * 判据是那条「39 个源的派生 `panels` 与改前逐项相等」的快照守卫。
   */
  purposes?: SourcePurpose[]
  /** 派生的显示位置，不单独声明：`dashboard → ['dashboard']`、`calendar → ['economic-calendar']`。 */
  panels: PanelId[]
  /**
   * 这个源**能供哪些事实**（架构师 2026-11-13 裁定：放这里，不放 sourceCatalog）。
   * 解析器判据里有「这个源在不在采」，而那个事实与目标侧是同一份 `SourceView`
   * （`SourceDefinition & { enabled, jobRegistered }`）；放 catalog 就得跨两张表拼，
   * 拼出来的答案和调度器看的不是同一个对象。声明了不等于归你——还要开着、作业真注册着。
   */
  provides?: readonly MarketFactId[]
  /**
   * 供维护/备用：今天没有任何读者可见产出。
   *
   * 它只解释「为什么 `purposes` 是空的」，**不表示不要采集**，也不许驱动任何面板、列表或开关状态。
   * 与 `purposes` 的关系是「至少一个 purpose，或本标记」——两者都没有的源，要么是漏填，要么该下线。
   */
  maintenanceOnly?: true
  /**
   * 给读者看的一句话摘要的**键**，句子在中英文案表里，键名约定
   * `settings.intelligenceSources.sourceSummary.<sourceId>`。
   *
   * 句子由产品出；没有句子就不接键，别自己造一句。
   */
  summaryKey?: string
  visibility: SourceVisibility
  collection: SourceCollection
  kind: SourceKind
  capabilities: SourceCapabilities
  readiness: SourceReadiness
  readinessNote?: string
  adapterRef?: string
  /**
   * The source's API host is edge-blocked from some networks (for example mainland China) and is
   * only reachable through a working local proxy. Declared once per source; a provider-level
   * need is derived with `sources.some(...)` rather than stored a second time.
   *
   * **这是实测出来的，不是猜的**（2026-11-12）：对每个源的接口做「直连 vs 经本地代理」对照，
   * 直连拿到**可用的** 2xx/4xx 视为可达；直连 000（DNS/连接失败）或只回一张边缘拦截页的算需要代理。
   * 当天结论：
   * binance / okx / coingecko / coindesk / Polymarket / 以太坊基金会博客 / Coinbase·Kraken·Solana
   * 状态页需要代理；DeFiLlama、美联储、SEC、CFTC、BLS、BEA、财政部、FRED、GitHub、
   * Alternative.me、realmarketapi、Twelve Data 直连可达。
   * **0xRouter 例外（读者 2026-11-12 确认）**：直连虽然回了 403，但那是边缘拦截、不是可用响应，
   * 它的接口实际要经代理才通——按读者口径标 `requiresProxy`，不拿那一张 403 页当「可达」。
   */
  requiresProxy?: boolean
  /**
   * The source cannot be fetched at all right now, by a recorded decision rather than by a failure.
   *
   * Different from `readiness: 'planned'` (never wired) and from a failed run (it may come back):
   * here the endpoint itself refuses every attempt, so automatic collection is **stopped** and the
   * settings page must say 「不可用」+ the reason instead of showing a green or a failing state.
   * `reasonCode` is the existing failure vocabulary, not a new one.
   */
  unavailable?: Readonly<{
    reasonCode: 'official-endpoint-returned-403'
    automaticSync: 'stopped'
    /** Last time this source actually wrote data; the reader is told the data is that old. */
    lastSuccessfulSyncAt?: string
    /** When the decision was taken (a date, not an instant: it is a decision, not a run). */
    decidedAt: string
  }>
}

export type ProviderDefinition = {
  providerId: string
  displayName: string
  category: SourceCategory
  credential: 'none' | 'api-key'
  /**
   * Which of the provider's sources the credential box belongs to.
   *
   * Derived by default from the first source collected by an adapter, because that used to be the
   * only kind that could hold a key. A source that must be testable while it is deliberately not
   * collectable (`collection: 'none'`) has no such source, so the provider states its anchor here
   * instead of the projection guessing — the guess returning nothing is what makes the key box
   * disappear entirely.
   */
  credentialSourceId?: string
  /**
   * Show the credential-state line on this provider's detail page (未配置 / 已保存待验证 /
   * 连接失败：原因 / 连接正常). A display fact about this provider, deliberately not a notice kind:
   * the notice slot was doing double duty, so a provider that only verified its key also got its
   * collection switch locked — which is wrong the moment the source really collects.
   */
  credentialStateLine?: true
  /** Public home page, opened in the system browser. */
  website?: string
  /** Signup / API-key guide. Replace with the operator's invite link. */
  signupUrl?: string
  /** True when signupUrl carries the operator's invite code. */
  invite?: boolean
  /**
   * 补充说明的**类别**（不是状态、不是句子）：由渲染层映射成两语文案。
   * 加一个同类源 = 在这里标一个值 + 同批加两条文案，不改组件。
   */
  notice?: ProviderNoticeKind
  sources: SourceDefinition[]
}

/** 源详情页头上方的说明横幅类别；新增一种要同时加两语文案（渲染层映射）。 */
export type ProviderNoticeKind =
  | 'private-data-source'
  /* The source is registered and testable but deliberately collects nothing in this build. */
  | 'verification-only'

export type ActivationGroupDefinition = {
  groupId: string
  agentId: AgentId
  tier: SourceTier
  sourceIds: string[]
}

export type AgentDefinition = {
  agentId: AgentId
  displayName: string
  activation: 'available' | 'coming-soon'
  groups: ActivationGroupDefinition[]
}

export type PanelDefinition = {
  panelId: PanelId
  agentId: AgentId
  displayName: string
}
