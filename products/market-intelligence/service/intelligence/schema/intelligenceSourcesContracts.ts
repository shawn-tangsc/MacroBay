import type {
  IntelligenceSourceConfig,
  IntelligenceSourceDefinition,
  IntelligenceSourceProfile
} from '../schema/intelligenceSource'

export type SafeIntelligenceSourceDefinition = Omit<IntelligenceSourceDefinition, 'requestGovernance'>
import type { IntelligenceFocusMarketSettings } from '../application/intelligenceFocusSettings'
import type { IntelligencePipelineHealth } from '../application/intelligencePipeline'

export type SafeVisibleRequestBudget = Readonly<{ maxRequests: number; windowSeconds: number }>

export const DASHBOARD_SOURCE_CONNECTION_IPC_METHOD = 'intelligence.dashboardSourceConnection.test' as const

export const dashboardSourceSurfacePolicy = {
  connectionProbeSourceIds: ['alternative-fear-greed', 'binance-futures-positioning', 'defillama-stablecoins'],
  scheduleProjectionSourceIds: ['alternative-fear-greed', 'binance-futures-positioning', 'defillama-stablecoins']
} as const

export type SafeSourceScheduleRule =
  | Readonly<{ mode: 'manual' }>
  | Readonly<{
      mode: 'interval'
      intervalSeconds: number
      anchor: 'last-complete'
      initialRunOnEnable: true
    }>

export type IntelligenceConnectivityStatus =
  | 'unverified'
  | 'connected'
  | 'degraded'
  | 'failed'
  | 'paused'

export type SafeIntelligenceSourceHealthView = {
  sourceId: string
  runtimeStatus: 'healthy' | 'degraded' | 'failed' | 'paused'
  connectivityStatus: IntelligenceConnectivityStatus
  workerStatus?: 'stopped' | 'starting' | 'live' | 'degraded' | 'reconnecting' | 'stopping' | 'failed'
  lastSuccessAt?: string
  lastFailureAt?: string
  consecutiveFailures: number
  lastRunSummary?: string
  checkpointPreview?: string
  parserVersion?: string
  lastPublishedAt?: string
  cursor?: string
  supportsHistoricalBackfill?: boolean
  collectionGap?: boolean
}

export type SafeIntelligenceSourceDetailView = {
  definition: SafeIntelligenceSourceDefinition
  profile: IntelligenceSourceProfile
  runtimeConfig: IntelligenceSourceConfig
  scheduleRule?: SafeSourceScheduleRule
  requestBudget?: SafeVisibleRequestBudget
  health: SafeIntelligenceSourceHealthView
  credentialStatus?: {
    hasCredential: boolean
    maskedPreview?: string
    lastValidatedAt?: string
  }
}

export type SafeIntelligenceSourcesPageState = {
  definitions: SafeIntelligenceSourceDefinition[]
  selectedSourceId?: string
  detail?: SafeIntelligenceSourceDetailView
  sourceHealthById?: Record<string, SafeIntelligenceSourceHealthView>
  focusMarketSettings: IntelligenceFocusMarketSettings
}

export type SaveIntelligenceSourceProfileInput = Partial<
  Omit<IntelligenceSourceProfile, 'profileId' | 'sourceId' | 'updatedAt'>
> & {
  sourceId: string
}

export type SaveIntelligenceFocusMarketSettingsInput = {
  enabledFocusMarkets: IntelligenceFocusMarketSettings['enabledFocusMarkets']
}

export type SafeRunNowResult = {
  sourceId: string
  action: 'queued-job' | 'restarted-worker'
  queuedAt: string
}

export type SafeReplayWindowResult = {
  sourceId: string
  queuedAt: string
  summary: string
}

export type SafeCredentialTestResult = {
  sourceId: string
  ok: boolean
  message: string
  testedAt: string
}

export type SafeConnectionTestResult = SafeCredentialTestResult

/**
 * The state family every credentialed provider registered in the product's probe registry answers
 * with: a stored-but-unverified key, or a typed refusal. 0xRouter's narrower types below stay valid
 * members of it, so no existing assertion had to be widened.
 */
export type SafeCredentialSaveResult =
  | Readonly<{ sourceId: string; state: 'unverified' }>
  | Readonly<{ sourceId: string; state: 'failed'; failureCode: SafeCredentialProviderFailureCode }>

export type SafeCredentialProviderFailureCode =
  | 'credential-invalid'
  | 'credential-not-configured'
  | 'authentication-failed'
  | 'plan-restricted'
  | 'rate-limited'
  | 'transport-unavailable'
  | 'request-timeout'
  | 'response-unavailable'

