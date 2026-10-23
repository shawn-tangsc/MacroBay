import type {
  IntelligenceCollectionPreset,
  IntelligenceRuntimeValidationIssue,
  IntelligenceSourceAdapterType,
  IntelligenceSourceConfig,
  IntelligenceSourceDefinition,
  IntelligenceSourceProfile
} from '../schema/intelligenceSource'
import { sourceRequiresCredential } from '../schema/intelligenceSource'
import { isMacroSourceId } from './macroSourceCatalogMetadata'
import { isDefillamaStablecoinRetiredPath } from './sourceCatalog'
import { isZeroXRouterSource, zeroXRouterEtfRefreshSchedulePolicy } from './zeroXRouterSourcePolicy'
import { dashboardSourceSurfacePolicy, type SafeSourceScheduleRule } from '../schema/intelligenceSourcesContracts'

export type ResolveRuntimeConfigInput = {
  definition: IntelligenceSourceDefinition
  profile?: IntelligenceSourceProfile
  hasCredential?: boolean
}

const POLLING_INTERVAL_SEC: Record<
  IntelligenceSourceAdapterType,
  Record<IntelligenceCollectionPreset, number | undefined>
> = {
  'html-page-poller': { manual: undefined, balanced: 30 * 60, frequent: 10 * 60 },
  'rss-poller': { manual: undefined, balanced: 15 * 60, frequent: 5 * 60 },
  'rest-api-poller': { manual: undefined, balanced: 10 * 60, frequent: 3 * 60 },
  'statuspage-poller': { manual: undefined, balanced: 2 * 60, frequent: 60 },
  'websocket-stream-consumer': { manual: undefined, balanced: undefined, frequent: undefined }
}

export const dashboardSourceSchedulePolicy = {
  sourceIds: dashboardSourceSurfacePolicy.scheduleProjectionSourceIds,
  adapterType: 'rest-api-poller',
  anchor: 'last-complete' as const,
  initialRunOnEnable: true as const
} as const

const MACRO_POLLING_INTERVAL_SEC: Record<IntelligenceCollectionPreset, number | undefined> = {
  manual: undefined,
  balanced: 6 * 60 * 60,
  frequent: 2 * 60 * 60
}

export function createDefaultSourceProfile(
  definition: IntelligenceSourceDefinition,
  now = new Date().toISOString()
): IntelligenceSourceProfile {
  return {
    profileId: `${definition.sourceId}-profile`,
    sourceId: definition.sourceId,
    enabled: false,
    collectionPreset: definition.defaultCollectionPreset,
    includeInSentiment: definition.supportsSentiment,
    scopePolicy: definition.defaultScopePolicy,
    rawArchiveEnabled: true,
    retentionMode: definition.defaultRetentionMode,
    autoReplayAfterParserUpgrade: true,
    updatedAt: now
  }
}

export function isPlannedIntelligenceSource(definition: IntelligenceSourceDefinition): boolean {
  return definition.readiness === 'planned'
}

export function isFixtureReadyIntelligenceSource(definition: IntelligenceSourceDefinition): boolean {
  return definition.readiness === 'fixture-ready'
}

export function blocksProductionCollection(definition: IntelligenceSourceDefinition): boolean {
  return isPlannedIntelligenceSource(definition) || isFixtureReadyIntelligenceSource(definition)
}

/**
 * True when a product job or runtime collects this source instead of the generic adapter runtime.
 *
 * Such a source may keep the reader's enable preference on its profile even while it is `planned`
 * (the dedicated runtime reads `resolveProfile(sourceId).enabled`), but `resolveRuntimeConfig` still
 * forces `enabled: false`, so the generic runtime never schedules an adapter it does not have.
 */
export function hasProductOwnedCollection(definition: IntelligenceSourceDefinition): boolean {
  return definition.collectionOwner === 'product'
}

