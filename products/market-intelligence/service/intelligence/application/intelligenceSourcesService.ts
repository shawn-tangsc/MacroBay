import type { JobRuntime, ManagedWorkerRuntime } from '@platform/jobs'

import { listIntelligenceSourceDefinitions, getIntelligenceSourceDefinition } from './sourceCatalog'
import {
  agentView, panelView, settingsView, sourceConfigSurface,
  type AgentView, type PanelView, type SettingsView, type SourceConfigFact, type SourceHealthFact
} from './sourceProjection'
import { allSources, type AgentId, type PanelId } from './providerRegistry'
import { projectJobRegistration } from './sourceJobRegistration'
import { getIntelligenceAdapter } from '../adapters/adapterRegistry'
import type { IntelligencePipeline } from './intelligencePipeline'
import { readHealth, type SourceHealthView } from './sourceHealthReader'
import { canonicalRuntimeFingerprint, sourceRuntimeEligibilityParityPolicy } from './runtimeFingerprint'
import { isCollectionPresetValue, isExactProfile, isOptionalString, isOptionalStringArray } from './sourceProfileGuards'
import {
  blocksProductionCollection,
  createDefaultSourceProfile,
  hasProductOwnedCollection,
  resolveAndValidateRuntimeConfig,
  resolveRuntimeConfig,
  resolveSafeDashboardSourceScheduleRule
} from './sourceRuntimeConfig'
import {
  sourceRequiresCredential,
  sourceSupportsCredentials,
  type IntelligenceSourceProfile
} from '../schema/intelligenceSource'
import { createSourceProfileStore, type SourceProfileStore } from './sourceProfileStore'
import { probeIntelligenceSourceConnection } from './intelligenceSourceConnectivity'
import { createSourceRuntimeOrchestrator } from './sourceRuntimeOrchestrator'
import { syncSourceOwnedJobSchedules } from './sourceOwnedJobSchedules'
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
  SaveIntelligenceSourceProfileInput
} from '../schema/intelligenceSourcesContracts'
import { sanitizeSafeView } from '../schema/intelligenceSourcesContracts'
import {
  createInMemoryIntelligenceCredentialStorage,
  createIntelligenceCredentialStore,
  defaultIntelligenceCredentialRef,
  type IntelligenceCredentialStore
} from '../store/intelligenceCredentialStore'

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

const intelligenceSourcesSafeRequestBudgetPolicy = {
  millisecondsPerSecond: 1_000
} as const

export type IntelligenceSourcesService = ReturnType<typeof createIntelligenceSourcesService>

