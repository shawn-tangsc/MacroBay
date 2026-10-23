import type {
  ModelChatProtocol,
  ModelDefinition,
  ProviderCustomHeader,
  ModelProvider,
  ModelProviderInput,
  PersistedModelProvider,
  PersistedProviderState,
  ProviderRuntimeResolver,
  ProviderSecretOrphan,
  ProviderState,
  SafeModelProvider
} from './modelProviderTypes'
import { SecretVaultError, type SecretOwnerScope, type SecretVault } from '../../secrets/secretVaultTypes'
import {
  createSystemProviderPresets,
  isSystemProviderId as isPresetSystemProviderId
} from './providerPresets'
import { mergeSystemProviderPresets, systemPresetsVersion } from './providerPresetMerge'
import {
  deriveDeclaredProtocols,
  normalizeModelChatProtocol,
  normalizeModelSupportedProtocols
} from './modelChatProtocol'
import { applyProtocolSets } from './modelProtocolSets'
import {
  normalizeProviderChatEndpoints,
  normalizeProviderImageEndpoints,
  resolveProviderPrimaryBase
} from './providerChatEndpoints'
import { normalizeModelCapabilities } from './modelCapabilities'
import { withModelPriceTag } from './modelPriceTag'
import { inferModelCapabilities, isNonChatModelId, resolveModelCapabilities } from './modelCapabilityInference'
import { applyModelSyncPlan, isProviderPresetModel, type ModelSyncPlan } from './providerModelSync'
import { diffRemovedEndpointProtocols } from './providerEndpointMerge'

export type ProviderStorageWriteOptions = {
  /** PLAT-78：与状态同一次写入的元数据（SQLite 实现会在**同一个事务**里落库）。 */
  meta?: Readonly<Record<string, unknown>>
}

export type ProviderStorage = {
  read: () => Promise<unknown>
  write: (state: PersistedProviderState, options?: ProviderStorageWriteOptions) => Promise<void>
  /** PLAT-78：读取持久化元数据（如预设版本号）；没有实现 ⇒ 视为"无版本记录"。 */
  readMeta?: (key: string) => Promise<unknown>
}

/** PLAT-78：预设版本号在 `model_provider_meta` 里的键。 */
export const ProviderPresetVersionMetaKey = 'preset_version'

export type ProviderSecretErrorCode =
  | 'provider-secret-vault-unavailable'
  | 'provider-secret-vault-write-failed'
  | 'provider-secret-metadata-write-failed'
  | 'provider-secret-orphan-journal-full'

export class ProviderSecretError extends Error {
  constructor(readonly code: ProviderSecretErrorCode) {
    super(code)
    this.name = 'ProviderSecretError'
  }
}

export const ProviderSecretMetadataPolicy = {
  owner: {
    ownerType: 'platform',
    ownerId: 'ai-providers',
    namespace: 'api-key'
  } satisfies SecretOwnerScope,
  migrationState: 'vault-backed',
  storageVersion: 1
} as const

export const ProviderSecretRotationPolicy = {
  generationPrefix: 'generation-',
  firstGeneration: 1
} as const

export const ProviderGenerationCutoverPolicy = {
  owner: 'platform/ai/providers',
  mutation: 'single-store-queue',
  failure: 'keep-last-committed-metadata'
} as const

export const ProviderOrphanJournalPolicy = {
  owner: 'platform/ai/providers',
  source: 'provider metadata secretOrphans',
  field: 'secretOrphans',
  maxEntries: 32,
  failure: 'reject-secret-changing-mutation-and-retain-records',
  testBoundary: 'providerStore orphan recovery and capacity tests'
} as const

export const ProviderOrphanJournalOverCapacityPolicy = {
  owner: 'platform/ai/providers',
  source: 'historical owner-scoped provider secret orphan journal',
  default: 'attempt one fixed cleanup batch before allowing secret-changing mutations',
  failure: 'provider-secret-orphan-journal-full',
  testBoundary: 'providerStore historical orphan recovery tests'
} as const

export const ProviderVaultUnavailablePolicy = {
  errorCode: 'provider-secret-vault-unavailable'
} as const

export const ProviderSecretCiphertextPresencePolicy = {
  owner: 'platform/ai/providers',
  source: 'vault.exists for each persisted provider ref',
  failure: 'mark-only-that-provider-unavailable-without-decrypting-or-validating',
  testBoundary: 'providerStore ciphertext presence listing tests'
} as const

export const ProviderCurrentFormatPolicy = {
  owner: 'platform/ai/providers',
  source: 'persisted provider metadata load',
  default: 'ignore plaintext apiKey fields and retain only vault-backed metadata',
  failure: 'unconfigured without vault access',
  testBoundary: 'providerStore legacy fixture no-vault-I/O tests',
  retainsVaultMetadata(provider: Pick<ModelProvider, 'apiKeyRef'>): boolean {
    return Boolean(provider.apiKeyRef)
  }
} as const

export const ProviderRendererSafeViewPolicy = {
  withheldFields: ['apiKey', 'apiKeyRef', 'apiKeyAvailability', 'apiKeyMigrationState', 'apiKeyStorageVersion']
} as const

export const ProviderReadinessPolicy = {
  isReady(input: { enabled: boolean; baseUrl: string; hasVaultBackedKey: boolean }): boolean {
    return Boolean(input.enabled && input.baseUrl.trim() && input.hasVaultBackedKey)
  }
} as const

export const ProviderSecretPreviewPolicy = {
  isSafePreview(value: string): boolean {
    // 兼容历史省略号格式，其余必须是当前的 10 星掩码。
    return Boolean(value && (value === maskSecret(value) || LEGACY_SECRET_PREVIEW.test(value)))
  }
} as const

export type ProviderStore = {
  getState: import('./modelProviderTypes').ProviderStateAccessor
  resolveRuntimeProvider: ProviderRuntimeResolver
  list: () => Promise<SafeModelProvider[]>
  upsert: (provider: ModelProviderInput) => Promise<SafeModelProvider>
  remove: (providerId: string) => Promise<SafeModelProvider[]>
  setEnabled: (providerId: string, enabled: boolean) => Promise<SafeModelProvider>
  addOrUpdateModel: (providerId: string, model: ModelDefinition) => Promise<SafeModelProvider>
  /**
   * PLAT-82：检测结束后写入**实测通过**的协议（一次写入，覆盖本次 run 的所有模型）。
   *
   * 只写正结论：并进 `supportedProtocols`，并记进 `probedProtocols`（来源标记）。
   * 实测失败不写任何东西 —— 不删声明、不写"不支持"。
   */
  recordProbedProtocols: (
    providerId: string,
    updates: readonly ModelProbedProtocolsUpdate[]
  ) => Promise<void>
  removeModel: (providerId: string, modelId: string) => Promise<SafeModelProvider>
  setDefaultChatModel: (providerId: string, modelId: string) => Promise<SafeModelProvider>
  applyModelSync: (providerId: string, plan: ModelSyncPlan) => Promise<SafeModelProvider>
  /**
   * PLAT-58：产品 owner 决定的显式查看能力。只读 —— 不解密进状态、不写 metadata、
   * 不改 `apiKeyAvailability`；返回第一条非空凭据（内存运行期 Key 优先，其次 vault）。
   * 值只交给调用方（Main handler），本函数自身绝不记录日志。
   */
  revealApiKey: (providerId: string) => Promise<string | null>
  setCustomHeaders: (providerId: string, headers: unknown) => Promise<SafeModelProvider>
  revealCustomHeaders: (providerId: string) => Promise<ProviderCustomHeader[]>
}

