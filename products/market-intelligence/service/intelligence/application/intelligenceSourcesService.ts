import type { JobRuntime, ManagedWorkerRuntime } from '@platform/jobs'

import { listIntelligenceSourceDefinitions, getIntelligenceSourceDefinition } from './sourceCatalog'
import { agentView, panelView, settingsView, type AgentView, type PanelView, type SettingsView } from './sourceProjection'
import { allSources, type AgentId, type PanelId } from './providerRegistry'
import { needsSourceJob, sourceJobIds } from './sourceJobRegistration'
import { getIntelligenceAdapter } from '../adapters/adapterRegistry'
import type { IntelligencePipeline } from './intelligencePipeline'
import {
  blocksProductionCollection,
  createDefaultSourceProfile,
  hasProductOwnedCollection,
  resolveAndValidateRuntimeConfig,
  resolveRuntimeConfig,
  resolveSafeDashboardSourceScheduleRule
} from './sourceRuntimeConfig'
import {
  sourceSupportsCredentials,
  type IntelligenceRuntimeValidationIssue,
  type IntelligenceSourceConfig,
  type IntelligenceSourceProfile
} from '../schema/intelligenceSource'
import { createSourceProfileStore, type SourceProfileStore } from './sourceProfileStore'
import { probeIntelligenceSourceConnection } from './intelligenceSourceConnectivity'
import { createSourceRuntimeOrchestrator } from './sourceRuntimeOrchestrator'
import type { IntelligenceReplayService } from './intelligenceReplayService'
import { validateIntelligenceCredential } from './intelligenceCredentialValidation'
import { isZeroXRouterSource } from './zeroXRouterSourcePolicy'
import { createCredentialedProviderProbes } from './credentialedProviderProbes'
import { createSourceRequestGovernanceQueue } from './sourceRequestGovernance'
import type { SourceRequestGovernancePolicy } from '../schema/intelligenceSource'
import type {
  SafeConnectionTestResult,
  SafeCredentialProviderConnectionResult,
  SafeCredentialSaveResult,
  SafeCredentialTestResult,
  SafeIntelligenceSourceDetailView,
  SafeIntelligenceSourceDefinition,
  SafeIntelligenceSourcesPageState,
  SafeReplayWindowResult,
  SafeRunNowResult,
  SafeIntelligenceSourceHealthView,
  SaveIntelligenceFocusMarketSettingsInput,
  SaveIntelligenceSourceProfileInput
} from '../schema/intelligenceSourcesContracts'
import { resolveConnectivityStatus, sanitizeSafeView, toSafeHealthView } from '../schema/intelligenceSourcesContracts'
import {
  createInMemoryIntelligenceCredentialStorage,
  createIntelligenceCredentialStore,
  defaultIntelligenceCredentialRef,
  type IntelligenceCredentialStore
} from '../store/intelligenceCredentialStore'
import type { IntelligenceFocusSettingsStore } from './intelligenceFocusSettingsStore'
import { createDefaultFocusMarketSettings, type IntelligenceFocusMarketSettings } from './intelligenceFocusSettings'

const dashboardScheduleProfilePolicy = {
  requiredFields: [
    'profileId', 'sourceId', 'enabled', 'collectionPreset', 'includeInSentiment', 'scopePolicy',
    'rawArchiveEnabled', 'retentionMode', 'autoReplayAfterParserUpgrade', 'updatedAt'
  ],
  optionalFields: ['credentialRef', 'monitoredSymbols', 'sourceSpecificConfigJson'],
  scopePolicies: ['all', 'watchlist-priority', 'active-position-priority'],
  retentionModes: ['compact', 'balanced', 'extended']
} as const

const intelligenceSourceStartupRecoveryPolicy = {
  distinctSourceIds(profiles: readonly IntelligenceSourceProfile[]): string[] {
    return [...new Set(profiles.map((profile) => profile.sourceId))]
  }
} as const

