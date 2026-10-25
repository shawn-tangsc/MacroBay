import type { ModelAvailability, ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { isModelAvailabilityStale } from '@platform/ai/providers/modelAvailability'
import { isNonTextGenerationModel } from '@platform/ai/providers/modelDetection/types'

/**
 * 自动检测的**选模策略**（纯函数，唯一实现）。
 *
 * 目标：配置好 / 模型变更后**自动**知道哪些模型能用，但不能变成"每次保存全量扫一遍"：
 *  - 只测聊天模型，且只测**没有结论或结论已过期**的（跳过与取消不落库，所以它们会一直是候选）；
 *  - 单批上限 `AUTO_MODEL_DETECTION_LIMIT`，优先级 = 默认聊天模型 → 免费模型 → 从未测过 → 结论过期；
 *  - 停用 / 没 Key / 没端点时一律不自动发请求（`detect.ts` 的前置会全部跳过，测了也是白测）。
 *
 * 指纹只依赖渲染层也拿得到的字段，因此与主进程写入结论时算出的值可以逐字比对。
 */
export const AUTO_MODEL_DETECTION_LIMIT = 12

export type AutoModelDetectionPlan = {
  modelIds: string[]
  /** 候选里被上限截掉的数量（> 0 时界面要提示手动补测）。 */
  skipped: number
}

export type ModelAvailabilityView = ModelAvailability & {
  /** 结论写入后配置又变过。 */
  stale: boolean
}

type AvailabilityConfig = Pick<SafeModelProvider, 'endpoints' | 'apiKeyPreview'>

/** 行内展示用：补齐「是否过期」（渲染层算，不落库、不进 IPC）。 */
export function resolveModelAvailabilityView(
  config: AvailabilityConfig,
  model: Pick<ModelDefinition, 'id' | 'chatProtocol' | 'capabilities' | 'availability'>
): ModelAvailabilityView | undefined {
  if (!model.availability) return undefined
  return {
    ...model.availability,
    stale: isModelAvailabilityStale(model.availability, config, model)
  }
}

function priorityOf(model: ModelDefinition, provider: SafeModelProvider): number {
  if (model.id === provider.defaultChatModelId) return 0
  if (model.priceTag === 'free') return 1
  if (!model.availability) return 2
  return 3
}

export function isAutoDetectableModel(model: ModelDefinition): boolean {
  if (model.presetStale === true) return false
  if (!model.capabilities.chat) return false
  // 图片 / 视频 / 语音 / 转写会产生媒体或不可控消耗，检测本身就会跳过它们。
  return !isNonTextGenerationModel(model.capabilities)
}

export function planAutoModelDetection(
  provider: SafeModelProvider,
  options: { limit?: number } = {}
): AutoModelDetectionPlan | null {
  if (!provider.enabled) return null
  if (!provider.hasApiKey) return null
  if (!provider.baseUrl.trim()) return null

  const limit = Math.max(1, options.limit ?? AUTO_MODEL_DETECTION_LIMIT)
  const config: AvailabilityConfig = { endpoints: provider.endpoints, apiKeyPreview: provider.apiKeyPreview }

  const candidates = provider.models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => isAutoDetectableModel(model))
    .filter(({ model }) => !model.availability || isModelAvailabilityStale(model.availability, config, model))
    .sort((left, right) =>
      priorityOf(left.model, provider) - priorityOf(right.model, provider) || left.index - right.index
    )
    .map(({ model }) => model.id)

  if (candidates.length === 0) return null

  const modelIds = candidates.slice(0, limit)
  return { modelIds, skipped: candidates.length - modelIds.length }
}

/**
 * 自动检测的去重签名：**不包含结论本身**。
 *
 * 如果把 `availability` 也算进来，run 结束写回结论会改变签名 ⇒ 立刻再触发下一批，
 * 直到把整家供应商跑完（正是要避免的全量扫描）。
 */
export function autoModelDetectionSignature(provider: SafeModelProvider): string {
  return [
    provider.id,
    provider.enabled ? '1' : '0',
    provider.hasApiKey ? '1' : '0',
    provider.baseUrl,
    provider.apiKeyPreview,
    provider.models
      .map((model) => `${model.id}:${model.chatProtocol ?? ''}:${model.capabilities.chat ? '1' : '0'}`)
      .join(',')
  ].join('|')
}