export function createDefaultProviderState(): ProviderState {
  return {
    providers: createSystemProviderPresets().map((provider) => ({
      ...provider,
      models: provider.models.map((model) => withModelSupportedProtocols(model, provider.endpoints[0]?.protocol))
    }))
  }
}

export function isSystemProviderId(providerId: string): boolean {
  return isPresetSystemProviderId(providerId)
}

/** 掩码预览：保留头 4 位与尾 4 位，中间固定 10 个 `*`（不用省略号）。 */
export const SECRET_PREVIEW_MASK = '**********'

export function maskSecret(secret?: string): string {
  if (!secret) return ''
  const trimmed = secret.trim()
  if (trimmed.length <= 8) return '*'.repeat(trimmed.length)
  return `${trimmed.slice(0, 4)}${SECRET_PREVIEW_MASK}${trimmed.slice(-4)}`
}

/** 旧格式 `abcdefgh...wxyz`（中间是省略号）—— 只在读取历史数据时兼容，写回一律用新格式。 */
const LEGACY_SECRET_PREVIEW = /^(\S{4})\.{3}(\S{4})$/u

/** 历史预览统一升级成新掩码，避免老数据在界面上显示成旧样式。 */
export function upgradeSecretPreview(preview: string): string {
  const legacy = LEGACY_SECRET_PREVIEW.exec(preview)
  return legacy ? `${legacy[1]}${SECRET_PREVIEW_MASK}${legacy[2]}` : preview
}

export function toSafeProvider(provider: ModelProvider): SafeModelProvider {
  const safeProvider = { ...provider } as Record<string, unknown>
  for (const field of ProviderRendererSafeViewPolicy.withheldFields) delete safeProvider[field]
  const connectionStatus = provider.apiKey?.trim()
    ? 'ready'
    : provider.apiKeyRef
      ? provider.apiKeyAvailability === 'available'
        ? 'ready'
        : provider.apiKeyAvailability === 'unavailable'
          ? 'unavailable'
          : 'unverified'
      : 'unavailable'
  const hasApiKey = connectionStatus !== 'unavailable'
  return {
    ...safeProvider as Omit<SafeModelProvider, 'hasApiKey' | 'apiKeyPreview' | 'customHeaders'>,
    hasApiKey,
    apiKeyPreview: maskSecret(provider.apiKey?.trim() ? provider.apiKey : provider.apiKeyPreview),
    connectionStatus,
    ...(provider.customHeaders
      ? {
          customHeaders: provider.customHeaders.map((header) => ({
            name: header.name,
            value: '••••',
            hasValue: header.value.length > 0
          }))
        }
      : {})
  }
}

export function isProviderConnectionReady(provider: SafeModelProvider | ModelProvider): boolean {
  const hasRuntimeKey = 'hasApiKey' in provider
    // Legacy safe DTOs predate connectionStatus and retain their hasApiKey contract.
    ? provider.connectionStatus === undefined
      ? provider.hasApiKey
      : provider.connectionStatus === 'ready'
    : Boolean(provider.apiKey?.trim())
  return ProviderReadinessPolicy.isReady({
    enabled: provider.enabled,
    baseUrl: provider.baseUrl,
    hasVaultBackedKey: hasRuntimeKey
  })
}

export function normalizeProviderState(
  value: unknown,
  options: { mergePresets?: boolean } = {}
): ProviderState {
  if (!value || typeof value !== 'object') return createDefaultProviderState()

  const providers = Array.isArray((value as ProviderState).providers) ? (value as ProviderState).providers : []
  const normalized = {
    providers: providers.map(normalizeProvider).filter(Boolean) as ModelProvider[]
  }
  // PLAT-78：预设版本一致 ⇒ 调用方可以要求**跳过合并**（启动零改写）。
  return options.mergePresets === false ? normalized : mergeSystemProviderPresets(normalized)
}

export function upsertProvider(state: ProviderState, input: ModelProviderInput): ProviderState {
  const existing = state.providers.find((provider) => provider.id === input.id)
  /**
   * 端点清单是**用户拥有的整份数组**：本次写入带了就用它（`[]` = 删光端点，必须原样保留），
   * 没带就沿用已存值。base 的归一（trim / 去尾斜杠）只在 `normalizeProviderChatEndpoints`
   * 做一次，`baseUrl` 由归一后的端点清单派生，不存在第二份可写事实。
   */
  const endpoints = input.endpoints ?? existing?.endpoints
  /**
   * 端点墓碑（预设合并时跳过）只在**这里**算：本次写入带了端点清单时，
   * 用"旧清单 - 新清单"差分出用户删掉的协议（`(旧墓碑 ∪ 刚删的) - 新清单`）。
   * UI 不参与计算；不带端点清单的写入（改 Key / 开关 / 模型）原样保留旧墓碑。
   */
  const removedEndpointProtocols = input.endpoints === undefined
    ? existing?.removedEndpointProtocols
    : diffRemovedEndpointProtocols({
        previousEndpoints: existing?.endpoints ?? [],
        nextEndpoints: input.endpoints,
        removedEndpointProtocols: existing?.removedEndpointProtocols
      })
  const provider = normalizeProvider({
    ...existing,
    id: input.id,
    name: input.name,
    enabled: input.enabled,
    endpoints,
    removedEndpointProtocols,
    imageEndpoints: input.imageEndpoints ?? existing?.imageEndpoints,
    isSystem: input.isSystem ?? existing?.isSystem,
    websites: input.websites ?? existing?.websites,
    defaultChatModelId: input.defaultChatModelId ?? existing?.defaultChatModelId,
    apiKey: input.apiKey === undefined ? existing?.apiKey : input.apiKey,
    apiKeyAvailability: input.apiKey === undefined ? existing?.apiKeyAvailability : undefined,
    models: input.models ?? existing?.models ?? []
  })

  if (!provider) throw new Error('Provider id and name are required.')

  const existingIndex = state.providers.findIndex((item) => item.id === provider.id)
  if (existingIndex >= 0) {
    return {
      providers: state.providers.map((item, index) => (index === existingIndex ? provider : item))
    }
  }

  return {
    providers: provider.isSystem ? [...state.providers, provider] : [provider, ...state.providers]
  }
}

export type ModelProbedProtocolsUpdate = {
  modelId: string
  /** 本次实测通过的协议（调用方已过滤；空数组 = 不写）。 */
  protocols: readonly ModelChatProtocol[]
}

