import type { ModelCapabilities, ModelDefinition, ModelProvider, ProviderState, SafeModelProvider } from './modelProviderTypes'
import { resolveModelCapabilities } from './modelCapabilityInference'
import { normalizeModelCapabilities } from './modelCapabilities'
import { withModelPriceTag } from './modelPriceTag'
import { applyProtocolSets } from './modelProtocolSets'
import {
  classifyHttpFailure,
  classifyProviderTransportFailure,
  type ProviderConnectionFailureCode
} from './providerConnection'
import { ModelListRequestError, listRemoteModels } from './modelList/remoteModelList'
import { resolveModelListShape } from './modelList/modelListShapes'

export type ModelSyncPreviewMissingItem = {
  model: ModelDefinition
  removalReason: 'missing_from_provider'
}

export type ModelSyncPreview = {
  added: ModelDefinition[]
  updated: ModelDefinition[]
  missing: ModelSyncPreviewMissingItem[]
  /**
   * PLAT-63 C：本地多余（预设已变更）——`presetModel && presetStale`。
   * 默认在预览里勾选（应用即清理），但**只有用户确认后**才会通过 `toRemove` 真正删除。
   */
  stale: ModelDefinition[]
}

export type ModelSyncPlan = {
  toAdd: ModelDefinition[]
  toUpdate: ModelDefinition[]
  toRemove: string[]
}

type RemoteModelListOptions = {
  /** 必填：生产注入 Electron `net.fetch`（跟随 session 代理）；禁止回退到全局 fetch。 */
  fetch: typeof fetch
}

export const ProviderModelSyncFailurePolicy = {
  message: 'Model sync failed.'
} as const

/**
 * PLAT-61：模型同步失败的**可判定原因**（不把原始 IPC Error 抛给 UI）。
 * 与连接检查的 code 体系统一：unauthorized / http_<status> / timeout；
 * 同步另加 network / invalid_base_url / provider_disabled / missing_api_key / provider_not_found。
 */
export type ModelSyncFailureReasonCode =
  | ProviderConnectionFailureCode
  | 'provider_disabled'
  | 'invalid_base_url'
  | 'provider_not_found'
  /** PLAT-66：该协议没有 OpenAI 的 `/v1/models`（Gemini 原生）⇒ 不是错误，是能力说明。 */
  | 'model_list_unsupported'
  | 'unknown'

export type ModelSyncFailure = {
  ok: false
  reasonCode: ModelSyncFailureReasonCode
  /** 安全的说明（可能含 HTTP 状态码与上游 message，不含通道名/堆栈）。 */
  message: string
  /** PLAT-61：上游响应体里的错误 message（已脱敏/截断）；主文案 `{原因}：{上游}`。 */
  upstreamMessage?: string
}

/** `ok:true` 时保留既有 `added`/`missing` 字段（向后兼容）。 */
export type ModelSyncPreviewOutcome = ({ ok: true } & ModelSyncPreview) | ModelSyncFailure

export type ModelSyncApplyOutcome =
  | { ok: true, provider: SafeModelProvider }
  | ModelSyncFailure

class ProviderModelSyncError extends Error {
  constructor(
    readonly reasonCode: ModelSyncFailureReasonCode,
    message: string,
    readonly upstreamMessage?: string
  ) {
    super(message)
    this.name = 'ProviderModelSyncError'
  }
}

export function isProviderModelSyncFailure(value: unknown): value is ModelSyncFailure {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false)
}

/** 供 IPC handler 使用：失败不 throw，返回结构化结果（ok:true 保留既有字段）。 */
export async function previewProviderModelSync(
  provider: ModelProvider,
  options: RemoteModelListOptions
): Promise<ModelSyncPreviewOutcome> {
  try {
    const remoteModels = await listRemoteProviderModels(provider, options)
    return { ok: true, ...buildModelSyncPreview(provider, remoteModels) }
  } catch (error) {
    return toModelSyncFailure(error)
  }
}