export function createIntelligenceSourcesService(deps: {
  profileStore: SourceProfileStore
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
  /** Every switch, including the product-owned ones that arm their own job. */
  onSourceEnabledChanged?: (sourceId: string) => void | Promise<void>
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

  /** 健康读数的依赖面：只给它真正用到的两样（流水线健康 + 资金条件投影）。 */
  const healthDeps = {
    pipeline: deps.pipeline,
    ...(deps.capitalConditions ? { capitalConditions: deps.capitalConditions } : {})
  }
  const validateCredential = deps.validateCredential ?? validateIntelligenceCredential
  // Every credentialed provider that owns a real probe registers here; the service keeps only the
  // store/profile/apply steps they share.
  const credentialedProviderProbes = createCredentialedProviderProbes({
    requestGovernanceQueue: deps.requestGovernanceQueue,
    platformFetch: deps.platformFetch
  })
  const validatedAtBySource = new Map<string, string>()
  const appliedRuntimeFingerprintBySource = new Map<string, string>()
  let initialization: Promise<void> | undefined
  let initialized = false

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
    // 产品自有作业（宏观市场、DXY、Nasdaq 100…）不归通用编排管，但「没启用就不注册」同一条规则：
    // 它们的启用口径是「读者开着」+「真的能采」，与上面 `config.enabled` 不同，闸仍只有这一处——
    // 装配时不再无条件排期，开或关都从这里走。
    syncSourceOwnedJobSchedules({
      jobRuntime: deps.jobRuntime,
      sourceId: profile.sourceId,
      enabled: hasProductOwnedCollection(definition)
        && !blocksProductionCollection(definition)
        && profile.enabled === true
    })
    appliedRuntimeFingerprintBySource.set(profile.sourceId, fingerprint)
  }

  function jobRegistration(): Record<string, boolean> {
    // 只认真实排期：`listSchedules()` 里没有这个源的作业，它就是「未安排」——不从启用开关反推。
    const scheduled = new Set(deps.jobRuntime.listSchedules().map((definition) => definition.id))
    return projectJobRegistration(allSources(), scheduled)
  }

  /**
   * C4-S0：**一份事实的唯一计算点**。
   *
   * 三个读命令（全量 / 按面板 / 按源）都从这里拿事实，差异只剩「筛了哪些源」与「带不带详情」。
   * 这里把 profile、健康读数、任务注册、凭据状态各读一次，交给 `sourceProjection.sourceConfigSurface`
   * 做纯计算——旧实现里 `getPageState` 对选中源读两次健康，正是「三条命令各算一遍」的口子。
   */
  async function readConfigSurface(filter: { panelId?: PanelId; sourceId?: string } = {}) {
    // **profile 覆盖要按注册表里的可见源来读**：日历 feed（`macro-calendar-*`）只在
    // `providerRegistry` / `calendarFeedRegistry` 里，不在通用目录里；只看目录会把它们保存过的
    // profile 漏掉，设置页就把「正在跑」画成「你已停用」。
    const registrySources = allSources().filter((source) => source.visibility !== 'hidden')
    const catalogDefinitions = listIntelligenceSourceDefinitions()
      .filter((definition) => definition.visibility !== 'hidden')
    const catalogById = new Map(catalogDefinitions.map((definition) => [definition.sourceId, definition]))

    const profileById: Record<string, IntelligenceSourceProfile> = {}
    for (const source of registrySources) {
      const stored = await deps.profileStore.getProfile(source.sourceId)
      if (stored !== undefined) {
        profileById[source.sourceId] = stored
        continue
      }
      // 没存过 profile 的源：目录源按默认 profile 参与视图（与旧实现一致）；日历 feed 没有默认，
      // 保持「没有配置」——它在设置页照旧显示为关着的，不拿默认值冒充读者的选择。
      if (catalogById.has(source.sourceId)) {
        profileById[source.sourceId] = await deps.profileStore.resolveProfile(source.sourceId)
      }
    }

    // 健康读数**只对能读的源读**（目录源），不因为上面扩大了 profile 覆盖面就跟着扩。
    const healthViewById: Record<string, SourceHealthView> = {}
    const healthById: Record<string, Readonly<{ runtimeStatus: 'healthy' | 'degraded' | 'failed' | 'paused'; consecutiveFailures: number }>> = {}
    const credentialStatusById: Record<string, Readonly<{ hasCredential: boolean; maskedPreview?: string; lastValidatedAt?: string }>> = {}
    for (const definition of catalogDefinitions) {
      const profile = profileById[definition.sourceId]
      if (profile === undefined) continue
      const health = await readHealth(healthDeps, definition.sourceId, profile)
      healthViewById[definition.sourceId] = health
      healthById[definition.sourceId] = {
        runtimeStatus: health.runtimeStatus,
        consecutiveFailures: health.consecutiveFailures
      }
      if (sourceSupportsCredentials(definition.authMode)) {
        credentialStatusById[definition.sourceId] = await buildCredentialStatus(definition.sourceId, profile.credentialRef)
      }
    }
    return {
      rawDefinitions: catalogDefinitions,
      profileById,
      healthViewById,
      surface: sourceConfigSurface({
        definitions: registrySources,
        profileById,
        healthById,
        jobRegisteredById: jobRegistration(),
        credentialStatusById,
        ...(filter.panelId === undefined ? {} : { panelId: filter.panelId }),
        ...(filter.sourceId === undefined ? {} : { sourceId: filter.sourceId })
      })
    }
  }

  /** 详情 = 同一份事实 + 运行时配置 / 计划规则 / 预算 / worker 状态；健康读数用外面读好的那一份。 */
  function buildDetailFromFact(
    fact: SourceConfigFact,
    health: SourceHealthView
  ): SafeIntelligenceSourceDetailView {
    const definition = requireDefinition(fact.sourceId)
    const runtimeConfig = resolveRuntimeConfig({
      definition,
      profile: fact.profile,
      hasCredential: Boolean(fact.profile.credentialRef)
    })
    const worker = deps.workerRuntime?.getWorker(`market-intelligence.worker:${fact.sourceId}`)
    const scheduleInput = safeScheduleRuleInput(fact.sourceId, fact.profile)
    const scheduleRule = scheduleInput ? resolveSafeDashboardSourceScheduleRule(scheduleInput) : undefined
    const requestBudget = requestBudgetFor(definition.requestGovernance)
    return sanitizeSafeView({
      definition: toSafeDefinition(definition),
      profile: fact.profile,
      runtimeConfig,
      ...(scheduleRule ? { scheduleRule } : {}),
      ...(requestBudget ? { requestBudget } : {}),
      health: { ...health, workerStatus: worker?.status },
      credentialStatus: fact.credentialStatus
    })
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

    /**
     * 每个源的健康读数，只作为五态派生的输入（`sourceProjection` 一处判五态）。
     * 与 `getPageState` 同一份 `getHealth`，不给两头各读一套。
     */
    async healthFacts(): Promise<Record<string, SourceHealthFact>> {
      const definitions = this.listDefinitions()
      const facts = await Promise.all(definitions.map(async (definition) => {
        const health = await this.getHealth({ sourceId: definition.sourceId })
        return [definition.sourceId, { runtimeStatus: health.runtimeStatus, consecutiveFailures: health.consecutiveFailures }] as const
      }))
      return Object.fromEntries(facts)
    },

    async getSettingsView(): Promise<SettingsView> {
      // 全量：事实只算一次（`readConfigSurface`），这里只把它摊成设置视图。
      return settingsView((await readConfigSurface()).surface.state)
    },

    /** C4-S0：一份事实的唯一计算点在 `sourceProjection.sourceConfigSurface`（见本文件 `readConfigSurface`）。 */
    async sourceConfigSurface(filter: { panelId?: PanelId; sourceId?: string } = {}) {
      const read = await readConfigSurface(filter)
      // 投影对外只给事实本身（定义换成安全形状）；筛过的集合由参数决定，形状不另开一套。
      return {
        facts: read.surface.facts.map((fact) => ({
          ...fact,
          definition: toSafeDefinition(requireDefinition(fact.sourceId))
        }))
      }
    },

    async getAgentView(input: { agentId: string }): Promise<AgentView | undefined> {
      const profiles = await deps.profileStore.listProfiles()
      const enabledById: Record<string, boolean> = {}
      for (const profile of profiles) enabledById[profile.sourceId] = profile.enabled === true
      return agentView(input.agentId as AgentId, { enabledById, jobRegisteredById: jobRegistration() })
    },

    async getPanelView(input: { panelId: string }): Promise<PanelView | undefined> {
      // 面板：同一份事实，只按 `panelId` 筛源；形状还是那一个。
      return panelView(input.panelId as PanelId, (await readConfigSurface({ panelId: input.panelId as PanelId })).surface.state)
    },

    async getPageState(input?: { sourceId?: string }) {
      // 分页读：同一份事实，只按 `sourceId` 取详情。健康读数每个源**只读一次**——旧实现里选中的
      // 那个源会被读两次（一次进 `sourceHealthById`、一次进详情），那就是「三条命令各算一遍」的入口。
      const read = await readConfigSurface()
      const definitions = read.rawDefinitions.map(toSafeDefinition)
      const selectedSourceId = input?.sourceId ?? definitions[0]?.sourceId
      const selectedFact = selectedSourceId === undefined ? undefined : read.surface.byId[selectedSourceId]
      const detail = selectedSourceId === undefined || selectedFact === undefined
        ? undefined
        : buildDetailFromFact(selectedFact, read.healthViewById[selectedSourceId])
      const sourceHealthById = read.healthViewById
      return sanitizeSafeView({
        definitions,
        selectedSourceId,
        detail,
        sourceHealthById
      } satisfies SafeIntelligenceSourcesPageState)
    },

    async getDetail(sourceId: string): Promise<SafeIntelligenceSourceDetailView> {
      requireDefinition(sourceId)
      const read = await readConfigSurface({ sourceId })
      const fact = read.surface.byId[sourceId]
      if (fact === undefined) throw new Error(`Unknown intelligence source "${sourceId}".`)
      return buildDetailFromFact(fact, read.healthViewById[sourceId])
    },

    async saveProfile(input: SaveIntelligenceSourceProfileInput) {
      const definition = requireDefinition(input.sourceId)
      if (blocksProductionCollection(definition) && !hasProductOwnedCollection(definition) && input.enabled === true) {
        throw new Error(`Source "${input.sourceId}" is not ready for production collection.`)
      }

      const saved = await deps.profileStore.saveProfile(input)
      applyRuntimeEligibility(definition, saved)
      // A product-owned job arms or drops its own schedule from this signal; failing to notify must
      // not fail the save the reader just made.
      try {
        await deps.onSourceEnabledChanged?.(saved.sourceId)
      } catch {
        // The switch is saved; the next boot re-syncs the job registry anyway.
      }
      return this.getDetail(saved.sourceId)
    },

    async setEnabled(input: { sourceId: string; enabled: boolean }) {
      // 需要 API Key 的源：钥匙没配好之前，**任何启用请求都由后端拒绝**（不靠界面灰掉）。
      // 关闭永远允许；不需要钥匙的源不受影响。
      if (input.enabled) {
        const definition = requireDefinition(input.sourceId)
        if (sourceRequiresCredential(definition.authMode)) {
          const profile = await deps.profileStore.resolveProfile(input.sourceId)
          if (!profile.credentialRef) {
            return Object.freeze({ state: 'rejected' as const, reasonCode: 'credential-required' as const })
          }
        }
      }
      const detail = await this.saveProfile({ sourceId: input.sourceId, enabled: input.enabled })
      return Object.freeze({ state: 'saved' as const, detail })
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
      return readHealth(healthDeps, input.sourceId, profile)
    }
  }
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