/**
 * PLAT-82：把"本次实测通过"合并进模型记录（纯函数，只增不减）。
 *
 *  - `supportedProtocols` += 通过的协议（它是"能走哪些"的事实源，pill/运行时都读它）；
 *  - `probedProtocols` += 通过的协议（来源标记，行内 chip 用它说"实测通过"）；
 *  - 没有新增内容 ⇒ 返回同一个 state（不产生无意义写入）。
 *
 * **失败不写负结论**：这个函数只接受通过的协议，删除/降级永远不会发生。
 */
export function applyProbedProtocols(
  state: ProviderState,
  providerId: string,
  updates: readonly ModelProbedProtocolsUpdate[]
): ProviderState {
  const byModel = new Map<string, readonly ModelChatProtocol[]>()
  for (const update of updates) {
    const protocols = normalizeModelSupportedProtocols([...update.protocols])
    if (!protocols) continue
    byModel.set(update.modelId, protocols)
  }
  if (byModel.size === 0) return state

  let changed = false
  const providers = state.providers.map((provider) => {
    if (provider.id !== providerId) return provider
    let providerChanged = false
    const models = provider.models.map((model) => {
      const passed = byModel.get(model.id)
      if (!passed) return model
      const supportedProtocols = normalizeModelSupportedProtocols([
        ...(model.supportedProtocols ?? []),
        ...passed
      ]) ?? []
      const probedProtocols = normalizeModelSupportedProtocols([
        ...(model.probedProtocols ?? []),
        ...passed
      ]) ?? []
      const sameSupported = JSON.stringify(model.supportedProtocols ?? []) === JSON.stringify(supportedProtocols)
      const sameProbed = JSON.stringify(model.probedProtocols ?? []) === JSON.stringify(probedProtocols)
      if (sameSupported && sameProbed) return model
      providerChanged = true
      return {
        ...model,
        ...(supportedProtocols.length > 0 ? { supportedProtocols } : {}),
        ...(probedProtocols.length > 0 ? { probedProtocols } : {})
      }
    })
    if (!providerChanged) return provider
    changed = true
    return { ...provider, models }
  })
  return changed ? { providers } : state
}

export function removeProvider(state: ProviderState, providerId: string): ProviderState {
  return { providers: state.providers.filter((provider) => provider.id !== providerId) }
}

export function setProviderEnabled(state: ProviderState, providerId: string, enabled: boolean): ProviderState {
  return updateProvider(state, providerId, (provider) => ({ ...provider, enabled }))
}

export function addOrUpdateModel(state: ProviderState, providerId: string, model: ModelDefinition): ProviderState {
  if (!model.id.trim() || !model.name.trim()) throw new Error('Model id and name are required.')

  return updateProvider(state, providerId, (provider) => {
    const normalizedInput = normalizeModel(model)
    const normalizedModel = normalizedInput
      ? withModelSupportedProtocols(
        withModelChatProtocol(normalizedInput, provider.endpoints[0]?.protocol),
        provider.endpoints[0]?.protocol
      )
      : null
    if (!normalizedModel) throw new Error('Model id and name are required.')
    const existingIndex = provider.models.findIndex((item) => item.id === normalizedModel.id)
    if (existingIndex >= 0) {
      const previous = provider.models[existingIndex]
      // PLAT-82：协议支持集合是「厂商声明 ∪ 实际可用」，只增不减 ——
      // 抽屉回写没带它时必须保留旧值，换了 `chatProtocol` 时把新协议并进去。
      const supportedProtocols = normalizeModelSupportedProtocols([
        ...(previous.supportedProtocols ?? []),
        ...(normalizedModel.supportedProtocols ?? []),
        ...(resolveModelCapabilities(normalizedModel).chat && normalizedModel.chatProtocol
          ? [normalizedModel.chatProtocol]
          : [])
      ])
      // 检测证据（实测通过）只增不减：抽屉回写没带它时必须保留旧值。
      const probedProtocols = normalizeModelSupportedProtocols([
        ...(previous.probedProtocols ?? []),
        ...(normalizedModel.probedProtocols ?? [])
      ])
      // 厂商声明集合只增不减，且**不**并默认端点/chatProtocol。
      const declaredProtocols = normalizeModelSupportedProtocols([
        ...(previous.declaredProtocols ?? []),
        ...(normalizedModel.declaredProtocols ?? []),
        ...(deriveDeclaredProtocols({
          messagesSupport: normalizedModel.messagesSupport ?? previous.messagesSupport,
          responsesSupport: normalizedModel.responsesSupport ?? previous.responsesSupport
        }) ?? [])
      ])
      // 用户在模型抽屉里改能力/协议时，**探测证据必须保留**：
      // 之前是整体覆盖，导致"编辑一下协议，回到列表就变回未验证"。
      const merged: ModelDefinition = {
        ...normalizedModel,
        ...(normalizedModel.messagesSupport ? {} : previous.messagesSupport ? { messagesSupport: previous.messagesSupport } : {}),
        ...(supportedProtocols ? { supportedProtocols } : {}),
        ...(declaredProtocols ? { declaredProtocols } : {}),
        ...(probedProtocols ? { probedProtocols } : {}),
        ...(normalizedModel.protocolProbedAt ? {} : previous.protocolProbedAt ? { protocolProbedAt: previous.protocolProbedAt } : {}),
        ...(normalizedModel.probeStatus ? {} : previous.probeStatus ? { probeStatus: previous.probeStatus } : {}),
        ...(normalizedModel.probeReason ? {} : previous.probeReason ? { probeReason: previous.probeReason } : {}),
        ...(normalizedModel.presetModel ? { presetModel: true } : previous.presetModel ? { presetModel: true } : {}),
        ...(normalizedModel.presetStale || previous.presetStale ? { presetStale: true } : {})
      }
      return {
        ...provider,
        ...withoutTombstone(provider, normalizedModel.id),
        models: provider.models.map((item, index) => (index === existingIndex ? merged : item))
      }
    }

    return {
      ...provider,
      ...withoutTombstone(provider, normalizedModel.id),
      models: [...provider.models, normalizedModel]
    }
  })
}

/** 用户显式加回一个曾被删除的预设模型 ⇒ 撤掉墓碑，否则下次合并又会把它删掉。 */
function withoutTombstone(provider: ModelProvider, modelId: string): Partial<Pick<ModelProvider, 'removedPresetModelIds'>> {
  const tombstones = provider.removedPresetModelIds
  if (!tombstones?.includes(modelId)) return {}
  const remaining = tombstones.filter((id) => id !== modelId)
  return { removedPresetModelIds: remaining.length > 0 ? remaining : undefined }
}

