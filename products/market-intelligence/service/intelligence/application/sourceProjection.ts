import {
  officialCalendarFeedsAvailability,
  type CalendarOfficialFeedsAvailability
} from './officialCalendarAvailability'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'
import {
  agentRegistry,
  allSources,
  getAgent,
  getPanel,
  getProvider,
  panelRegistry,
  providerRegistry,
  type AgentDefinition,
  type AgentId,
  type PanelDefinition,
  type PanelId,
  type ProviderDefinition,
  type SourceCategory,
  type SourceDefinition
} from './providerRegistry'

/**
 * 连续失败达到这个次数，一个来源才算「多次失败」而不是「数据偏旧」。
 *
 * 只有一处定义：设置页的状态词与提醒能力（读来源状态的 Agent 能力）都从这里取，
 * 两边各写一个 3 的那天，读者会看到「多次失败」而提醒从不触发。
 */
export const SOURCE_REPEATED_FAILURE_THRESHOLD = 3

/**
 * 一个源此刻的健康读数（管线投影出来的那几项）。**只作为派生五态的输入**，不直接上界面：
 * 界面读 `SourceView.healthState`，不要再自己拿 `runtimeStatus`/`consecutiveFailures` 判一遍。
 */
export type SourceHealthFact = Readonly<{
  runtimeStatus: 'healthy' | 'degraded' | 'failed' | 'paused'
  consecutiveFailures: number
}>

/**
 * 一个源对读者呈现的五态（C6，2026-11-10）：**全仓只在这里判一次**。
 *
 * - `healthy`：启用、可用、健康读数说 healthy → 绿；
 * - `repeated-failures`：降级且连续失败到阈值 → 红（「多次失败」，不是「数据偏旧」）；
 * - `stale`：降级但没到阈值 → 黄（「数据偏旧」）；
 * - `failed`：健康读数说 failed → 红；
 * - `off`：**不亮的那一档**——没启用，或已启用但现在取不到（`unavailable`，如 BLS 403），
 *   或根本没有健康读数。「没有数据不等于健康」，所以它也落这一档，而不是绿。
 *
 * `off` 只说**颜色上不亮**，不等于「读者关掉了」：不可用的读者用词由各自那句给（源行「不可用」），
 * 这一层不给词。
 */
export type SourceHealthState = 'healthy' | 'repeated-failures' | 'stale' | 'failed' | 'off'

export function sourceHealthState(input: Readonly<{
  enabled: boolean
  unavailable?: boolean
  health?: SourceHealthFact
}>): SourceHealthState {
  if (!input.enabled) return 'off'
  // 「取不到」不是「失败」：不可用按不亮处理，不给红（红只给这次失败、能修的那种）。
  if (input.unavailable === true) return 'off'
  const health = input.health
  if (health === undefined) return 'off'
  if (health.runtimeStatus === 'healthy') return 'healthy'
  if (health.runtimeStatus === 'failed') return 'failed'
  if (health.runtimeStatus === 'paused') return 'off'
  return health.consecutiveFailures >= SOURCE_REPEATED_FAILURE_THRESHOLD ? 'repeated-failures' : 'stale'
}

/** 五态的严重度：目录点取「已启用源里最差的一档」时只排顺序，不再判一次健康。 */
const HEALTH_STATE_SEVERITY: Record<SourceHealthState, number> = {
  healthy: 0, off: 1, stale: 2, 'repeated-failures': 3, failed: 3
}

/**
 * 一个 provider 在左栏目录里该显示的态：已启用源里最差的一档；一个都没启用＝`off`。
 * 目录点与设置页左树都读它，两处不再各写一份「取最差」。
 */
export function providerHealthState(sources: readonly Readonly<{ enabled: boolean; healthState: SourceHealthState }>[]): SourceHealthState {
  let worst: SourceHealthState | undefined
  for (const source of sources) {
    if (!source.enabled) continue
    if (worst === undefined || HEALTH_STATE_SEVERITY[source.healthState] > HEALTH_STATE_SEVERITY[worst]) worst = source.healthState
  }
  return worst ?? 'off'
}

/**
 * 目录标记档：**第二个通道（形状），但和五态出自同一处派生**（架构师 2026-11-10）。
 *
 * 消费者只拿这个值，不再自己看 `enabled && unavailable`——判据只有这里一份：
 * - `bad` / `warn` 直接来自五态（红/黄实心）；
 * - `ring` = **已启用且这个源判定不可用**。`off` 同时盖着「未启用 / 取不到 / 没有读数」，
 *   所以不能只按状态画环：未启用、没数据都落 `none`；
 * - `none` = 不画。
 */
