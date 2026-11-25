import {
  officialCalendarFeedsAvailability,
  type CalendarOfficialFeedsAvailability
} from './officialCalendarAvailability'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import type { MarketCalendarWriteFailureView } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { SourceStaleMeasurements } from './pipelineHealth'
import type { SourceStaleReason } from './sourceStaleness'
import type {
  AgentView,
  PanelView,
  ProjectionState,
  ProviderView,
  SettingsView,
  SourceHealthMarker,
  SourceHealthState,
  SourceView
} from './sourceViewTypes'
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

/*
 * 视图与状态的类型搬到 `sourceViewTypes.ts`（只搬类型，判据一条没动），这里原样再导出：
 * 调用方仍从 `sourceProjection` 拿全部类型，不因为搬家改 import。
 */
export type {
  AgentGroupView,
  AgentView,
  CategoryGroupView,
  PanelView,
  ProjectionState,
  ProviderView,
  SettingsView,
  SourceHealthMarker,
  SourceHealthState,
  SourceView
} from './sourceViewTypes'

/**
 * 一个源此刻的健康读数（管线投影出来的那几项）。**只作为派生五态的输入**，不直接上界面：
 * 界面读 `SourceView.healthState`，不要再自己拿 `runtimeStatus`/`consecutiveFailures` 判一遍。
 */
export type SourceHealthFact = Readonly<{
  runtimeStatus: 'healthy' | 'degraded' | 'failed' | 'paused'
  consecutiveFailures: number
}>


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


const categoryOrder: SourceCategory[] = ['macro', 'crypto', 'aggregate', 'system']

function toView(source: SourceDefinition, state: ProjectionState): SourceView {
  const enabled = state.enabledById?.[source.sourceId] === true
  const health = state.healthById?.[source.sourceId]
  const healthState = sourceHealthState({
    enabled,
    ...(source.unavailable === undefined ? {} : { unavailable: true }),
    ...(health === undefined ? {} : { health })
  })
  const writeFailure = state.writeFailureById?.[source.sourceId]
  const writeFailureState = state.writeFailureStateById?.[source.sourceId]
  const stale = state.staleById?.[source.sourceId]
  /* 采集节奏归谁：**目录和注册表两条都要读**。
     - 目录声明 `collectionOwner: 'product'` → 产品自己的作业采；
     - 注册表的 `collection` 是运行时事实：`'job'` = 产品作业采（0xRouter 那三条日历 feed）、
       `'none'` = 通用适配器不采。这两种都没有任何读取点读 profile 的 `collectionPreset`；
     - 官方日历源（`kind: 'official-calendar'`）**没有目录条目**（registry-only 的 feed），
       节奏由产品自己的日历作业决定（`macroCalendarScheduleBackend`）。
     只信目录会漏掉 registry-only 的 feed——界面就画出一个「选完弹回、什么都没发生」的下拉
     （读者 2026-11-12 与 2026-11-13 两次复报）。 */
  const catalogOwner = getIntelligenceSourceDefinition(source.sourceId)?.collectionOwner
  const productOwnedCollection = catalogOwner === 'product'
    || source.collection === 'job'
    || source.collection === 'none'
    || source.kind === 'official-calendar'
  const collectionOwner = productOwnedCollection ? 'product' as const : catalogOwner
  return {
    ...source,
    ...(collectionOwner === 'product' ? { collectionOwner: 'product' as const } : {}),
    enabled,
    healthState,
    ...(writeFailure === undefined ? {} : { writeFailure }),
    ...(writeFailureState === undefined ? {} : { writeFailureState }),
    ...(stale?.staleReasons === undefined ? {} : { staleReasons: stale.staleReasons }),
    ...(stale?.staleMeasurements === undefined ? {} : { staleMeasurements: stale.staleMeasurements }),
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
  /** 源 id → 标准表写库失败；不给就不出现这个字段（见 `SourceView.writeFailure`）。 */
  writeFailureById?: Readonly<Record<string, MarketCalendarWriteFailureView>>
  writeFailureStateById?: Readonly<Record<string, 'never-written' | 'unreadable'>>
  /** 源 id → 采集产出状态；不给就不出现这两个字段（见 `SourceView.staleReasons`）。 */
  staleById?: ProjectionState['staleById']
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
      knownSourceIds: new Set(Object.keys(input.profileById)),
      ...(input.writeFailureById === undefined ? {} : { writeFailureById: input.writeFailureById }),
      ...(input.writeFailureStateById === undefined ? {} : { writeFailureStateById: input.writeFailureStateById }),
      ...(input.staleById === undefined ? {} : { staleById: input.staleById })
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
      /* An explicitly named anchor wins; otherwise keep the old derivation (the first source an
       adapter collects), so every provider that does not state one behaves exactly as before. */
    const credentialSource = (provider.credentialSourceId === undefined
      ? undefined
      : provider.sources.find((candidate) => candidate.sourceId === provider.credentialSourceId))
      ?? provider.sources.find((candidate) => candidate.collection === 'adapter')
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
        ...(provider.credentialStateLine === undefined ? {} : { credentialStateLine: provider.credentialStateLine }),
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