export function removeModel(state: ProviderState, providerId: string, modelId: string): ProviderState {
  return updateProvider(state, providerId, (provider) => {
    const target = provider.models.find((model) => model.id === modelId)
    // 预设模型要留墓碑：否则下一次合并预设会把它重新注入（用户重启后"又被加回来"）。
    const tombstones = target && isProviderPresetModel(target)
      ? Array.from(new Set([...(provider.removedPresetModelIds ?? []), modelId]))
      : provider.removedPresetModelIds
    return {
      ...provider,
      models: provider.models.filter((model) => model.id !== modelId),
      ...(tombstones && tombstones.length > 0 ? { removedPresetModelIds: tombstones } : {}),
      defaultChatModelId: provider.defaultChatModelId === modelId ? undefined : provider.defaultChatModelId
    }
  })
}

export function setDefaultChatModel(state: ProviderState, providerId: string, modelId: string): ProviderState {
  return updateProvider(state, providerId, (provider) => {
    if (!modelId) {
      return {
        ...provider,
        defaultChatModelId: undefined
      }
    }

    const model = provider.models.find((item) => item.id === modelId)
    if (!model) throw new Error(`Model "${modelId}" was not found.`)
    if (!resolveModelCapabilities(model).chat) throw new Error(`Model "${modelId}" must be chat-capable before it can be the default.`)
    return {
      ...provider,
      defaultChatModelId: model.id
    }
  })
}

export function createProviderStore(storage?: ProviderStorage, vault?: SecretVault): ProviderStore {
  let state: ProviderState | null = null
  let secretOrphans: ProviderSecretOrphan[] = []
  let orphanJournalOverCapacity = false
  let mutationQueue = Promise.resolve()
  let loading: Promise<ProviderState> | null = null

  function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation, operation)
    mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  function runMutation<T>(operation: () => Promise<T>, input: { secretChanging?: boolean } = {}): Promise<T> {
    return enqueueMutation(async () => {
      await load()
      if (!orphanJournalOverCapacity) await cleanupRecordedProviderSecretOrphans()
      if (input.secretChanging && (orphanJournalOverCapacity || secretOrphans.length >= ProviderOrphanJournalPolicy.maxEntries)) {
        throw new ProviderSecretError('provider-secret-orphan-journal-full')
      }
      return operation()
    })
  }

  async function load(): Promise<ProviderState> {
    if (state) return state
    if (!loading) loading = loadInitial().catch((error) => {
      loading = null
      throw error
    })
    return loading
  }

  async function loadInitial(): Promise<ProviderState> {
    if (!storage) {
      state = createDefaultProviderState()
      return state
    }

    const rawPersisted = await storage.read()
    // PLAT-78：版本 gate —— 库里的预设版本与当前一致就**完全不合并**，也就不会触发回写。
    // 只对**支持版本号的存储**（SQLite）生效：没有 `readMeta` 的存储记不住版本，
    // 强行写也没意义（会变成每次启动都"合并 + 回写"），因此保持旧行为。
    const versionedStorage = typeof storage.readMeta === 'function'
    const presetVersion = systemPresetsVersion()
    const storedPresetVersion = versionedStorage
      ? await storage.readMeta!(ProviderPresetVersionMetaKey).catch(() => undefined)
      : undefined
    const mergePresets = !versionedStorage || storedPresetVersion !== presetVersion
    // T4/T5：旧模型没有 `chatProtocol` ⇒ 归一化时按当时的供应商默认端点回填，并**落库一次**；
    // 之后它就是模型自己的事实，不再随默认端点变化（不能只靠预设版本变化触发写入）。
    const modelChatProtocolBackfillRequired = needsModelChatProtocolBackfill(rawPersisted)
    // PLAT-82：旧模型没有 `supportedProtocols` ⇒ 回填一次并落库（之后它就是模型自己的事实）。
    const modelSupportedProtocolsBackfillRequired = needsModelSupportedProtocolsBackfill(rawPersisted)
    const persisted = currentProviderState(normalizeProviderState(rawPersisted, { mergePresets }))
    secretOrphans = normalizeProviderSecretOrphans(rawPersisted, persisted)
    orphanJournalOverCapacity = secretOrphans.length > ProviderOrphanJournalPolicy.maxEntries
    state = persisted
    const orphanMetadataWriteRequired = await cleanupRecordedProviderSecretOrphans({ persist: false })
    const hydrated = await hydrateProviderSecretCiphertextPresence(persisted.providers, vault)
    if (mergePresets && versionedStorage) {
      // 合并过一次 ⇒ 状态 + 版本号写在**同一次**写入里（SQLite 实现保证单事务）。
      await writeMetadata({ providers: hydrated }, { [ProviderPresetVersionMetaKey]: presetVersion })
    } else if (orphanMetadataWriteRequired || modelChatProtocolBackfillRequired || modelSupportedProtocolsBackfillRequired) {
      await writeMetadata({ providers: hydrated })
    }
    state = { providers: hydrated }
    return state
  }

  async function save(nextState: ProviderState): Promise<ProviderState> {
    await writeMetadata(nextState)
    state = nextState
    return nextState
  }

  async function writeMetadata(
    nextState: ProviderState,
    meta?: Readonly<Record<string, unknown>>
  ): Promise<void> {
    if (!storage) return
    try {
      await storage.write(
        toPersistedProviderState(nextState, secretOrphans),
        meta ? { meta } : undefined
      )
    } catch {
      throw new ProviderSecretError('provider-secret-metadata-write-failed')
    }
  }

  async function saveWithInput(nextState: ProviderState, input: ModelProviderInput): Promise<ProviderState> {
    const nextProvider = findProvider(nextState, input.id)
    const existingProvider = state?.providers.find((provider) => provider.id === input.id)
    if (input.apiKey === undefined) return save(nextState)

    const apiKey = input.apiKey.trim()
    if (!apiKey) {
      const clearedProvider = clearProviderSecret(nextProvider)
      const clearedState = replaceProvider(nextState, clearedProvider)
      await saveWithRecordedOrphan(clearedState, existingProvider ?? nextProvider)
      return clearedState
    }

    const vaultedProvider = await writeProviderSecret(nextProvider, apiKey, vault)
    const vaultedState = replaceProvider(nextState, vaultedProvider)
    await saveWithRecordedOrphan(
      vaultedState,
      existingProvider?.apiKeyRef === vaultedProvider.apiKeyRef ? undefined : existingProvider
    )
    return vaultedState
  }

  async function updateAndReturn(providerId: string, updater: (state: ProviderState) => ProviderState): Promise<SafeModelProvider> {
    const nextState = await save(updater(await load()))
    const provider = findProvider(nextState, providerId)
    return toSafeProvider(provider)
  }

  async function resolveRuntimeProvider(providerId: string): Promise<ModelProvider | null> {
    const provider = (await load()).providers.find((item) => item.id === providerId)
    if (!provider || !provider.apiKeyRef) return provider ?? null

    try {
      const apiKey = await readProviderSecret(provider, vault)
      if (!apiKey) {
        const unavailableProvider = { ...provider, apiKeyAvailability: 'unavailable' as const }
        state = replaceProvider(await load(), unavailableProvider)
        return unavailableProvider
      }
      const availableProvider = { ...provider, apiKeyAvailability: 'available' as const }
      state = replaceProvider(await load(), availableProvider)
      return { ...availableProvider, apiKey }
    } catch (error) {
      if (!(error instanceof ProviderSecretError)) throw error
      const unavailableProvider = { ...provider, apiKeyAvailability: 'unavailable' as const }
      state = replaceProvider(await load(), unavailableProvider)
      return unavailableProvider
    }
  }

  const getState = Object.assign(load, { resolveRuntimeProvider })

  return {
    getState,
    resolveRuntimeProvider,
    async list() {
      return (await load()).providers.map(toSafeProvider)
    },
    async upsert(provider) {
      const nextState = await runMutation(
        async () => saveWithInput(upsertProvider(await load(), provider), provider),
        { secretChanging: provider.apiKey !== undefined }
      )
      return toSafeProvider(findProvider(nextState, provider.id))
    },
    async remove(providerId) {
      const nextState = await runMutation(async () => {
        const current = await load()
        const provider = findProvider(current, providerId)
        const updated = removeProvider(current, providerId)
        await saveWithRecordedOrphan(updated, provider)
        return updated
      }, { secretChanging: true })
      return nextState.providers.map(toSafeProvider)
    },
    setEnabled(providerId, enabled) {
      return runMutation(() => updateAndReturn(providerId, (current) => setProviderEnabled(current, providerId, enabled)))
    },
    addOrUpdateModel(providerId, model) {
      return runMutation(() => updateAndReturn(providerId, (current) => addOrUpdateModel(current, providerId, model)))
    },
    async recordProbedProtocols(providerId, updates) {
      // 一次 run 一次写入（不逐模型写）；没有新增内容时连写都不发。
      await runMutation(async () => {
        const current = await load()
        const next = applyProbedProtocols(current, providerId, updates)
        if (next === current) return undefined
        await save(next)
        return undefined
      })
    },
    removeModel(providerId, modelId) {
      return runMutation(() => updateAndReturn(providerId, (current) => removeModel(current, providerId, modelId)))
    },
    setDefaultChatModel(providerId, modelId) {
      return runMutation(() => updateAndReturn(providerId, (current) => setDefaultChatModel(current, providerId, modelId)))
    },
    applyModelSync(providerId, plan) {
      return runMutation(() => updateAndReturn(providerId, (current) => applyModelSyncPlan(current, providerId, plan)))
    },
    async revealApiKey(providerId) {
      const provider = findProvider(await load(), providerId)
      const runtimeKey = firstNonEmptySecret([provider.apiKey])
      if (runtimeKey) return runtimeKey
      return firstNonEmptySecret([provider.apiKeyRef ? await readProviderSecret(provider, vault) : null])
    },
    setCustomHeaders(providerId, headers) {
      return runMutation(() => updateAndReturn(providerId, (current) => ({
        ...current,
        providers: current.providers.map((provider) => {
          if (provider.id !== providerId) return provider
          const next = normalizeCustomHeaders(headers) ?? []
          const previous = provider.customHeaders ?? []
          const merged = next.map((header) => {
            if (header.value !== '••••') return header
            const existing = previous.find((item) => item.name.toLowerCase() === header.name.toLowerCase())
            return existing ? { ...header, value: existing.value } : header
          })
          return { ...provider, customHeaders: merged.length > 0 ? merged : undefined }
        })
      })))
    },
    async revealCustomHeaders(providerId) {
      const provider = findProvider(await load(), providerId)
      return (provider.customHeaders ?? []).map((header) => ({ ...header }))
    }
  }

  async function saveWithRecordedOrphan(nextState: ProviderState, obsoleteProvider?: ModelProvider): Promise<void> {
    const previousOrphans = secretOrphans
    if (obsoleteProvider?.apiKeyRef) {
      const nextOrphans = appendProviderSecretOrphan(secretOrphans, obsoleteProvider)
      if (nextOrphans.length > ProviderOrphanJournalPolicy.maxEntries) {
        throw new ProviderSecretError('provider-secret-orphan-journal-full')
      }
      secretOrphans = nextOrphans
    }
    try {
      await save(nextState)
    } catch (error) {
      secretOrphans = previousOrphans
      throw error
    }
    await cleanupRecordedProviderSecretOrphans()
  }

  async function cleanupRecordedProviderSecretOrphans(input: { persist?: boolean } = {}): Promise<boolean> {
    if (!secretOrphans.length || !state) return false
    const referencedRefs = new Set(state.providers.flatMap((provider) => provider.apiKeyRef ? [provider.apiKeyRef] : []))
    const remaining: ProviderSecretOrphan[] = []
    const cleanupBatch = secretOrphans.slice(0, ProviderOrphanJournalPolicy.maxEntries)
    const deferred = secretOrphans.slice(ProviderOrphanJournalPolicy.maxEntries)
    for (const orphan of cleanupBatch) {
      if (referencedRefs.has(orphan.ref) || !isProviderSecretRef(orphan.providerId, orphan.ref)) {
        remaining.push(orphan)
        continue
      }
      try {
        await deleteProviderSecret({ ...findProviderOrPlaceholder(state, orphan.providerId), apiKeyRef: orphan.ref }, vault)
      } catch {
        remaining.push(orphan)
      }
    }
    const nextOrphans = [...remaining, ...deferred]
    orphanJournalOverCapacity = nextOrphans.length > ProviderOrphanJournalPolicy.maxEntries
    if (orphanJournalOverCapacity) {
      secretOrphans = nextOrphans
      return false
    }
    if (nextOrphans.length !== secretOrphans.length) {
      secretOrphans = nextOrphans
      if (input.persist !== false) {
        try {
          await writeMetadata(state)
        } catch {
          // The secret has already been deleted; retain the in-memory record for this process.
        }
      }
      return true
    }
    return false
  }
}