export function toModelSyncFailure(error: unknown): ModelSyncFailure {
  if (error instanceof ModelListRequestError) {
    return {
      ok: false,
      reasonCode: error.reasonCode,
      message: error.message,
      ...(error.upstreamMessage ? { upstreamMessage: error.upstreamMessage } : {})
    }
  }
  if (error instanceof ProviderModelSyncError) {
    return {
      ok: false,
      reasonCode: error.reasonCode,
      message: error.message,
      ...(error.upstreamMessage ? { upstreamMessage: error.upstreamMessage } : {})
    }
  }
  return { ok: false, reasonCode: mapTransportReason(error), message: ProviderModelSyncFailurePolicy.message }
}

function mapTransportReason(error: unknown): ModelSyncFailureReasonCode {
  // 与连接检查同一套 code；能归类就归类，「未知错误」只留给真正无法判定的情况。
  return classifyProviderTransportFailure(error) ?? 'unknown'
}

export async function listRemoteProviderModels(
  provider: ModelProvider,
  options: RemoteModelListOptions
): Promise<ModelDefinition[]> {
  // PLAT-77：请求细节全部由 modelList 流水线负责（形状见 resolveModelListShape）。
  try {
    return await listRemoteModels(provider, resolveModelListShape(provider), options)
  } catch (error) {
    if (error instanceof ModelListRequestError) {
      throw new ProviderModelSyncError(error.reasonCode, error.message, error.upstreamMessage)
    }
    throw error
  }
}

export function buildModelSyncPreview(provider: ModelProvider, remoteModels: ModelDefinition[]): ModelSyncPreview {
  const localById = new Map(provider.models.map((model) => [model.id, model]))
  const remoteIds = new Set(remoteModels.map((model) => model.id))
  const updated = remoteModels
    .filter((remote) => localById.has(remote.id) && hasDeclaredRemoteFields(remote))
    .map((remote) => buildModelUpdate(localById.get(remote.id)!, remote))
    .filter((model): model is ModelDefinition => model !== null)

  return {
    added: remoteModels.filter((model) => !localById.has(model.id)),
    updated,
    // 归档模型单独成组：既不重复进 missing，也不能被当成"远端缺失"直接清理。
    // 远端已经不列（含被标记 Shutdown）的本地模型：预设模型与**同步来的**模型都提示清理，
    // 但只有用户在预览里勾选确认后才会真正删除；手填模型不动。
    missing: provider.models
      .filter(
        (model) =>
          remoteIds.has(model.id) === false &&
          (isProviderPresetModel(model) || model.providerDeclared === true) &&
          !isStalePresetModel(model)
      )
      .map((model) => ({
        model,
        removalReason: 'missing_from_provider' as const
      })),
    stale: provider.models.filter(isStalePresetModel)
  }
}

/**
 * PLAT-63 C：旧预设模型（`presetModel` + `presetStale`）。
 * 两个标记都要求 —— 同步来的模型没有 `presetModel`，永远进不了这一组。
 */
export function isStalePresetModel(model: ModelDefinition): boolean {
  return isProviderPresetModel(model) && model.presetStale === true
}

/** 远端记录带了任何"上游给的"信息，就可以覆盖本地同名模型（含预设模型）。 */
const CAPABILITY_BITS = [
  'chat',
  'tools',
  'vision',
  'reasoning',
  'embedding',
  'rerank',
  'imageGeneration',
  'videoGeneration',
  'speech',
  'transcription',
  'ocr'
] as const

function hasDeclaredRemoteFields(remote: ModelDefinition): boolean {
  if (remote.providerDeclared === true) return true
  if (remote.contextLength !== undefined) return true
  if (remote.maxCompletionTokens !== undefined) return true
  if (remote.pricing !== undefined) return true
  if (remote.messagesSupport !== undefined) return true
  if (remote.responsesSupport !== undefined) return true
  if (remote.declarationSource !== undefined) return true
  if (remote.supportedProtocols !== undefined) return true
  if (remote.declaredProtocols !== undefined) return true
  return CAPABILITY_BITS.some((key) => typeof remote.capabilities[key] === 'boolean')
}

/**
 * PLAT-77：同步结果**覆盖**本地同名模型——包括预设模型（同一个 id 也照样覆盖）。
 *
 * 仍然守住两条老约束：
 *  - `capabilitiesEdited` = 用户改过能力 ⇒ 能力不动，但上下文/输出/价格这些**事实**照常刷新；
 *  - 用户改过显示名（name 与 id 不同）⇒ 保留用户命名。
 *
 * `providerDeclared` 只在远端真的给了那四个字面字段时才置真（保护 missing 清理组的准入）。
 */
