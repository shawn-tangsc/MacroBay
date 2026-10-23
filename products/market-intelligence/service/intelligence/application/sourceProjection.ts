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

export type SourceHealth = 'healthy' | 'degraded' | 'failed' | 'never-run'

export type ProjectionState = {
  enabledById?: Readonly<Record<string, boolean>>
  healthById?: Readonly<Record<string, SourceHealth>>
  jobRegisteredById?: Readonly<Record<string, boolean>>
  /** Sources that already have a profile, including disabled ones. */
  knownSourceIds?: ReadonlySet<string>
}

export type SourceView = SourceDefinition & {
  enabled: boolean
  jobRegistered?: boolean
  health?: SourceHealth
}

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
  sources: SourceView[]
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
}

const categoryOrder: SourceCategory[] = ['macro', 'crypto', 'aggregate', 'system']

function toView(source: SourceDefinition, state: ProjectionState): SourceView {
  return {
    ...source,
    enabled: state.enabledById?.[source.sourceId] === true,
    ...(state.jobRegisteredById?.[source.sourceId] !== undefined ? { jobRegistered: state.jobRegisteredById[source.sourceId] } : {}),
    ...(state.healthById?.[source.sourceId] ? { health: state.healthById[source.sourceId] } : {})
  }
}

function groupByProvider(sources: SourceView[]): ProviderView[] {
  const providers = new Map<string, ProviderView>()
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
        sources: [source]
      })
    }
  }
  return [...providers.values()]
}

function countView(sources: SourceView[]) {
  return {
    total: sources.length,
    enabled: sources.filter((source) => source.enabled).length,
    pending: sources.filter((source) => source.visibility === 'pending').length,
    failed: sources.filter((source) => source.health === 'failed').length
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
    counts: { sources: sources.length, enabled: sources.filter((source) => source.enabled).length }
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