/**
 * T4/T5 迁移检测：持久化数据里是否存在"聊天模型但没写协议"的记录。
 * 只有这种旧数据才需要在加载时回填并写库一次。
 */
function needsModelChatProtocolBackfill(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const providers = (value as { providers?: unknown }).providers
  if (!Array.isArray(providers)) return false
  return providers.some((provider) => {
    const models = (provider as { models?: unknown })?.models
    if (!Array.isArray(models)) return false
    return models.some((model) => {
      if (!model || typeof model !== 'object') return false
      const definition = model as Partial<ModelDefinition>
      if (normalizeModelChatProtocol(definition.chatProtocol)) return false
      if (!definition.capabilities || typeof definition.id !== 'string') return false
      return resolveModelCapabilities(definition as Pick<ModelDefinition, 'id' | 'capabilities'>).chat
    })
  })
}

/** PLAT-82：任何聊天模型缺 `supportedProtocols` ⇒ 需要回填一次并落库。 */
function needsModelSupportedProtocolsBackfill(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const providers = (value as { providers?: unknown }).providers
  if (!Array.isArray(providers)) return false
  return providers.some((provider) => {
    const models = (provider as { models?: unknown })?.models
    if (!Array.isArray(models)) return false
    return models.some((model) => {
      if (!model || typeof model !== 'object') return false
      const definition = model as Partial<ModelDefinition>
      if (normalizeModelSupportedProtocols(definition.supportedProtocols)?.length) return false
      if (!definition.capabilities || typeof definition.id !== 'string') return false
      return resolveModelCapabilities(definition as Pick<ModelDefinition, 'id' | 'capabilities'>).chat
    })
  })
}

