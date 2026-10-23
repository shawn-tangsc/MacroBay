import type {
  ModelChatProtocol,
  ModelDefinition,
  ModelProvider,
  ProviderState
} from './modelProviderTypes'
import { mergeModelCapabilities } from './modelCapabilities'
import { resolveModelCapabilities } from './modelCapabilityInference'
import { applyProtocolSets } from './modelProtocolSets'
import { mergeProviderEndpoints } from './providerEndpointMerge'
import { isProviderPresetModel } from './providerModelSync'
import { createSystemProviderPresets, isSystemProviderId } from './providerPresets'

/**
 * PLAT-72：**预设 × 用户库的唯一合并点**，也是字段所有权策略的可执行版本。
 *
 * | 字段 | 归属 | 合并行为 |
 * | --- | --- | --- |
 * | `enabled` / Key 引用 / `baseUrl` / `imageEndpoints` | 用户库 | 预设永不覆盖；缺失才补 |
 * | `endpoints` | 用户库 | 用户已有协议原样保留，预设新增协议追加；墓碑里的协议不补 |
 * | 模型增删 / 能力 / 探测结果 / 墓碑(`removedPresetModelIds`) | 用户库 | 原样保留 |
 * | `websites` | 预设 | 预设权威（不可编辑静态元数据，PLAT-61） |
 * | 预设新增模型 | — | 追加，不删用户/同步模型 |
 * | 预设移除模型 | — | 只标 `presetStale`，绝不删除 |
 *
 * 之前这套规则散在 `mergeSystemProviderPresets` / `mergeProviderExtraEndpoints` / `mergeModels`
 * 三个函数的 spread 里，且与地址纠正表交织，导致"预设合并覆盖用户数据"反复发生。
 */
/**
 * PLAT-78：**预设版本号**——`createSystemProviderPresets()` 的稳定哈希（memoize）。
 *
 * 用途：启动时先比对库里记录的版本；一致就完全跳过预设合并、跳过写库
 *（否则每次启动都会"合并 → 视为有变更 → 回写"，用户库被无谓改写）。
 *
 * **合并语义变了也必须换版本号**：版本一致时整段合并被跳过，语义变更（如端点合并从
 * "预设永不补"改成"预设新增协议追加 + 删除墓碑"）否则永远到不了已配置过的用户库。
 * `v2` = 端点补全 + 墓碑（PLAT：removedEndpointProtocols）。
 *
 * 哈希是纯 JS（djb2），不引 node:crypto：这个模块也会进渲染层 bundle。
 */
let cachedPresetVersion: string | null = null

export function systemPresetsVersion(): string {
  if (cachedPresetVersion === null) cachedPresetVersion = stableHash(`v2:${JSON.stringify(createSystemProviderPresets())}`)
  return cachedPresetVersion
}

function stableHash(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0
  }
  return `presets-v2-${(hash >>> 0).toString(36)}-${value.length.toString(36)}`
}

export function mergeSystemProviderPresets(state: ProviderState): ProviderState {
  const existingById = new Map(state.providers.map((provider) => [provider.id, provider]))
  // PLAT-66：`isSystem` 必须由**当前预设清单**决定，不能沿用持久化值——
  // 否则被移出预设的供应商（如 302ai）仍被当成系统供应商，右键菜单禁止删除。
  const customProviders = state.providers
    .filter((provider) => !isSystemProviderId(provider.id))
    .map((provider) => (provider.isSystem ? { ...provider, isSystem: false } : provider))
  const systemProviders = createSystemProviderPresets().map((preset) => {
    const existing = existingById.get(preset.id)
    if (!existing) return withPresetSupportedProtocols(preset)
    const mergedModels = mergePresetModels(existing.models, preset.models, existing.removedPresetModelIds)
    // 端点归用户库：用户已有的协议一律保留（地址改过也不覆盖）；预设新增协议追加到末尾，
    // 但用户手动删过（墓碑 `removedEndpointProtocols`）的协议不补回来。
    const endpoints = mergeProviderEndpoints(existing, preset)

    return {
      ...preset,
      ...existing,
      endpoints,
      imageEndpoints: existing.imageEndpoints ?? preset.imageEndpoints,
      baseUrl: existing.baseUrl || preset.baseUrl,
      apiKey: existing.apiKey ?? preset.apiKey,
      apiKeyRef: existing.apiKeyRef,
      apiKeyPreview: existing.apiKeyPreview,
      apiKeyMigrationState: existing.apiKeyMigrationState,
      apiKeyStorageVersion: existing.apiKeyStorageVersion,
      isSystem: true,
      websites: {
        ...existing.websites,
        ...preset.websites
      },
      models: mergedModels.map((model) => withSupportedProtocols(model, endpoints[0]?.protocol)),
      // 默认模型必须真实存在：否则「清空全部模型」在重启后会被预设默认值复活成一个幽灵 id。
      defaultChatModelId: resolveMergedDefaultChatModelId(
        mergedModels,
        existing.defaultChatModelId,
        preset.defaultChatModelId
      )
    }
  })

  return { providers: [...customProviders, ...systemProviders] }
}