export type SourceHealthMarker = 'none' | 'ring' | 'warn' | 'bad'

export function sourceHealthMarker(input: Readonly<{
  enabled: boolean
  unavailable?: boolean
  state: SourceHealthState
}>): SourceHealthMarker {
  if (isFailingHealthState(input.state)) return 'bad'
  if (input.state === 'stale') return 'warn'
  return input.enabled && input.unavailable === true ? 'ring' : 'none'
}

const MARKER_SEVERITY: Record<SourceHealthMarker, number> = { none: 0, ring: 1, warn: 2, bad: 3 }

/** 一个 provider 的目录标记：已启用源里最差的一档（同样只排顺序，不再判一次）。 */
export function providerHealthMarker(sources: readonly Readonly<{ healthMarker: SourceHealthMarker }>[]): SourceHealthMarker {
  let worst: SourceHealthMarker = 'none'
  for (const source of sources) {
    if (MARKER_SEVERITY[source.healthMarker] > MARKER_SEVERITY[worst]) worst = source.healthMarker
  }
  return worst
}

/** 红色两档的判据：这次失败、还能修。其余状态都不是「坏了」。 */
export function isFailingHealthState(state: SourceHealthState): state is 'failed' | 'repeated-failures' {
  return state === 'failed' || state === 'repeated-failures'
}

export type ProjectionState = {
  enabledById?: Readonly<Record<string, boolean>>
  healthById?: Readonly<Record<string, SourceHealthFact>>
  jobRegisteredById?: Readonly<Record<string, boolean>>
  /** Sources that already have a profile, including disabled ones. */
  knownSourceIds?: ReadonlySet<string>
}

export type SourceView = SourceDefinition & {
  /**
   * 采集由谁负责（来自 catalog）：`product` = 产品自己的作业决定节奏，通用采集器不按预设跑。
   * UI 据此决定频率那一行显示文字还是下拉（用户 2026-11-12）。
   */
  collectionOwner?: 'adapter' | 'product'
  enabled: boolean
  jobRegistered?: boolean
  /** 五态结论，与其他面读的是同一个字段（见 `sourceHealthState`）。 */
  healthState: SourceHealthState
  /** 目录标记档，与五态同一处派生（见 `sourceHealthMarker`）；消费者不再自己判。 */
  healthMarker: SourceHealthMarker
}

/** ProviderView 的目录标记：由它的源聚合，仍是同一份派生，组件不再二次判断。 */

export type ProviderView = {
  providerId: string
  displayName: string
  category: SourceCategory
  credential: ProviderDefinition['credential']
  /**
   * The source that owns the provider's credential and probe, taken from the provider registry so
   * it survives a panel that does not list that source (for example the calendar pane, where the
   * dashboard-only aggregate source is absent).
   */
  credentialSourceId?: string
  website?: string
  signupUrl?: string
  invite?: boolean
  /** 页头说明横幅的类别（见 `ProviderDefinition.notice`）。 */
  notice?: ProviderDefinition['notice']
  sources: SourceView[]
  /** 目录标记档（provider 级，源里最差的一档）。 */
  healthMarker: SourceHealthMarker
}

export type CategoryGroupView = {
  category: SourceCategory
  providers: ProviderView[]
}

export type SettingsView = {
  groups: CategoryGroupView[]
  counts: { total: number; enabled: number; pending: number; failed: number }
}

export type AgentGroupView = {
  groupId: string
  tier: AgentDefinition['groups'][number]['tier']
  sources: SourceView[]
}

export type AgentView = {
  agent: AgentDefinition
  groups: AgentGroupView[]
  counts: { groups: number; sources: number; enabled: number }
}

export type PanelView = {
  panel: PanelDefinition
  providers: ProviderView[]
  counts: { sources: number; enabled: number }
  /**
   * 官方日历腿的三态（只在经济日历这个面板上出现）。日历页据此把「来源全关 / 本月确实没有 /
   * 取不到」拆开；一处算、一处读——页面不再自己遍历注册表。
   */
  calendarOfficialFeeds?: CalendarOfficialFeedsAvailability
}

const categoryOrder: SourceCategory[] = ['macro', 'crypto', 'aggregate', 'system']