export function resolveRuntimeConfig(input: ResolveRuntimeConfigInput): IntelligenceSourceConfig {
  const profile = input.profile ?? createDefaultSourceProfile(input.definition)
  const hasCredential = input.hasCredential ?? Boolean(profile.credentialRef)
  const usesFixedEtfRefreshSchedule = isZeroXRouterSource(input.definition.sourceId) && profile.enabled && hasCredential
  const collectionPreset = usesFixedEtfRefreshSchedule
    ? zeroXRouterEtfRefreshSchedulePolicy.collectionPreset
    : profile.collectionPreset ?? input.definition.defaultCollectionPreset
  const includeInSentiment = input.definition.supportsSentiment ? profile.includeInSentiment : false
  const enabled = blocksProductionCollection(input.definition) ? false : profile.enabled
  const isStream = input.definition.executionMode === 'websocket'
  const isCapitalConditionsCollector = isDefillamaStablecoinRetiredPath(input.definition.sourceId)

  const pollingIntervalSec = isStream
    ? undefined
    : isMacroSourceId(input.definition.sourceId)
      ? MACRO_POLLING_INTERVAL_SEC[collectionPreset]
      : usesFixedEtfRefreshSchedule
        ? zeroXRouterEtfRefreshSchedulePolicy.intervalSeconds
        : POLLING_INTERVAL_SEC[input.definition.adapterType][collectionPreset]

  const desiredRuntimeState = !enabled ? 'paused' : isStream ? 'live' : 'polling'

  return {
    sourceId: input.definition.sourceId,
    sourceName: input.definition.displayName,
    sourceGroup: input.definition.sourceGroup,
    adapterType: input.definition.adapterType,
    executionMode: input.definition.executionMode,
    enabled,
    credentialRef: profile.credentialRef,
    category: input.definition.category,
    trustLevel: input.definition.trustLevel,
    language: input.definition.language,
    collectionPreset,
    pollingIntervalSec,
    desiredRuntimeState,
    parserStrategy: input.definition.parserStrategy,
    noisePolicy: 'balanced',
    includeInSentiment,
    scopePolicy: profile.scopePolicy,
    rawArchiveEnabled: isCapitalConditionsCollector ? false : profile.rawArchiveEnabled,
    retentionMode: profile.retentionMode,
    autoReplayAfterParserUpgrade: isCapitalConditionsCollector ? false : profile.autoReplayAfterParserUpgrade,
    sentimentEligible: includeInSentiment,
    adapterConfig: resolveAdapterConfig(input.definition, profile)
  }
}

const METRIC_SYMBOL_SOURCE_IDS = new Set(['binance-spot-market', 'binance-futures-positioning'])

function resolveAdapterConfig(
  definition: IntelligenceSourceDefinition,
  profile: IntelligenceSourceProfile
): Record<string, unknown> {
  const adapterConfig = { ...definition.adapterConfig }
  if (!METRIC_SYMBOL_SOURCE_IDS.has(definition.sourceId)) {
    return adapterConfig
  }

  const configuredSymbols = resolveMonitoredSymbols(profile, adapterConfig)
  return {
    ...adapterConfig,
    symbolParam: adapterConfig.symbolParam ?? 'symbol',
    symbols: configuredSymbols
  }
}

export function resolveMonitoredSymbols(
  profile: IntelligenceSourceProfile,
  adapterConfig: Record<string, unknown>
): string[] {
  const fromProfile = (profile.monitoredSymbols ?? [])
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
  const fromAdapter = Array.isArray(adapterConfig.symbols)
    ? adapterConfig.symbols.map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean)
    : []
  const fallback = adapterConfig.symbol ? [String(adapterConfig.symbol).trim().toUpperCase()] : []
  return [...new Set([...fromProfile, ...fromAdapter, ...fallback])].slice(0, 20)
}