const startupRecoveryFailureIsolationPolicy = {
  async recoverSource(operation: () => Promise<void>): Promise<void> {
    try {
      await operation()
    } catch {
      // One source cannot block its neighbors or expose its failure details.
    }
  }
} as const

const sourceRuntimeEligibilityParityPolicy = {
  normalizeCredentialReference(value?: string): string {
    return value?.trim() ?? ''
  },
  isEligible(config: IntelligenceSourceConfig, issues: readonly IntelligenceRuntimeValidationIssue[]): boolean {
    return config.enabled && issues.length === 0
  }
} as const

const sourceRuntimeReconcileIdempotencyPolicy = {
  issueFieldFallback: ''
} as const

const intelligenceSourcesSafeRequestBudgetPolicy = {
  millisecondsPerSecond: 1_000
} as const

export type IntelligenceSourcesService = ReturnType<typeof createIntelligenceSourcesService>

export function createIntelligenceSourcesService(deps: {
  profileStore: SourceProfileStore
  focusSettingsStore?: IntelligenceFocusSettingsStore
  pipeline: IntelligencePipeline
  jobRuntime: JobRuntime
  workerRuntime?: ManagedWorkerRuntime
  replayService?: IntelligenceReplayService
  capitalConditions?: {
    probe: () => Promise<Readonly<{ ok: boolean }>>
    getHealth: (enabled: boolean) => Promise<Readonly<{ runtimeStatus: 'healthy' | 'degraded' | 'paused'; lastSuccessAt?: string; consecutiveFailures: number }>>
  }
  credentialStore?: IntelligenceCredentialStore
  onCalendarEnabledChanged?: () => void | Promise<void>
  validateCredential?: typeof validateIntelligenceCredential
  requestGovernanceQueue?: ReturnType<typeof createSourceRequestGovernanceQueue>
  /** Proxy-aware platform transport for credentialed-provider probes; defaults to the platform fetch. */
  platformFetch?: typeof fetch
}) {
  const orchestrator = createSourceRuntimeOrchestrator({
    jobRuntime: deps.jobRuntime,
    workerRuntime: deps.workerRuntime
  })
  const credentialStore = deps.credentialStore ?? createIntelligenceCredentialStore(createInMemoryIntelligenceCredentialStorage())
  const validateCredential = deps.validateCredential ?? validateIntelligenceCredential
  // Every credentialed provider that owns a real probe registers here; the service keeps only the
  // store/profile/apply steps they share.
  const credentialedProviderProbes = createCredentialedProviderProbes({
    requestGovernanceQueue: deps.requestGovernanceQueue,
    platformFetch: deps.platformFetch
  })
  const validatedAtBySource = new Map<string, string>()
  const focusSettingsStore = deps.focusSettingsStore
  const appliedRuntimeFingerprintBySource = new Map<string, string>()
  let initialization: Promise<void> | undefined
  let initialized = false

  async function getFocusSettings(): Promise<IntelligenceFocusMarketSettings> {
    if (!focusSettingsStore) {
      return createDefaultFocusMarketSettings()
    }
    return focusSettingsStore.getSettings()
  }

  function requestBudgetFor(policy: SourceRequestGovernancePolicy | undefined) {
    return policy?.settingVisibility === 'visible'
      ? { maxRequests: policy.rollingWindow.maxRequests, windowSeconds: policy.rollingWindow.windowMs / intelligenceSourcesSafeRequestBudgetPolicy.millisecondsPerSecond }
      : undefined
  }

  async function buildCredentialStatus(sourceId: string, credentialRef?: string) {
    if (!credentialRef) {
      return { hasCredential: false }
    }

    const safeView = await credentialStore.getSafeView(credentialRef, validatedAtBySource.get(sourceId))
    if (isZeroXRouterSource(sourceId)) {
      return {
        hasCredential: safeView.hasCredential,
        maskedPreview: safeView.maskedPreview
      }
    }
    return {
      hasCredential: safeView.hasCredential,
      maskedPreview: safeView.maskedPreview,
      lastValidatedAt: safeView.lastValidatedAt
    }
  }

  async function recoverSavedProfiles(): Promise<void> {
    const profiles = await deps.profileStore.listProfiles()
    const sourceIds = intelligenceSourceStartupRecoveryPolicy.distinctSourceIds(profiles)
    for (const sourceId of sourceIds) {
      await startupRecoveryFailureIsolationPolicy.recoverSource(async () => {
        const definition = getIntelligenceSourceDefinition(sourceId)
        if (!definition) return
        const profile = await deps.profileStore.resolveProfile(sourceId)
        applyRuntimeEligibility(definition, profile)
      })
    }
  }

  async function initializeRuntime(): Promise<void> {
    if (initialized) return
    if (initialization) return initialization

    const run = recoverSavedProfiles()
      .then(() => {
        initialized = true
      })
      .catch(() => undefined)
    initialization = run.finally(() => {
      initialization = undefined
    })
    return initialization
  }

  function applyRuntimeEligibility(
    definition: NonNullable<ReturnType<typeof getIntelligenceSourceDefinition>>,
    profile: Awaited<ReturnType<SourceProfileStore['resolveProfile']>>
  ): void {
    const { config, issues } = resolveAndValidateRuntimeConfig({
      definition,
      profile,
      hasCredential: Boolean(sourceRuntimeEligibilityParityPolicy.normalizeCredentialReference(profile.credentialRef))
    })
    const fingerprint = canonicalRuntimeFingerprint({ sourceId: definition.sourceId, profile, config, issues })
    if (appliedRuntimeFingerprintBySource.get(profile.sourceId) === fingerprint) return

    if (sourceRuntimeEligibilityParityPolicy.isEligible(config, issues)) {
      orchestrator.reconcile(config)
    } else {
      orchestrator.remove(profile.sourceId)
    }
    appliedRuntimeFingerprintBySource.set(profile.sourceId, fingerprint)
  }

  function jobRegistration(enabledById: Readonly<Record<string, boolean>>): Record<string, boolean> {
    const scheduled = new Set(deps.jobRuntime.listSchedules().map((definition) => definition.id))
    const result: Record<string, boolean> = {}
    for (const source of allSources()) {
      const registered = sourceJobIds(source).some((id) => scheduled.has(id))
      result[source.sourceId] = registered || (needsSourceJob(source) && enabledById[source.sourceId] === true)
    }
    return result
  }

  return {
    initializeRuntime,

    listDefinitions(): SafeIntelligenceSourceDefinition[] {
      return listIntelligenceSourceDefinitions()
        .filter((definition) => definition.visibility !== 'hidden')
        .map(toSafeDefinition)
    },

    hasAdapter(sourceId: string) {
      return Boolean(getIntelligenceAdapter(sourceId))
    },

    async listProfiles() {
      return deps.profileStore.listProfiles()
    },

    /**
     * Explicit reveal for the credential editor. This is the only method that
     * returns a raw key; it must never be logged or included in list/detail
     * projections.
     */
    async setCalendarEnabled(input: { sourceId: string; enabled: boolean }): Promise<{ ok: boolean; failureCode?: string }> {
      if (!input.sourceId.startsWith('macro-calendar-')) return { ok: false, failureCode: 'source-not-calendar' }
      await deps.profileStore.saveProfile({ sourceId: input.sourceId, enabled: input.enabled === true })
      await deps.onCalendarEnabledChanged?.()
      return { ok: true }
    },

    async revealCredential(input: { sourceId: string }): Promise<{ apiKey: string | null }> {
      requireDefinition(input.sourceId)
      const profile = await deps.profileStore.resolveProfile(input.sourceId)
      if (!profile.credentialRef) return { apiKey: null }
      const credential = await credentialStore.getByRef(profile.credentialRef as never)
      return { apiKey: credential?.apiKey ?? null }
    },

    async getSettingsView(): Promise<SettingsView> {
      const profiles = await deps.profileStore.listProfiles()
      const enabledById: Record<string, boolean> = {}
      for (const profile of profiles) enabledById[profile.sourceId] = profile.enabled === true
      const knownSourceIds = new Set(profiles.map((profile) => profile.sourceId))
      return settingsView({ enabledById, jobRegisteredById: jobRegistration(enabledById), knownSourceIds })
    },

    async getAgentView(input: { agentId: string }): Promise<AgentView | undefined> {
      const profiles = await deps.profileStore.listProfiles()
      const enabledById: Record<string, boolean> = {}
      for (const profile of profiles) enabledById[profile.sourceId] = profile.enabled === true
      return agentView(input.agentId as AgentId, { enabledById, jobRegisteredById: jobRegistration(enabledById) })
    },

    async getPanelView(input: { panelId: string }): Promise<PanelView | undefined> {
      const profiles = await deps.profileStore.listProfiles()
      const enabledById: Record<string, boolean> = {}
      for (const profile of profiles) enabledById[profile.sourceId] = profile.enabled === true
      return panelView(input.panelId as PanelId, { enabledById, jobRegisteredById: jobRegistration(enabledById) })
    },

    async getPageState(input?: { sourceId?: string }) {
      const definitions = this.listDefinitions()
      const focusMarketSettings = await getFocusSettings()
      const selectedSourceId = input?.sourceId ?? definitions[0]?.sourceId
      const detail = selectedSourceId ? await this.getDetail(selectedSourceId) : undefined
      const sourceHealthById = Object.fromEntries(
        await Promise.all(
          definitions.map(async (definition) => {
            const health = await this.getHealth({ sourceId: definition.sourceId })
            return [definition.sourceId, health] as const
          })
        )
      )
      return sanitizeSafeView({
        definitions,
        selectedSourceId,
        detail,
        sourceHealthById,
        focusMarketSettings
      } satisfies SafeIntelligenceSourcesPageState)
    },

    async getFocusSettings() {
      return getFocusSettings()
    },

    async saveFocusSettings(input: SaveIntelligenceFocusMarketSettingsInput) {
      if (!focusSettingsStore) {
        throw new Error('Focus market settings are unavailable.')
      }
      return focusSettingsStore.saveSettings({
        enabledFocusMarkets: input.enabledFocusMarkets
      })
    },

    async getDetail(sourceId: string): Promise<SafeIntelligenceSourceDetailView> {
      const definition = requireDefinition(sourceId)
      const profile = await deps.profileStore.resolveProfile(sourceId)
      const runtimeConfig = resolveRuntimeConfig({
        definition,
        profile,
        hasCredential: Boolean(profile.credentialRef)
      })
      const health = await this.getHealth({ sourceId })
      const worker = deps.workerRuntime?.getWorker(`market-intelligence.worker:${sourceId}`)
      const scheduleInput = safeScheduleRuleInput(definition.sourceId, profile)
      const scheduleRule = scheduleInput ? resolveSafeDashboardSourceScheduleRule(scheduleInput) : undefined
      const requestBudget = requestBudgetFor(definition.requestGovernance)

      return sanitizeSafeView({
        definition: toSafeDefinition(definition),
        profile,
        runtimeConfig,
        ...(scheduleRule ? { scheduleRule } : {}),
        ...(requestBudget ? { requestBudget } : {}),
        health: {
          ...health,
          workerStatus: worker?.status
        },
        credentialStatus: sourceSupportsCredentials(definition.authMode)
          ? await buildCredentialStatus(sourceId, profile.credentialRef)
          : undefined
      })
    },

    async saveProfile(input: SaveIntelligenceSourceProfileInput) {
      const definition = requireDefinition(input.sourceId)
      if (blocksProductionCollection(definition) && !hasProductOwnedCollection(definition) && input.enabled === true) {
        throw new Error(`Source "${input.sourceId}" is not ready for production collection.`)
      }

      const saved = await deps.profileStore.saveProfile(input)
      applyRuntimeEligibility(definition, saved)
      return this.getDetail(saved.sourceId)
    },

    async setEnabled(input: { sourceId: string; enabled: boolean }) {
      return this.saveProfile({ sourceId: input.sourceId, enabled: input.enabled })
    },

    async testCredentials(input: { sourceId: string; credentialDraft?: string }) {
      const definition = requireDefinition(input.sourceId)
      if (!sourceSupportsCredentials(definition.authMode)) {
        throw new Error(`Source "${input.sourceId}" does not require credentials.`)
      }

      const registered = credentialedProviderProbes.get(input.sourceId)
      if (registered) {
        const credentialDraft = input.credentialDraft?.trim() ?? ''
        if (!registered.isValidCredentialShape(credentialDraft)) {
          return sanitizeSafeView({
            sourceId: input.sourceId,
            state: 'failed' as const,
            failureCode: 'credential-invalid' as const
          } satisfies SafeCredentialSaveResult)
        }

        const credentialRef = defaultIntelligenceCredentialRef(input.sourceId)
        await credentialStore.save({ credentialRef, sourceId: input.sourceId, apiKey: credentialDraft })
        const saved = await deps.profileStore.saveProfile({ sourceId: input.sourceId, credentialRef })
        validatedAtBySource.delete(input.sourceId)
        applyRuntimeEligibility(definition, saved)
        return sanitizeSafeView({
          sourceId: input.sourceId,
          state: 'unverified' as const
        } satisfies SafeCredentialSaveResult)
      }

      const apiKey = input.credentialDraft?.trim()
      if (!apiKey) {
        return sanitizeSafeView({
          sourceId: input.sourceId,
          ok: false,
          message: 'Credential is required.',
          testedAt: new Date().toISOString()
        })
      }
      const verification = await validateCredential({ sourceId: input.sourceId, apiKey })
      const result: SafeCredentialTestResult = sanitizeSafeView({
        sourceId: input.sourceId,
        ok: verification.ok,
        message: verification.message,
        testedAt: new Date().toISOString()
      })

      if (!verification.ok) {
        return result
      }

      const credentialRef = defaultIntelligenceCredentialRef(input.sourceId)
      await credentialStore.save({ credentialRef, sourceId: input.sourceId, apiKey })
      const saved = await deps.profileStore.saveProfile({ sourceId: input.sourceId, credentialRef })
      validatedAtBySource.set(input.sourceId, result.testedAt)
      applyRuntimeEligibility(definition, saved)

      return result
    },

    async testConnection(input: { sourceId: string }) {
      const definition = requireDefinition(input.sourceId)
      const registered = credentialedProviderProbes.get(definition.sourceId)
      if (registered) {
        const profile = await deps.profileStore.resolveProfile(input.sourceId)
        const credential = profile.credentialRef ? await credentialStore.getByRef(profile.credentialRef) : undefined
        if (!credential?.apiKey) {
          return sanitizeSafeView({
            sourceId: input.sourceId,
            state: 'failed' as const,
            failureCode: 'credential-not-configured' as const
          } satisfies SafeCredentialProviderConnectionResult)
        }
        const outcome = await registered.probe(credential.apiKey)
        return sanitizeSafeView({
          sourceId: input.sourceId,
          ...outcome
        } satisfies SafeCredentialProviderConnectionResult)
      }
      if (definition.sourceId === 'defillama-stablecoins') {
        const result = await deps.capitalConditions?.probe()
        return sanitizeSafeView({
          sourceId: input.sourceId,
          ok: result?.ok === true,
          message: result?.ok === true ? 'Connection verified.' : 'Connection unavailable.',
          testedAt: new Date().toISOString()
        } satisfies SafeConnectionTestResult)
      }
      const profile = await deps.profileStore.resolveProfile(input.sourceId)
      const config = resolveRuntimeConfig({
        definition,
        profile,
        hasCredential: Boolean(profile.credentialRef)
      })
      const result = await probeIntelligenceSourceConnection(config, {
        profileStore: deps.profileStore,
        credentialStore
      })
      deps.pipeline.reportConnectivityProbe(input.sourceId, {
        ok: result.ok,
        message: result.message
      })
      return sanitizeSafeView({
        sourceId: input.sourceId,
        ok: result.ok,
        message: result.message,
        testedAt: result.testedAt
      } satisfies SafeConnectionTestResult)
    },

    async runNow(input: { sourceId: string }) {
      const definition = requireDefinition(input.sourceId)
      if (blocksProductionCollection(definition) || !definition.supportsRunNow) {
        throw new Error(`Source "${input.sourceId}" is not available for production collection.`)
      }

      const profile = await deps.profileStore.resolveProfile(input.sourceId)
      const { config, issues } = resolveAndValidateRuntimeConfig({
        definition,
        profile,
        hasCredential: Boolean(profile.credentialRef)
      })
      if (issues.length > 0) {
        throw new Error(issues[0]?.message ?? 'Source is not ready to run.')
      }

      const action = await orchestrator.runNow(config)
      return sanitizeSafeView({
        sourceId: input.sourceId,
        action: action.action,
        queuedAt: new Date().toISOString()
      } satisfies SafeRunNowResult)
    },

    async replayWindow(input: { sourceId: string; from?: string; to?: string }) {
      const definition = requireDefinition(input.sourceId)
      if (definition.supportsReplay === false) {
        return sanitizeSafeView({
          sourceId: input.sourceId,
          queuedAt: new Date().toISOString(),
          summary: 'Replay is unavailable.'
        } satisfies SafeReplayWindowResult)
      }
      if (!deps.replayService) {
        return sanitizeSafeView({
          sourceId: input.sourceId,
          queuedAt: new Date().toISOString(),
          summary: 'Replay is unavailable.'
        } satisfies SafeReplayWindowResult)
      }

      const result = await deps.replayService.queueReplayWindow(input)
      return sanitizeSafeView({
        sourceId: result.sourceId,
        queuedAt: result.queuedAt,
        summary: result.summary
      } satisfies SafeReplayWindowResult)
    },

    async getHealth(input: { sourceId: string }) {
      const profile = await deps.profileStore.resolveProfile(input.sourceId)
      if (input.sourceId === 'defillama-stablecoins') {
        const health = await deps.capitalConditions?.getHealth(profile.enabled)
        if (health) {
          return toCapitalConditionsSafeHealthView(input.sourceId, health, profile.enabled)
        }
      }
      const pipelineHealth = deps.pipeline.getHealth(input.sourceId)
      return toSafeHealthView(input.sourceId, pipelineHealth, profile.enabled)
    }
  }
}