/**
 * PLAT-82：预设模型也要带 `supportedProtocols`（预设本身只声明 `chatProtocol`）。
 * 这里只补缺失值；用户/同步来的模型保留自己的值。
 */
function withSupportedProtocols(model: ModelDefinition, providerDefaultProtocol?: ModelChatProtocol): ModelDefinition {
  return applyProtocolSets(model, providerDefaultProtocol)
}

function withPresetSupportedProtocols(provider: ModelProvider): ModelProvider {
  return {
    ...provider,
    models: provider.models.map((model) => withSupportedProtocols(model, provider.endpoints[0]?.protocol))
  }
}

/**
 * PLAT-63 C：**加载期绝不删除模型**。
 *  - 仍在预设清单里的 ⇒ 以预设为准（并清掉可能残留的归档标记）；
 *  - 旧预设模型（已从清单移除）⇒ 归档保留 + `presetStale: true`，删除只能由用户在
 *    「获取模型列表」预览的「本地多余（预设已变更）」组里确认；
 *  - 用户手动添加 / 同步来的模型 ⇒ 原样保留，排在预设模型之后。
 */
function mergePresetModels(
  existingModels: ModelDefinition[],
  presetModels: ModelDefinition[],
  removedPresetModelIds: readonly string[] = []
): ModelDefinition[] {
  const presetIds = new Set(presetModels.map((model) => model.id))
  const existingById = new Map(existingModels.map((model) => [model.id, model]))
  const staleModels = existingModels
    .filter((model) => !presetIds.has(model.id) && isProviderPresetModel(model))
    .map((model) => (model.presetStale === true ? model : { ...model, presetStale: true }))
  const removed = new Set(removedPresetModelIds)
  const customModels = existingModels.filter((model) => !presetIds.has(model.id) && !isProviderPresetModel(model))
  const merged = presetModels.filter((model) => !removed.has(model.id)).map((model) => {
    const existing = existingById.get(model.id)
    if (!existing) return model
    const next: ModelDefinition = {
      ...model,
      ...existing,
      // 关键：本地记录（可能来自更早版本、没有 presetModel 标记）会盖掉预设的标记，
      // 必须在这里强制回写，否则"删除预设模型"时识别不出它来自预设 ⇒ 不写墓碑 ⇒ 重启又回来。
      presetModel: true,
      capabilities: mergeModelCapabilities(model.capabilities, existing.capabilities)
    }
    // 回到预设清单 ⇒ 不再是归档模型。
    if (next.presetStale !== undefined) delete next.presetStale
    return next
  })
  return [...merged, ...customModels, ...staleModels]
}

/** 默认聊天模型：用户值优先，其次预设值，但**必须**存在于合并后的模型列表里。 */
function resolveMergedDefaultChatModelId(
  models: readonly ModelDefinition[],
  existingDefault: string | undefined,
  presetDefault: string | undefined
): string | undefined {
  const ids = new Set(models.map((model) => model.id))
  if (existingDefault && ids.has(existingDefault)) return existingDefault
  if (presetDefault && ids.has(presetDefault)) return presetDefault
  return undefined
}