function toView(source: SourceDefinition, state: ProjectionState): SourceView {
  const enabled = state.enabledById?.[source.sourceId] === true
  const health = state.healthById?.[source.sourceId]
  const healthState = sourceHealthState({
    enabled,
    ...(source.unavailable === undefined ? {} : { unavailable: true }),
    ...(health === undefined ? {} : { health })
  })
  return {
    ...source,
    ...(getIntelligenceSourceDefinition(source.sourceId)?.collectionOwner === 'product' ? { collectionOwner: 'product' as const } : {}),
    enabled,
    healthState,
    healthMarker: sourceHealthMarker({ enabled, ...(source.unavailable === undefined ? {} : { unavailable: true }), state: healthState }),
    ...(state.jobRegisteredById?.[source.sourceId] !== undefined ? { jobRegistered: state.jobRegisteredById[source.sourceId] } : {})
  }
}

/**
 * 一份事实（C4-S0）：**三个读命令的唯一计算点**。
 *
 * 设置视图 / 面板视图 / 单源分页读的都是这同一份 per-source 事实；三者之间只允许两处差异——
 * **筛了哪些源**（全量 / 按 panelId / 按 sourceId）与**带不带详情**（详情再叠运行时配置、计划规则等）。
 * 任何一处自己再算一遍 `enabled` / 健康档 / 任务注册，都会让同一屏出现两份互相打架的事实。
 *
 * 这里只做纯计算：profile、健康读数、任务注册、凭据状态都由调用方一次读好传进来。
 */
export type SourceConfigFact = Readonly<{
  sourceId: string
  definition: SourceDefinition
  /** 调用方读好的 profile（`resolveProfile` 会给未存过的源一份默认）。 */
  profile: IntelligenceSourceProfile
  enabled: boolean
  health?: SourceHealthFact
  healthState: SourceHealthState
  healthMarker: SourceHealthMarker
  jobRegistered?: boolean
  credentialStatus?: Readonly<{ hasCredential: boolean; maskedPreview?: string; lastValidatedAt?: string }>
}>

export type SourceConfigSurface = Readonly<{
  /** 按 `panelId` / `sourceId` 筛过的事实；没给就是全量。 */
  facts: readonly SourceConfigFact[]
  byId: Readonly<Record<string, SourceConfigFact>>
  /** 同一份事实摊成既有视图要的形状——三个命令共用一个 state，不再各自拼。 */
  state: ProjectionState
}>

export function sourceConfigSurface(input: {
  definitions?: readonly SourceDefinition[]
  profileById: Readonly<Record<string, IntelligenceSourceProfile>>
  healthById: Readonly<Record<string, SourceHealthFact>>
  jobRegisteredById: Readonly<Record<string, boolean>>
  credentialStatusById?: Readonly<Record<string, SourceConfigFact['credentialStatus']>>
  panelId?: PanelId
  sourceId?: string
}): SourceConfigSurface {
  const definitions = (input.definitions ?? allSources()).filter((source) => {
    if (input.panelId !== undefined && !source.panels.includes(input.panelId)) return false
    if (input.sourceId !== undefined && source.sourceId !== input.sourceId) return false
    return true
  })
  const facts = definitions.flatMap((definition): SourceConfigFact[] => {
    const profile = input.profileById[definition.sourceId]
    if (profile === undefined) {
      // 没有 profile 的源不进事实表：读不到「读者的选择」时，宁可不出现，也不拿默认值冒充。
      return []
    }
    // **有效启用**：读者存了开、并且这个源真的接进来了（`readiness === 'live'`）才算开。
    // 存量的 `profile.enabled` 原样保留（读者偏好照存），只是投影出来的值不能替未接入的源充数。
    const enabled = profile.enabled === true && (definition.readiness ?? 'live') === 'live'
    const health = input.healthById[definition.sourceId]
    const healthState = sourceHealthState({
      enabled,
      ...(definition.unavailable === undefined ? {} : { unavailable: true }),
      ...(health === undefined ? {} : { health })
    })
    const jobRegistered = input.jobRegisteredById[definition.sourceId]
    const credentialStatus = input.credentialStatusById?.[definition.sourceId]
    return [{
      sourceId: definition.sourceId,
      definition,
      profile,
      enabled,
      ...(health === undefined ? {} : { health }),
      healthState,
      healthMarker: sourceHealthMarker({
        enabled,
        ...(definition.unavailable === undefined ? {} : { unavailable: true }),
        state: healthState
      }),
      ...(jobRegistered === undefined ? {} : { jobRegistered }),
      ...(credentialStatus === undefined ? {} : { credentialStatus })
    }]
  })
  return {
    facts,
    byId: Object.fromEntries(facts.map((fact) => [fact.sourceId, fact])),
    state: {
      enabledById: Object.fromEntries(facts.map((fact) => [fact.sourceId, fact.enabled])),
      healthById: input.healthById,
      jobRegisteredById: input.jobRegisteredById,
      knownSourceIds: new Set(Object.keys(input.profileById))
    }
  }
}