function buildModelUpdate(local: ModelDefinition, remote: ModelDefinition): ModelDefinition | null {
  // 用户显式改过能力 ⇒ 整条不动（保持既有契约：手改过的模型不参与自动更新）。
  if (local.capabilities.capabilitiesEdited === true) return null
  const capabilities: ModelCapabilities = { ...local.capabilities }
  for (const key of CAPABILITY_BITS) {
    const value = remote.capabilities[key]
    if (typeof value === 'boolean') capabilities[key] = value
  }
  const name = local.name === local.id ? remote.name : local.name
  const next: ModelDefinition = {
    ...local,
    name,
    capabilities,
    ...(remote.group === undefined ? {} : { group: remote.group }),
    ...(remote.contextLength === undefined ? {} : { contextLength: remote.contextLength }),
    ...(remote.maxCompletionTokens === undefined ? {} : { maxCompletionTokens: remote.maxCompletionTokens }),
    ...(remote.pricing === undefined ? {} : { pricing: { ...remote.pricing } }),
    ...(remote.messagesSupport === undefined ? {} : { messagesSupport: remote.messagesSupport }),
    ...(remote.responsesSupport === undefined ? {} : { responsesSupport: remote.responsesSupport }),
    ...(remote.declarationSource === undefined ? {} : { declarationSource: remote.declarationSource }),
    ...(remote.supportedProtocols === undefined ? {} : { supportedProtocols: [...remote.supportedProtocols] }),
    ...(remote.declaredProtocols === undefined ? {} : { declaredProtocols: [...remote.declaredProtocols] }),
    ...(remote.probeStatus === undefined ? {} : { probeStatus: remote.probeStatus }),
    ...(remote.probeReason === undefined ? {} : { probeReason: remote.probeReason }),
    ...(remote.protocolProbedAt === undefined ? {} : { protocolProbedAt: remote.protocolProbedAt }),
    ...(remote.providerDeclared === true || local.providerDeclared === true ? { providerDeclared: true } : {})
  }
  const changed =
    next.name !== local.name ||
    next.group !== local.group ||
    next.contextLength !== local.contextLength ||
    next.maxCompletionTokens !== local.maxCompletionTokens ||
    next.messagesSupport !== local.messagesSupport ||
    next.responsesSupport !== local.responsesSupport ||
    next.declarationSource !== local.declarationSource ||
    JSON.stringify(next.supportedProtocols) !== JSON.stringify(local.supportedProtocols) ||
    JSON.stringify(next.declaredProtocols) !== JSON.stringify(local.declaredProtocols) ||
    next.probeStatus !== local.probeStatus ||
    next.probeReason !== local.probeReason ||
    next.providerDeclared !== local.providerDeclared ||
    JSON.stringify(next.capabilities) !== JSON.stringify(local.capabilities) ||
    JSON.stringify(next.pricing) !== JSON.stringify(local.pricing)
  return changed ? next : null
}

