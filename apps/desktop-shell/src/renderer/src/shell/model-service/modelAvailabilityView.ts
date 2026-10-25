import type { ModelAvailability, ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { isModelAvailabilityStale } from '@platform/ai/providers/modelAvailability'
import { isNonTextGenerationModel } from '@platform/ai/providers/modelDetection/types'

/**
 * 可用性结论的**只读视图**（渲染层唯一入口）。
 *
 * 落库的是 `{ status, reasonCode, checkedAt, fingerprint }`；这里用**同一份指纹函数**
 * 和当前配置重算一次，补上「是否过期」。不落库、不进 IPC。
 */
export type ModelAvailabilityView = ModelAvailability & {
  /** 结论写入后配置又变过。 */
  stale: boolean
}

type AvailabilityConfig = Pick<SafeModelProvider, 'endpoints' | 'apiKeyPreview'>

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

/**
 * 这个模型值不值得做「可用性」联通性探测：聊天模型、且不是会产生媒体的模型
 * （图片/视频/语音/转写由检测前置直接跳过，测了也是 skipped）。
 */
export function isAvailabilityProbeModel(model: Pick<ModelDefinition, 'capabilities'>): boolean {
  if (!model.capabilities.chat) return false
  return !isNonTextGenerationModel(model.capabilities)
}