function canonicalRuntimeFingerprint(input: {
  sourceId: string
  profile: IntelligenceSourceProfile
  config: IntelligenceSourceConfig
  issues: readonly IntelligenceRuntimeValidationIssue[]
}): string {
  return stableJson({
    sourceId: input.sourceId,
    profileRevision: input.profile.updatedAt,
    enabled: input.config.enabled,
    desiredRuntimeState: input.config.desiredRuntimeState,
    collectionPreset: input.config.collectionPreset,
    pollingIntervalSec: input.config.pollingIntervalSec,
    credentialRef: sourceRuntimeEligibilityParityPolicy.normalizeCredentialReference(input.profile.credentialRef),
    adapterConfig: input.config.adapterConfig,
    issues: input.issues.map(({ code, field }) => ({
      code,
      field: field ?? sourceRuntimeReconcileIdempotencyPolicy.issueFieldFallback
    }))
  })
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortCanonicalValue(value))
}

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonicalValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortCanonicalValue(entry)])
  )
}

function toCapitalConditionsSafeHealthView(
  sourceId: string,
  health: Readonly<{
    runtimeStatus: 'healthy' | 'degraded' | 'paused'
    lastSuccessAt?: string
    consecutiveFailures: number
  }>,
  enabled: boolean
): SafeIntelligenceSourceHealthView {
  const normalized = {
    sourceId,
    runtimeStatus: enabled ? health.runtimeStatus : ('paused' as const),
    ...(health.lastSuccessAt ? { lastSuccessAt: health.lastSuccessAt } : {}),
    consecutiveFailures: health.consecutiveFailures
  }

  return sanitizeSafeView({
    ...normalized,
    connectivityStatus: resolveConnectivityStatus(normalized, enabled)
  })
}

