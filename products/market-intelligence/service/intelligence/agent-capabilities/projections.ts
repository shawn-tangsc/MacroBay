import { agentRegistry, getSource } from '../application/providerRegistry'
import type {
  IntelligenceDesiredRuntimeState,
  IntelligenceSourceConfig,
  IntelligenceSourceDefinition,
  IntelligenceSourceProfile
} from '../schema/intelligenceSource'
import type {
  SafeIntelligenceSourceHealthView,
  SafeSourceScheduleRule
} from '../schema/intelligenceSourcesContracts'
import type { IntelligenceTimelineRow } from '../application/intelligenceWorkspaceQueries'

export type SourceDomain = 'dashboard' | 'calendar'

export type SourceTier = 'required' | 'recommended' | 'optional'

export type ProjectedCredentialStatus = {
  hasCredential: boolean
  lastValidatedAt?: string
}

export type ProjectedSourceSummary = {
  sourceId: string
  name: string
  provider: string
  category: string
  visibility: string
  tier?: SourceTier
  domains: SourceDomain[]
  enabled: boolean
  collectionPreset: IntelligenceSourceProfile['collectionPreset']
  includeInSentiment: boolean
  scopePolicy: IntelligenceSourceProfile['scopePolicy']
  retentionMode: IntelligenceSourceProfile['retentionMode']
  rawArchiveEnabled: boolean
  autoReplayAfterParserUpgrade: boolean
  monitoredSymbols?: string[]
  credentialStatus: ProjectedCredentialStatus
}

/** Only the health fields the agent may reason about; run internals stay out. */
export type ProjectedSourceHealth = {
  runtimeStatus: SafeIntelligenceSourceHealthView['runtimeStatus']
  connectivityStatus: SafeIntelligenceSourceHealthView['connectivityStatus']
  lastSuccessAt?: string
  lastFailureAt?: string
  consecutiveFailures: number
  collectionGap?: boolean
}

export type ProjectedSourceSchedule =
  | Readonly<{ mode: 'manual' }>
  | Readonly<{ mode: 'interval'; intervalSeconds: number }>

/** Runtime settings that explain when the source runs, without adapter internals. */
export type ProjectedSourceRuntime = {
  desiredState: IntelligenceDesiredRuntimeState
  pollingIntervalSec?: number
  schedule: ProjectedSourceSchedule
}

export type ProjectedSourceDetail = ProjectedSourceSummary & {
  definition: {
    description: string
    authMode: IntelligenceSourceDefinition['authMode']
    requiredFields: string[]
  }
  health: ProjectedSourceHealth
  runtime: ProjectedSourceRuntime
}

type SourceDefinitionProjection = Pick<
  IntelligenceSourceDefinition,
  'displayName' | 'sourceGroup' | 'category' | 'visibility' | 'authMode' | 'sourceSpecificFields' | 'readinessNote'
>

export type SourceDetailProjectionInput = {
  definition: SourceDefinitionProjection & {
    displayName: string
    sourceGroup: string
    category: string
    visibility: string
    authMode: IntelligenceSourceDefinition['authMode']
    sourceSpecificFields: string[]
    readinessNote?: string
  }
  profile: IntelligenceSourceProfile
  health: ProjectedSourceHealth
  runtimeConfig: Pick<IntelligenceSourceConfig, 'desiredRuntimeState' | 'pollingIntervalSec'>
  scheduleRule?: SafeSourceScheduleRule
  credentialStatus?: Readonly<{ hasCredential: boolean; lastValidatedAt?: string }>
}

/**
 * The panel a source belongs to, not the product-level domain: the settings page groups sources by
 * the dashboard / economic-calendar panes they appear in.
 */
export function sourceDomains(sourceId: string): SourceDomain[] {
  const source = getSource(sourceId)
  if (!source) return []
  return source.panels.map((panel) => (panel === 'economic-calendar' ? 'calendar' : 'dashboard'))
}

export function sourceTier(sourceId: string): SourceTier | undefined {
  for (const agent of agentRegistry) {
    for (const group of agent.groups) {
      if (group.sourceIds.includes(sourceId)) return group.tier
    }
  }
  return undefined
}

/** Credential status leaves the product as a boolean plus the last validation time, never a value. */
export function projectCredentialStatus(
  status: Readonly<{ hasCredential: boolean; lastValidatedAt?: string }> | undefined
): ProjectedCredentialStatus {
  if (!status) return { hasCredential: false }
  return {
    hasCredential: status.hasCredential === true,
    ...(status.lastValidatedAt ? { lastValidatedAt: status.lastValidatedAt } : {})
  }
}