async function hydrateProviderSecretCiphertextPresence(providers: ModelProvider[], vault?: SecretVault): Promise<ModelProvider[]> {
  return Promise.all(providers.map(async (provider) => {
    if (!provider.apiKeyRef) return { ...provider, apiKeyAvailability: undefined }
    if (!vault) return { ...provider, apiKeyAvailability: 'unavailable' as const }
    try {
      return {
        ...provider,
        apiKeyAvailability: await vault.exists(provider.apiKeyRef, ProviderSecretMetadataPolicy.owner)
          ? 'unverified' as const
          : 'unavailable' as const
      }
    } catch {
      return { ...provider, apiKeyAvailability: 'unavailable' as const }
    }
  }))
}

async function writeProviderSecret(provider: ModelProvider, apiKey: string, vault?: SecretVault): Promise<ModelProvider> {
  if (!vault) throw new ProviderSecretError(ProviderVaultUnavailablePolicy.errorCode)
  let ref = provider.apiKeyRef ?? providerSecretRef(provider.id)
  try {
    const existing = await vault.get(ref, ProviderSecretMetadataPolicy.owner)
    if (existing === null) {
      await vault.put({ owner: ProviderSecretMetadataPolicy.owner, ref, value: apiKey })
    } else if (existing !== apiKey) {
      if (provider.apiKeyRef) ref = nextProviderSecretRef(provider.id, provider.apiKeyRef)
      const replacement = await vault.get(ref, ProviderSecretMetadataPolicy.owner)
      if (replacement === null) {
        await vault.put({ owner: ProviderSecretMetadataPolicy.owner, ref, value: apiKey })
      } else if (replacement !== apiKey) {
        await vault.rotate(ref, ProviderSecretMetadataPolicy.owner, apiKey)
      }
    }
  } catch (error) {
    if (error instanceof SecretVaultError) throw new ProviderSecretError(ProviderVaultUnavailablePolicy.errorCode)
    throw new ProviderSecretError('provider-secret-vault-write-failed')
  }

  return {
    ...provider,
    apiKey: undefined,
    apiKeyRef: ref,
    apiKeyAvailability: 'unverified',
    apiKeyPreview: maskSecret(apiKey),
    apiKeyMigrationState: ProviderSecretMetadataPolicy.migrationState,
    apiKeyStorageVersion: ProviderSecretMetadataPolicy.storageVersion
  }
}

async function readProviderSecret(provider: ModelProvider, vault?: SecretVault): Promise<string | null> {
  if (!vault || !provider.apiKeyRef) throw new ProviderSecretError(ProviderVaultUnavailablePolicy.errorCode)
  try {
    return await vault.get(provider.apiKeyRef, ProviderSecretMetadataPolicy.owner)
  } catch (error) {
    if (error instanceof SecretVaultError) throw new ProviderSecretError(ProviderVaultUnavailablePolicy.errorCode)
    throw new ProviderSecretError('provider-secret-vault-write-failed')
  }
}

/** PLAT-58 只读 reveal 的取值口径：跳过空白候选，返回第一条非空凭据。 */
function firstNonEmptySecret(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : ''
    if (value) return value
  }
  return null
}

async function deleteProviderSecret(provider: ModelProvider, vault?: SecretVault): Promise<void> {
  if (!provider.apiKeyRef) return
  if (!vault) throw new ProviderSecretError(ProviderVaultUnavailablePolicy.errorCode)
  try {
    await vault.delete(provider.apiKeyRef, ProviderSecretMetadataPolicy.owner)
  } catch (error) {
    if (error instanceof SecretVaultError) throw new ProviderSecretError(ProviderVaultUnavailablePolicy.errorCode)
    throw new ProviderSecretError('provider-secret-vault-write-failed')
  }
}

function clearProviderSecret(provider: ModelProvider): ModelProvider {
  return {
    ...provider,
    apiKey: undefined,
    apiKeyRef: undefined,
    apiKeyAvailability: undefined,
    apiKeyPreview: '',
    apiKeyMigrationState: undefined,
    apiKeyStorageVersion: undefined
  }
}

function replaceProvider(state: ProviderState, provider: ModelProvider): ProviderState {
  return {
    providers: state.providers.map((item) => (item.id === provider.id ? provider : item))
  }
}

function toPersistedProviderState(state: ProviderState, secretOrphans: ProviderSecretOrphan[]): PersistedProviderState {
  return {
    providers: state.providers.map(toPersistedProvider),
    ...(secretOrphans.length ? { [ProviderOrphanJournalPolicy.field]: secretOrphans } : {})
  }
}

function normalizeProviderSecretOrphans(value: unknown, _state: ProviderState): ProviderSecretOrphan[] {
  if (!value || typeof value !== 'object') return []
  const candidates = (value as { secretOrphans?: unknown }).secretOrphans
  if (!Array.isArray(candidates)) return []
  const seen = new Set<string>()
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const providerId = typeof (candidate as ProviderSecretOrphan).providerId === 'string'
      ? (candidate as ProviderSecretOrphan).providerId
      : ''
    const ref = typeof (candidate as ProviderSecretOrphan).ref === 'string'
      ? (candidate as ProviderSecretOrphan).ref
      : ''
    const key = `${providerId}\u0000${ref}`
    if (!isProviderSecretRef(providerId, ref) || seen.has(key)) return []
    seen.add(key)
    return [{ providerId, ref }]
  })
}

function appendProviderSecretOrphan(
  secretOrphans: ProviderSecretOrphan[],
  provider: Pick<ModelProvider, 'id' | 'apiKeyRef'>
): ProviderSecretOrphan[] {
  if (!provider.apiKeyRef || !isProviderSecretRef(provider.id, provider.apiKeyRef)) return secretOrphans
  if (secretOrphans.some((orphan) => orphan.providerId === provider.id && orphan.ref === provider.apiKeyRef)) {
    return secretOrphans
  }
  return [...secretOrphans, { providerId: provider.id, ref: provider.apiKeyRef }]
}

function findProviderOrPlaceholder(state: ProviderState, providerId: string): ModelProvider {
  return state.providers.find((provider) => provider.id === providerId) ?? {
    id: providerId,
    name: providerId,
    endpoints: [],
    enabled: false,
    baseUrl: '',
    models: []
  }
}