function safeScheduleRuleInput(sourceId: string, profile: unknown): { sourceId: string; collectionPreset: unknown } | undefined {
  try {
    if (!isExactProfile(profile)) return undefined
    const profileSourceId = Object.getOwnPropertyDescriptor(profile, 'sourceId')?.value
    const collectionPreset = Object.getOwnPropertyDescriptor(profile, 'collectionPreset')?.value
    return profileSourceId === sourceId ? { sourceId, collectionPreset } : undefined
  } catch {
    return undefined
  }
}

function toSafeDefinition(definition: NonNullable<ReturnType<typeof getIntelligenceSourceDefinition>>): SafeIntelligenceSourceDefinition {
  const { requestGovernance: _requestGovernance, ...safeDefinition } = definition
  return safeDefinition
}

function isExactProfile(value: unknown): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
    const names = Object.getOwnPropertyNames(value)
    const allowedFields = [...dashboardScheduleProfilePolicy.requiredFields, ...dashboardScheduleProfilePolicy.optionalFields]
    if (!dashboardScheduleProfilePolicy.requiredFields.every((field) => names.includes(field)) ||
      !names.every((name) => allowedFields.includes(name as never)) || Object.getOwnPropertySymbols(value).length !== 0) return false
    const values = new Map<string, unknown>()
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      if (!descriptor || !('value' in descriptor)) return false
      values.set(name, descriptor.value)
    }
    structuredClone(value)
    return typeof values.get('profileId') === 'string' &&
      typeof values.get('sourceId') === 'string' &&
      typeof values.get('enabled') === 'boolean' &&
      isCollectionPresetValue(values.get('collectionPreset')) &&
      typeof values.get('includeInSentiment') === 'boolean' &&
      dashboardScheduleProfilePolicy.scopePolicies.includes(values.get('scopePolicy') as never) &&
      typeof values.get('rawArchiveEnabled') === 'boolean' &&
      dashboardScheduleProfilePolicy.retentionModes.includes(values.get('retentionMode') as never) &&
      typeof values.get('autoReplayAfterParserUpgrade') === 'boolean' &&
      typeof values.get('updatedAt') === 'string' &&
      isOptionalString(values.get('credentialRef')) &&
      isOptionalString(values.get('sourceSpecificConfigJson')) &&
      isOptionalStringArray(values.get('monitoredSymbols'))
  } catch {
    return false
  }
}

function isCollectionPresetValue(value: unknown): value is 'manual' | 'balanced' | 'frequent' {
  return value === 'manual' || value === 'balanced' || value === 'frequent'
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  if (value === undefined) return true
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length !== 0) return false
  const names = Object.getOwnPropertyNames(value)
  if (!names.filter((name) => name !== 'length').every((name) => /^\d+$/.test(name))) return false
  if (!names.filter((name) => name !== 'length').every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    return Boolean(descriptor && 'value' in descriptor && typeof descriptor.value === 'string')
  })) return false
  try {
    structuredClone(value)
    return true
  } catch {
    return false
  }
}

function requireDefinition(sourceId: string) {
  const definition = getIntelligenceSourceDefinition(sourceId)
  if (!definition) throw new Error(`Unknown intelligence source "${sourceId}".`)
  return definition
}

export function createDefaultProfileForDefinition(sourceId: string) {
  const definition = getIntelligenceSourceDefinition(sourceId)
  if (!definition) throw new Error(`Unknown intelligence source "${sourceId}".`)
  return createDefaultSourceProfile(definition)
}