export function applyModelSyncPlan(state: ProviderState, providerId: string, plan: ModelSyncPlan): ProviderState {
  const removeIds = new Set(plan.toRemove)
  const addModels = plan.toAdd.map(normalizeSyncedModel)
  const updateById = new Map(
    plan.toUpdate.map(normalizeSyncedModel).map((model) => [model.id, model])
  )

  return {
    providers: state.providers.map((provider) => {
      if (provider.id !== providerId) return provider

      const nextModels = provider.models
        .filter((model) => !removeIds.has(model.id))
        .map((model) => {
          const update = updateById.get(model.id)
          if (!update || model.capabilities.capabilitiesEdited === true) return model
          // T4/T5：`chatProtocol` 是用户在模型抽屉里的显式选择，供应商同步不得覆盖/清空
          //（与 `presetModel` 收敛同一类「别删用户数据」约束）。
          const next = model.chatProtocol ? { ...update, chatProtocol: model.chatProtocol } : update
          // PLAT-82：同步没带支持集合时按「模型协议 ∪ 供应商默认端点 ∪ 声明」补，别把 pill 清空。
          return next.supportedProtocols?.length
            ? next
            : withSupportedProtocols(next, provider)
        })
      const nextModelIds = new Set(nextModels.map((model) => model.id))
      for (const model of addModels) {
        if (!nextModelIds.has(model.id)) {
          // T4/T5：新同步进来的模型把**当前**供应商默认端点快照成自己的协议；
          // 已存在的模型协议不动（见上面的 update 分支）。
          const withProtocol = model.chatProtocol || !resolveModelCapabilities(model).chat
            ? model
            : { ...model, chatProtocol: provider.endpoints[0]?.protocol ?? 'chat-completions' }
          // PLAT-82：新增模型的协议支持集合同样要补齐（旧调用方可能不带该字段）。
          nextModels.push(withSupportedProtocols(withProtocol, provider))
          nextModelIds.add(model.id)
        }
      }

      const defaultChatModelId = nextModels.some((model) => model.id === provider.defaultChatModelId)
        ? provider.defaultChatModelId
        : nextModels.find((model) => resolveModelCapabilities(model).chat)?.id

      // 同步里被移除的**预设模型**同样要留墓碑，否则下次合并预设会把它们加回来
      //（用户在「获取模型列表」里删掉，重启后发现又回来了）。
      const removedPresetHere = provider.models
        .filter((model) => removeIds.has(model.id) && isProviderPresetModel(model))
        .map((model) => model.id)
      // 同一批里被显式加回来的 id 必须撤掉墓碑，否则"清空后重新同步"会在下次加载时被合并逻辑吃掉。
      const addedIds = new Set(addModels.map((model) => model.id))
      const tombstones = removedPresetHere.length > 0
        ? Array.from(new Set([...(provider.removedPresetModelIds ?? []), ...removedPresetHere]))
            .filter((modelId) => !addedIds.has(modelId))
        : (provider.removedPresetModelIds ?? []).filter((modelId) => !addedIds.has(modelId))

      return {
        ...provider,
        models: nextModels,
        // 必须显式覆盖：上面 `...provider` 会带回旧墓碑，空数组要写成 undefined 才能真的撤掉。
        removedPresetModelIds: tombstones.length > 0 ? tombstones : undefined,
        defaultChatModelId
      }
    })
  }
}

export function normalizeModelSyncPlan(value: unknown): ModelSyncPlan {
  const candidate = value && typeof value === 'object' ? (value as Partial<ModelSyncPlan>) : {}
  const toAdd = Array.isArray(candidate.toAdd)
    ? candidate.toAdd.map(normalizeUnknownModel).filter((model): model is ModelDefinition => model !== null)
    : []
  const seenRemovals = new Set<string>()
  const toUpdate = Array.isArray(candidate.toUpdate)
    ? candidate.toUpdate.map(normalizeUnknownModel).filter((model): model is ModelDefinition => model !== null)
    : []
  const toRemove = Array.isArray(candidate.toRemove)
    ? candidate.toRemove
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => {
          if (!item || seenRemovals.has(item)) return false
          seenRemovals.add(item)
          return true
        })
    : []
  return { toAdd, toUpdate, toRemove }
}