function toPersistedProvider(provider: ModelProvider): PersistedModelProvider {
  const {
    apiKey: _apiKey,
    apiKeyAvailability: _apiKeyAvailability,
    apiKeyRef,
    apiKeyPreview,
    apiKeyMigrationState,
    apiKeyStorageVersion,
    ...metadata
  } = provider
  return {
    ...metadata,
    ...(apiKeyRef ? { apiKeyRef } : {}),
    ...(apiKeyPreview ? { apiKeyPreview } : {}),
    ...(apiKeyMigrationState ? { apiKeyMigrationState } : {}),
    ...(apiKeyStorageVersion ? { apiKeyStorageVersion } : {})
  }
}

function providerSecretRef(providerId: string): string {
  return `provider:${encodeProviderId(providerId)}`
}

function nextProviderSecretRef(providerId: string, currentRef: string): string {
  const baseRef = providerSecretRef(providerId)
  const currentGeneration = currentRef.startsWith(`${baseRef}:${ProviderSecretRotationPolicy.generationPrefix}`)
    ? Number.parseInt(currentRef.slice(`${baseRef}:${ProviderSecretRotationPolicy.generationPrefix}`.length), 10)
    : 0
  const nextGeneration = Number.isSafeInteger(currentGeneration) && currentGeneration >= 0
    ? currentGeneration + 1
    : ProviderSecretRotationPolicy.firstGeneration
  return `${baseRef}:${ProviderSecretRotationPolicy.generationPrefix}${nextGeneration}`
}

function isProviderSecretRef(providerId: string, ref: string): boolean {
  const baseRef = providerSecretRef(providerId)
  if (ref === baseRef) return true
  const generation = ref.slice(`${baseRef}:${ProviderSecretRotationPolicy.generationPrefix}`.length)
  return ref.startsWith(`${baseRef}:${ProviderSecretRotationPolicy.generationPrefix}`) && /^[1-9]\d*$/.test(generation)
}

function encodeProviderId(providerId: string): string {
  return Array.from(new TextEncoder().encode(providerId), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function updateProvider(state: ProviderState, providerId: string, updater: (provider: ModelProvider) => ModelProvider): ProviderState {
  const provider = findProvider(state, providerId)
  return {
    providers: state.providers.map((item) => (item.id === providerId ? updater(provider) : item))
  }
}

function findProvider(state: ProviderState, providerId: string): ModelProvider {
  const provider = state.providers.find((item) => item.id === providerId)
  if (!provider) throw new Error(`Provider "${providerId}" was not found.`)
  return provider
}

function currentProviderState(state: ProviderState): ProviderState {
  return {
    providers: state.providers.map((provider) => provider.apiKey === undefined
      ? provider
      : {
          ...provider,
          apiKey: undefined,
          ...(ProviderCurrentFormatPolicy.retainsVaultMetadata(provider) ? {} : {
            apiKeyPreview: undefined,
            apiKeyAvailability: undefined,
            apiKeyRef: undefined,
            apiKeyMigrationState: undefined,
            apiKeyStorageVersion: undefined
          })
        })
  }
}

function normalizeCustomHeaders(value: unknown): ProviderCustomHeader[] | undefined {
  if (!Array.isArray(value)) return undefined
  const headers = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const header = item as Partial<ProviderCustomHeader>
      const name = typeof header.name === 'string' ? header.name.trim() : ''
      const headerValue = typeof header.value === 'string' ? header.value : ''
      if (!name || /[\r\n]/.test(headerValue)) return null
      return { name, value: headerValue }
    })
    .filter((header): header is ProviderCustomHeader => header !== null)
  return headers.length > 0 ? headers : undefined
}

/**
 * 域对象进入内存前的唯一归一入口：字段校验 + 端点清单归一（`endpoints` / `imageEndpoints`）
 * + `baseUrl` 派生 + 模型协议补全。
 */
function normalizeProvider(value: Partial<ModelProvider> | unknown): ModelProvider | null {
  if (!value || typeof value !== 'object') return null
  const provider = value as Partial<ModelProvider>
  const id = typeof provider.id === 'string' ? provider.id.trim() : ''
  const name = typeof provider.name === 'string' ? provider.name.trim() : ''
  if (!id || !name) return null
  const apiKeyRef = typeof provider.apiKeyRef === 'string' && isProviderSecretRef(id, provider.apiKeyRef.trim())
    ? provider.apiKeyRef.trim()
    : undefined
  // 端点清单归一：`[0]` = 默认端点；非法协议/重复项丢弃，空串保留（= 已声明未配置）。
  const endpoints = normalizeProviderChatEndpoints(provider.endpoints)
  const providerDefaultProtocol = endpoints[0]?.protocol
  // 主地址由端点派生（唯一口径），不再作为独立可写字段存在。
  const baseUrl = resolveProviderPrimaryBase({ endpoints })

  return {
    id,
    name,
    endpoints,
    // 端点墓碑：只保留合法协议、去重、固定顺序；空 ⇒ 缺省（无墓碑）。
    removedEndpointProtocols: normalizeModelSupportedProtocols(provider.removedEndpointProtocols),
    imageEndpoints: normalizeProviderImageEndpoints(provider.imageEndpoints),
    enabled: Boolean(provider.enabled),
    baseUrl,
    customHeaders: normalizeCustomHeaders(provider.customHeaders),
    apiKey: typeof provider.apiKey === 'string' ? provider.apiKey.trim() : undefined,
    apiKeyRef,
    apiKeyAvailability: provider.apiKeyAvailability === 'unverified' || provider.apiKeyAvailability === 'available' || provider.apiKeyAvailability === 'unavailable'
      ? provider.apiKeyAvailability
      : undefined,
    apiKeyPreview: normalizePersistedSecretPreview(provider.apiKeyPreview),
    apiKeyMigrationState: apiKeyRef && provider.apiKeyMigrationState === ProviderSecretMetadataPolicy.migrationState
      ? ProviderSecretMetadataPolicy.migrationState
      : undefined,
    apiKeyStorageVersion: apiKeyRef && provider.apiKeyStorageVersion === ProviderSecretMetadataPolicy.storageVersion
      ? ProviderSecretMetadataPolicy.storageVersion
      : undefined,
    isSystem: Boolean(provider.isSystem || isSystemProviderId(id)),
    websites: normalizeWebsites(provider.websites),
    models: Array.isArray(provider.models)
      ? provider.models
        .map(normalizeModel)
        .filter(isModelDefinition)
        .map(normalizeLegacyModelCapabilities)
        // T4/T5：旧数据 / 新增时没写协议的模型，在这里按**当前**供应商默认端点回填一次快照。
        .map((model) => withModelChatProtocol(model, providerDefaultProtocol))
        // PLAT-82：协议支持集合缺失时按「模型协议 ∪ 供应商默认端点 ∪ 已声明 messages/responses」回填一次。
        .map((model) => withModelSupportedProtocols(model, providerDefaultProtocol))
      : [],
    defaultChatModelId: typeof provider.defaultChatModelId === 'string' ? provider.defaultChatModelId : undefined,
    ...(Array.isArray(provider.removedPresetModelIds)
      ? {
          removedPresetModelIds: Array.from(
            new Set(
              provider.removedPresetModelIds.filter(
                (id): id is string => typeof id === 'string' && id.trim().length > 0
              ).map((id) => id.trim())
            )
          )
        }
      : {})
  }
}