function groupByProvider(sources: SourceView[]): ProviderView[] {
  const providers = new Map<string, Omit<ProviderView, 'healthMarker'>>()
  for (const source of sources) {
    const provider = getProvider(source.providerId)
    if (!provider) continue
    const existing = providers.get(provider.providerId)
    if (existing) {
      existing.sources.push(source)
    } else {
      const credentialSource = provider.sources.find((candidate) => candidate.collection === 'adapter')
      providers.set(provider.providerId, {
        providerId: provider.providerId,
        displayName: provider.displayName,
        category: provider.category,
        credential: provider.credential,
        ...(credentialSource ? { credentialSourceId: credentialSource.sourceId } : {}),
        ...(provider.website ? { website: provider.website } : {}),
        ...(provider.signupUrl ? { signupUrl: provider.signupUrl } : {}),
        ...(provider.invite ? { invite: true } : {}),
        ...(provider.notice ? { notice: provider.notice } : {}),
        sources: [source]
      })
    }
  }
  return [...providers.values()].map((provider) => ({ ...provider, healthMarker: providerHealthMarker(provider.sources) }))
}

function countView(sources: SourceView[]) {
  return {
    total: sources.length,
    enabled: sources.filter((source) => source.enabled).length,
    pending: sources.filter((source) => source.visibility === 'pending').length,
    failed: sources.filter((source) => isFailingHealthState(source.healthState)).length
  }
}

/**
 * The global inventory: every source that is not hidden, plus enabled hidden
 * sources so an active collector can always be found and disabled.
 */
export function settingsView(state: ProjectionState = {}): SettingsView {
  const sources = allSources()
    .filter((source) => source.visibility !== 'hidden' || state.enabledById?.[source.sourceId] === true)
    .map((source) => toView(source, state))

  const groups = categoryOrder
    .map((category) => ({
      category,
      providers: groupByProvider(sources.filter((source) => getProvider(source.providerId)?.category === category))
    }))
    .filter((group) => group.providers.length > 0)

  return { groups, counts: countView(sources) }
}

export function agentView(agentId: AgentId, state: ProjectionState = {}): AgentView | undefined {
  const agent = getAgent(agentId)
  if (!agent) return undefined
  const groups = agent.groups.map((group) => ({
    groupId: group.groupId,
    tier: group.tier,
    sources: group.sourceIds
      .map((sourceId) => allSources().find((source) => source.sourceId === sourceId))
      .filter((source): source is SourceDefinition => Boolean(source))
      .map((source) => toView(source, state))
  }))
  const sources = groups.flatMap((group) => group.sources)
  return {
    agent,
    groups,
    counts: {
      groups: groups.length,
      sources: new Set(sources.map((source) => source.sourceId)).size,
      enabled: sources.filter((source) => source.enabled).length
    }
  }
}

export function panelView(panelId: PanelId, state: ProjectionState = {}): PanelView | undefined {
  const panel = getPanel(panelId)
  if (!panel) return undefined
  const sources = allSources()
    .filter((source) => source.panels.includes(panelId))
    .filter((source) => source.agents.includes(panel.agentId))
    .filter((source) => source.visibility !== 'hidden' || state.enabledById?.[source.sourceId] === true)
    .map((source) => toView(source, state))
  return {
    panel,
    providers: groupByProvider(sources),
    counts: { sources: sources.length, enabled: sources.filter((source) => source.enabled).length },
    ...(panelId === 'economic-calendar'
      ? { calendarOfficialFeeds: officialCalendarFeedsAvailability(sources) }
      : {})
  }
}

export function countAgentGroups(agentId: AgentId): number {
  return getAgent(agentId)?.groups.length ?? 0
}

export function countAgentSources(agentId: AgentId): number {
  return agentView(agentId)?.counts.sources ?? 0
}

export function providerCount(): number {
  return providerRegistry.length
}

export function panelCount(): number {
  return panelRegistry.length
}