/**
 * Whitelist projection for `IntelligenceSourceProfile` (design 152 §9). `profileId`,
 * `credentialRef`, `sourceSpecificConfigJson` and `maskedPreview` have no path through here.
 */
export function projectSourceSummary(input: {
  profile: IntelligenceSourceProfile
  definition: SourceDefinitionProjection
  credentialStatus?: ProjectedCredentialStatus
}): ProjectedSourceSummary {
  const { profile, definition } = input
  const registrySource = getSource(profile.sourceId)
  const tier = sourceTier(profile.sourceId)
  return {
    sourceId: profile.sourceId,
    name: definition.displayName,
    provider: registrySource?.providerId ?? definition.sourceGroup,
    category: definition.category,
    visibility: registrySource?.visibility ?? definition.visibility,
    ...(tier ? { tier } : {}),
    domains: sourceDomains(profile.sourceId),
    enabled: profile.enabled === true,
    collectionPreset: profile.collectionPreset,
    includeInSentiment: profile.includeInSentiment === true,
    scopePolicy: profile.scopePolicy,
    retentionMode: profile.retentionMode,
    rawArchiveEnabled: profile.rawArchiveEnabled === true,
    autoReplayAfterParserUpgrade: profile.autoReplayAfterParserUpgrade === true,
    ...(profile.monitoredSymbols && profile.monitoredSymbols.length > 0
      ? { monitoredSymbols: [...profile.monitoredSymbols] }
      : {}),
    credentialStatus: input.credentialStatus ?? {
      hasCredential: Boolean(profile.credentialRef)
    }
  }
}

/** `getDetail` returns the full profile; the agent only ever receives this projection. */
export function projectSourceDetail(detail: SourceDetailProjectionInput): ProjectedSourceDetail {
  const summary = projectSourceSummary({
    profile: detail.profile,
    definition: detail.definition,
    credentialStatus: projectCredentialStatus(detail.credentialStatus)
  })
  return {
    ...summary,
    definition: {
      description: detail.definition.readinessNote ?? detail.definition.displayName,
      authMode: detail.definition.authMode,
      requiredFields: [...detail.definition.sourceSpecificFields]
    },
    health: projectSourceHealth(detail.health),
    runtime: projectSourceRuntime(detail)
  }
}

/** Keeps the six agent-safe health fields; worker and run internals are dropped. */
function projectSourceHealth(health: ProjectedSourceHealth): ProjectedSourceHealth {
  return {
    runtimeStatus: health.runtimeStatus,
    connectivityStatus: health.connectivityStatus,
    ...(typeof health.lastSuccessAt === 'string' ? { lastSuccessAt: health.lastSuccessAt } : {}),
    ...(typeof health.lastFailureAt === 'string' ? { lastFailureAt: health.lastFailureAt } : {}),
    consecutiveFailures: health.consecutiveFailures,
    ...(typeof health.collectionGap === 'boolean' ? { collectionGap: health.collectionGap } : {})
  }
}

function projectSourceRuntime(input: {
  runtimeConfig: Pick<IntelligenceSourceConfig, 'desiredRuntimeState' | 'pollingIntervalSec'>
  scheduleRule?: SafeSourceScheduleRule
}): ProjectedSourceRuntime {
  return {
    desiredState: input.runtimeConfig.desiredRuntimeState,
    ...(typeof input.runtimeConfig.pollingIntervalSec === 'number'
      ? { pollingIntervalSec: input.runtimeConfig.pollingIntervalSec }
      : {}),
    schedule: resolveSchedule(input)
  }
}

function resolveSchedule(input: {
  runtimeConfig: Pick<IntelligenceSourceConfig, 'pollingIntervalSec'>
  scheduleRule?: SafeSourceScheduleRule
}): ProjectedSourceSchedule {
  if (input.scheduleRule?.mode === 'manual') return { mode: 'manual' }
  const intervalSeconds =
    input.scheduleRule?.mode === 'interval'
      ? input.scheduleRule.intervalSeconds
      : input.runtimeConfig.pollingIntervalSec
  if (typeof intervalSeconds !== 'number' || !Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
    return { mode: 'manual' }
  }
  return { mode: 'interval', intervalSeconds }
}

/**
 * Timeline rows are already the user-facing workspace contract. Drop only the internal row key,
 * the raw matching structure (which carries watchlist/position inputs), and the aggregate cluster
 * identifier; the item id stays so `get_evidence_excerpt` remains callable.
 */
export function projectTimelineRow(row: IntelligenceTimelineRow): Omit<
  IntelligenceTimelineRow,
  'rowId' | 'clusterId' | 'match'
> {
  const { rowId: _rowId, clusterId: _clusterId, match: _match, ...visible } = row
  return visible
}