/** T4/T5：模型协议缺失时用供应商默认端点（`endpoints[0]`）补一次（只对聊天模型；不覆盖已有协议）。 */
function withModelChatProtocol(
  model: ModelDefinition,
  providerDefaultProtocol: ModelChatProtocol | undefined
): ModelDefinition {
  if (model.chatProtocol) return model
  if (!resolveModelCapabilities(model).chat) return model
  return { ...model, chatProtocol: providerDefaultProtocol ?? 'chat-completions' }
}

/**
 * PLAT-82：协议支持集合缺失时回填一次（只对聊天模型；已有值不覆盖）。
 *
 * 口径 = `[供应商默认端点协议] ∪ [模型自己的 chatProtocol] ∪ [厂商声明的 messages/responses]`。
 * 用 chatProtocol **反推**会漏掉「声明了 responses 但默认端点仍是 chat」的模型，
 * 所以默认端点协议也并进来。
 */
function withModelSupportedProtocols(
  model: ModelDefinition,
  providerDefaultProtocol: ModelChatProtocol | undefined
): ModelDefinition {
  return applyProtocolSets(model, providerDefaultProtocol)
}

function normalizeLegacyModelCapabilities(model: ModelDefinition): ModelDefinition {
  if (!isNonChatModelId(model.id)) return model
  if (model.capabilities.capabilitiesEdited) return model
  const inferred = resolveModelCapabilities(model)
  return {
    ...model,
    capabilities: {
      ...inferred,
      ...(model.capabilities.agentRuntimes ? { agentRuntimes: { ...model.capabilities.agentRuntimes } } : {})
    }
  }
}

function normalizePersistedSecretPreview(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const preview = value.trim()
  return ProviderSecretPreviewPolicy.isSafePreview(preview) ? upgradeSecretPreview(preview) : undefined
}

function normalizeWebsites(websites: unknown): ModelProvider['websites'] {
  if (!websites || typeof websites !== 'object') return undefined
  const candidate = websites as ModelProvider['websites']
  return {
    official: typeof candidate?.official === 'string' ? candidate.official.trim() : undefined,
    apiKey: typeof candidate?.apiKey === 'string' ? candidate.apiKey.trim() : undefined,
    docs: typeof candidate?.docs === 'string' ? candidate.docs.trim() : undefined,
    models: typeof candidate?.models === 'string' ? candidate.models.trim() : undefined
  }
}

function normalizeModel(model: unknown): ModelDefinition | null {
  if (!model || typeof model !== 'object') return null
  const candidate = model as Partial<ModelDefinition>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  if (!id || !name) return null

  return withModelPriceTag({
    id,
    name,
    group: typeof candidate.group === 'string' ? candidate.group.trim() : undefined,
    provider: typeof candidate.provider === 'string' ? candidate.provider.trim() : undefined,
    capabilities: normalizeModelCapabilities(candidate.capabilities),
    ...(typeof candidate.contextLength === 'number' && Number.isFinite(candidate.contextLength)
      ? { contextLength: candidate.contextLength }
      : {}),
    ...(typeof candidate.maxCompletionTokens === 'number' && Number.isFinite(candidate.maxCompletionTokens)
      ? { maxCompletionTokens: candidate.maxCompletionTokens }
      : {}),
    ...(candidate.pricing && typeof candidate.pricing === 'object'
      ? {
          pricing: {
            currency: String(candidate.pricing.currency ?? ''),
            promptPerMillion: Number(candidate.pricing.promptPerMillion),
            completionPerMillion: Number(candidate.pricing.completionPerMillion),
            ...(typeof candidate.pricing.cacheReadPerMillion === 'number'
              ? { cacheReadPerMillion: candidate.pricing.cacheReadPerMillion }
              : {}),
            ...(typeof candidate.pricing.displayPrecision === 'number'
              ? { displayPrecision: candidate.pricing.displayPrecision }
              : {}),
            ...(candidate.pricing.hasDiscount === true ? { hasDiscount: true } : {})
          }
        }
      : {}),
    // 用户手动标记免费：只存 true，关闭即删除（缺省 = 按价格自动判定）。
    ...(candidate.freeOverride === true ? { freeOverride: true } : {}),
    ...(candidate.messagesSupport === 'yes' || candidate.messagesSupport === 'no' || candidate.messagesSupport === 'unknown'
      ? { messagesSupport: candidate.messagesSupport }
      : {}),
    ...(candidate.responsesSupport === 'yes' || candidate.responsesSupport === 'no' || candidate.responsesSupport === 'unknown'
      ? { responsesSupport: candidate.responsesSupport }
      : {}),
    ...(candidate.declarationSource === 'provider_list' ? { declarationSource: 'provider_list' as const } : {}),
    ...(typeof candidate.protocolProbedAt === 'string' && candidate.protocolProbedAt.trim()
      ? { protocolProbedAt: candidate.protocolProbedAt.trim() }
      : {}),
    ...(candidate.probeStatus === 'passed' || candidate.probeStatus === 'failed' || candidate.probeStatus === 'unsupported'
      ? { probeStatus: candidate.probeStatus }
      : {}),
    ...(typeof candidate.probeReason === 'string' && candidate.probeReason.trim()
      ? { probeReason: candidate.probeReason.trim() }
      : {}),
    ...(candidate.providerDeclared === true ? { providerDeclared: true } : {}),
    ...(candidate.presetModel === true ? { presetModel: true } : {}),
    // PLAT-63 C：归档标记必须能 round-trip，否则「保留但不显示」会在下次加载变回普通模型。
    ...(candidate.presetStale === true ? { presetStale: true } : {}),
    // T4/T5：协议选择必须 round-trip；脏值丢弃（宁走默认链路，也不把请求发到错端点）。
    ...(normalizeModelChatProtocol(candidate.chatProtocol)
      ? { chatProtocol: normalizeModelChatProtocol(candidate.chatProtocol) }
      : {}),
    // PLAT-82：协议支持集合 round-trip（缺失 ⇒ 由下方回填；脏值丢弃）。
    ...(normalizeModelSupportedProtocols(candidate.supportedProtocols)
      ? { supportedProtocols: normalizeModelSupportedProtocols(candidate.supportedProtocols) }
      : {}),
    ...(normalizeModelSupportedProtocols(candidate.declaredProtocols)
      ? { declaredProtocols: normalizeModelSupportedProtocols(candidate.declaredProtocols) }
      : {}),
    // PLAT-82：检测证据 round-trip（实测通过的协议；脏值丢弃，失败不写）。
    ...(normalizeModelSupportedProtocols(candidate.probedProtocols)
      ? { probedProtocols: normalizeModelSupportedProtocols(candidate.probedProtocols) }
      : {})
  })
}

function isModelDefinition(model: ModelDefinition | null): model is ModelDefinition {
  return model !== null
}