export type SafeCredentialProviderConnectionResult =
  | Readonly<{ sourceId: string; state: 'succeeded' }>
  | Readonly<{ sourceId: string; state: 'failed'; failureCode: SafeCredentialProviderFailureCode }>

export type SafeZeroXRouterCredentialSaveResult =
  | Readonly<{ sourceId: '0xrouter-aggregate-provider'; state: 'unverified' }>
  | Readonly<{ sourceId: '0xrouter-aggregate-provider'; state: 'failed'; failureCode: 'credential-invalid' }>

export type SafeZeroXRouterConnectionResult =
  | Readonly<{ sourceId: '0xrouter-aggregate-provider'; state: 'succeeded' }>
  | Readonly<{
      sourceId: '0xrouter-aggregate-provider'
      state: 'failed'
      failureCode: 'credential-not-configured' | 'transport-unavailable' | 'request-timeout' | 'response-unavailable' | 'authentication-failed'
    }>

export type IntelligenceSourceFreshnessStatus =
  | 'healthy'
  | 'degraded'
  | 'failed'
  | 'paused'
  | 'pending'

export function resolveSourceFreshnessStatus(
  enabled: boolean,
  health: IntelligencePipelineHealth | undefined
): IntelligenceSourceFreshnessStatus {
  if (!enabled) return 'paused'

  const lastFailureMs = health?.lastFailureAt ? Date.parse(health.lastFailureAt) : Number.NaN
  const lastSuccessMs = health?.lastSuccessAt ? Date.parse(health.lastSuccessAt) : Number.NaN
  const latestFailure =
    Number.isFinite(lastFailureMs) && (!Number.isFinite(lastSuccessMs) || lastFailureMs >= lastSuccessMs)

  if (!Number.isFinite(lastSuccessMs)) {
    return latestFailure ? 'failed' : 'pending'
  }

  if (latestFailure || health?.runtimeStatus === 'failed') return 'failed'
  if ((health?.consecutiveFailures ?? 0) > 0 || health?.runtimeStatus === 'degraded') return 'degraded'
  return 'healthy'
}

export function resolveConnectivityStatus(
  health: Omit<SafeIntelligenceSourceHealthView, 'connectivityStatus'>,
  enabled: boolean
): IntelligenceConnectivityStatus {
  const lastFailureMs = health.lastFailureAt ? Date.parse(health.lastFailureAt) : Number.NaN
  const lastSuccessMs = health.lastSuccessAt ? Date.parse(health.lastSuccessAt) : Number.NaN
  const latestFailure =
    Number.isFinite(lastFailureMs) && (!Number.isFinite(lastSuccessMs) || lastFailureMs >= lastSuccessMs)

  if (!enabled) {
    if (latestFailure) return 'failed'
    if (Number.isFinite(lastSuccessMs)) return 'connected'
    return 'paused'
  }

  if (health.runtimeStatus === 'failed' || latestFailure) return 'failed'
  if (health.runtimeStatus === 'degraded') return 'degraded'
  if (health.runtimeStatus === 'healthy' || Number.isFinite(lastSuccessMs)) return 'connected'
  return 'unverified'
}

export function toSafeHealthView(
  sourceId: string,
  health: IntelligencePipelineHealth | undefined,
  enabled: boolean
): SafeIntelligenceSourceHealthView {
  const base = {
    sourceId,
    runtimeStatus: health?.runtimeStatus ?? 'healthy',
    lastSuccessAt: health?.lastSuccessAt,
    lastFailureAt: health?.lastFailureAt,
    consecutiveFailures: health?.consecutiveFailures ?? 0,
    lastRunSummary: health?.lastRunSummary,
    checkpointPreview: health?.checkpointPreview ?? health?.lastRunSummary,
    parserVersion: health?.parserVersion,
    lastPublishedAt: health?.lastPublishedAt,
    cursor: health?.cursor,
    supportsHistoricalBackfill: health?.supportsHistoricalBackfill,
    collectionGap: health?.collectionGap
  } satisfies Omit<SafeIntelligenceSourceHealthView, 'connectivityStatus'>

  const normalized = {
    ...base,
    runtimeStatus: enabled ? base.runtimeStatus : ('paused' as const)
  }

  return {
    ...normalized,
    connectivityStatus: resolveConnectivityStatus(normalized, enabled)
  }
}

export function sanitizeSafeView<T extends Record<string, unknown>>(value: T): T {
  assertSafeValue(value)
  return value
}

function assertSafeValue(value: unknown): void {
  if (typeof value === 'string') {
    if (/apiKey=|apiSecret=|authorization=|payloadBody/i.test(value)) {
      throw new Error('Unsafe intelligence view contained secret-like content.')
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach(assertSafeValue)
    return
  }

  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      assertSafeValue(nested)
    }
  }
}