/** Converts the existing runtime preset policy into the compact Drawer-safe rule. */
export function resolveSafeDashboardSourceScheduleRule(input: unknown): SafeSourceScheduleRule | undefined {
  const sourcePreset = readDashboardSourceScheduleInput(input)
  if (!sourcePreset) return undefined
  if (sourcePreset.collectionPreset === 'manual') return Object.freeze({ mode: 'manual' })
  const intervalSeconds = POLLING_INTERVAL_SEC[dashboardSourceSchedulePolicy.adapterType][sourcePreset.collectionPreset]
  return typeof intervalSeconds === 'number'
    ? Object.freeze({
        mode: 'interval',
        intervalSeconds,
        anchor: dashboardSourceSchedulePolicy.anchor,
        initialRunOnEnable: dashboardSourceSchedulePolicy.initialRunOnEnable
      })
    : undefined
}

export function validateRuntimeConfig(
  definition: IntelligenceSourceDefinition,
  config: IntelligenceSourceConfig,
  hasCredential = Boolean(config.credentialRef),
  profileEnabled = config.enabled
): IntelligenceRuntimeValidationIssue[] {
  const issues: IntelligenceRuntimeValidationIssue[] = []

  if (blocksProductionCollection(definition) && profileEnabled) {
    issues.push({
      code: 'source-not-ready',
      field: 'enabled',
      message: isFixtureReadyIntelligenceSource(definition)
        ? 'This source is fixture-ready only. Use replay to validate; production collection is disabled.'
        : 'This source is not ready for collection yet.'
    })
  }

  if (!config.enabled) return issues

  if (sourceRequiresCredential(definition.authMode) && !hasCredential) {
    issues.push({
      code: 'missing-credential',
      field: 'credentialRef',
      message: 'An API credential is required before this source can run.'
    })
  }

  if (!definition.supportsSentiment && config.includeInSentiment) {
    issues.push({
      code: 'unsupported-sentiment',
      field: 'includeInSentiment',
      message: 'This source does not support sentiment inclusion.'
    })
  }

  return issues
}

export function resolveAndValidateRuntimeConfig(input: ResolveRuntimeConfigInput): {
  config: IntelligenceSourceConfig
  issues: IntelligenceRuntimeValidationIssue[]
} {
  const profile = input.profile ?? createDefaultSourceProfile(input.definition)
  const config = resolveRuntimeConfig(input)
  const issues = validateRuntimeConfig(
    input.definition,
    config,
    input.hasCredential ?? Boolean(input.profile?.credentialRef),
    profile.enabled
  )
  return { config, issues }
}

function readDashboardSourceScheduleInput(value: unknown): { sourceId: typeof dashboardSourceSchedulePolicy.sourceIds[number]; collectionPreset: IntelligenceCollectionPreset } | undefined {
  if (!isExactDataRecord(value, ['sourceId', 'collectionPreset'])) return undefined
  const sourceId = Object.getOwnPropertyDescriptor(value, 'sourceId')?.value
  const collectionPreset = Object.getOwnPropertyDescriptor(value, 'collectionPreset')?.value
  return isDashboardSourceId(sourceId) && isCollectionPreset(collectionPreset)
    ? { sourceId, collectionPreset }
    : undefined
}

function isDashboardSourceId(value: unknown): value is typeof dashboardSourceSchedulePolicy.sourceIds[number] {
  return typeof value === 'string' && dashboardSourceSchedulePolicy.sourceIds.includes(value as typeof dashboardSourceSchedulePolicy.sourceIds[number])
}

function isCollectionPreset(value: unknown): value is IntelligenceCollectionPreset {
  return value === 'manual' || value === 'balanced' || value === 'frequent'
}

function isExactDataRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== fields.length || !fields.every((field) => Object.hasOwn(value, field)) || Object.getOwnPropertySymbols(value).length !== 0) return false
    if (!names.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return Boolean(descriptor && 'value' in descriptor)
    })) return false
    structuredClone(value)
    return true
  } catch {
    return false
  }
}