function normalizeUnknownModel(value: unknown): ModelDefinition | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ModelDefinition>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  if (!id) return null
  const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : id
  return normalizeSyncedModel({
    id,
    name,
    group: typeof candidate.group === 'string' && candidate.group.trim() ? candidate.group.trim() : undefined,
    provider: typeof candidate.provider === 'string' && candidate.provider.trim() ? candidate.provider.trim() : undefined,
    capabilities: normalizeModelCapabilities(candidate.capabilities),
    ...(candidate.messagesSupport ? { messagesSupport: candidate.messagesSupport } : {}),
    ...(candidate.responsesSupport ? { responsesSupport: candidate.responsesSupport } : {}),
    ...(candidate.declarationSource ? { declarationSource: candidate.declarationSource } : {}),
    ...(candidate.supportedProtocols ? { supportedProtocols: [...candidate.supportedProtocols] } : {}),
    ...(candidate.declaredProtocols ? { declaredProtocols: [...candidate.declaredProtocols] } : {}),
    ...(candidate.protocolProbedAt ? { protocolProbedAt: candidate.protocolProbedAt } : {}),
    ...(candidate.probeStatus ? { probeStatus: candidate.probeStatus } : {}),
    ...(candidate.probeReason ? { probeReason: candidate.probeReason } : {}),
    ...(candidate.providerDeclared === true ? { providerDeclared: true } : {}),
    // 用户手动标记免费：同步计划经过 IPC 往返时不能丢，否则一次同步就把标记抹掉。
    ...(candidate.freeOverride === true ? { freeOverride: true } : {}),
    ...(typeof candidate.contextLength === 'number' ? { contextLength: candidate.contextLength } : {}),
    ...(typeof candidate.maxCompletionTokens === 'number' ? { maxCompletionTokens: candidate.maxCompletionTokens } : {}),
    ...(candidate.pricing ? { pricing: { ...candidate.pricing } } : {})
  })
}

function normalizeSyncedModel(model: ModelDefinition): ModelDefinition {
  const normalized: ModelDefinition = {
    id: model.id.trim(),
    name: model.name.trim() || model.id.trim(),
    capabilities: normalizeModelCapabilities(model.capabilities)
  }
  if (model.group) normalized.group = model.group
  if (model.provider) normalized.provider = model.provider
  else normalized.provider = 'remote'
  if (model.messagesSupport) normalized.messagesSupport = model.messagesSupport
  if (model.responsesSupport) normalized.responsesSupport = model.responsesSupport
  if (model.declarationSource) normalized.declarationSource = model.declarationSource
  if (model.supportedProtocols?.length) normalized.supportedProtocols = [...model.supportedProtocols]
  if (model.declaredProtocols?.length) normalized.declaredProtocols = [...model.declaredProtocols]
  if (model.protocolProbedAt) normalized.protocolProbedAt = model.protocolProbedAt
  if (model.probeStatus) normalized.probeStatus = model.probeStatus
  if (model.probeReason) normalized.probeReason = model.probeReason
  if (model.providerDeclared === true) normalized.providerDeclared = true
  // 用户手动标记免费：同步更新是从 local 合并来的，这里只负责别在 IPC 往返时丢掉。
  if (model.freeOverride === true) normalized.freeOverride = true
  // PLAT-71：Gemini 同步来的模型必须带 `chatProtocol: 'gemini'`，否则同步会把它清掉、
  // 聊天又回到 `/v1/chat/completions`（Google 上没有该路径）。
  if (model.chatProtocol) normalized.chatProtocol = model.chatProtocol
  // PLAT-63 C：同步更新不得抹掉归档/来源标记，否则「保留但不显示」会在下一次同步后意外复活。
  if (model.presetModel === true) normalized.presetModel = true
  if (model.presetStale === true) normalized.presetStale = true
  if (model.contextLength !== undefined) normalized.contextLength = model.contextLength
  if (model.maxCompletionTokens !== undefined) normalized.maxCompletionTokens = model.maxCompletionTokens
  if (model.pricing) normalized.pricing = { ...model.pricing }
  // 同步边界统一重算价格档位：厂商价格变了（例如免费转收费）时，枚举必须跟着变；
  // 手动免费由 `freeOverride` 保底，不会被覆盖。
  return withModelPriceTag(normalized)
}

/** PLAT-82：协议集合缺失时按同一口径补齐（同步链的唯一入口）。 */
function withSupportedProtocols(
  model: ModelDefinition,
  provider: Pick<ModelProvider, 'endpoints'>
): ModelDefinition {
  return applyProtocolSets(model, provider.endpoints[0]?.protocol)
}

export function isProviderPresetModel(model: ModelDefinition): boolean {
  // 只认显式标记：`group`/`provider` 都不是来源证据——同步模型也会带 group，
  // 用它们判断会把用户同步来的模型误判成"预设模型"，从而在收敛时被删除。
  return model.presetModel === true
}

/* PLAT-77：这两个 URL 帮手已迁到 modelList 模块，这里保留 re-export 以免下游 import 断掉。 */
export { buildModelsUrl, resolveGeminiHost } from './modelList/remoteModelList'
