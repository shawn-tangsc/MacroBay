import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import { buildAgentModelOptions, flattenAgentModelOptions } from '../agents/agentModelOptions'
import type { ModelPickerCandidate, ModelPickerConstraints } from '../components/ModelPicker/modelPickerOptions'

/**
 * 模型服务页顶部「默认模型」的候选与约束（PLAT-80，唯一事实）。
 *
 * 值 = `providerId:modelId`；候选范围全部由 `ModelPicker` 的声明式约束表达：
 *  - 助手 / 快速 / 翻译：文本入口 ⇒ 只列 chat；
 *  - 智能体：运行时走 Anthropic `/v1/messages` ⇒ messages + chat（复用智能体候选判据）；
 *  - 绘画：图像入口 ⇒ 只列 imageGeneration。
 * 已下线由数据层默认剔除；旧值不在候选里时选择器只回显 + 提示，不静默清空。
 */
export type DefaultModelField = keyof ModelDefaultsSettings

export const defaultModelFields: readonly DefaultModelField[] = [
  'assistantModelId',
  'agentModelId',
  'fastModelId',
  'translationModelId',
  'imageModelId'
]

/**
 * 顶部「默认模型」条**渲染**的字段（布局单一事实）：4 个常用的文本入口。
 *
 * `imageModelId`（绘画模型）**故意不在这里**（C10，2026-11-10）：它从未接进生成路径，
 * 唯一读它的是「在用模型巡检」，留着控件就是假可用。字段与读者已设的值**保留、不迁不删**；
 * 将来要么接进生成路径，要么连字段一起退（台账另列一行）。
 */
export const primaryDefaultModelFields: readonly DefaultModelField[] = [
  'assistantModelId',
  'agentModelId',
  'fastModelId',
  'translationModelId'
]

const DEFAULT_MODEL_CONSTRAINTS: Record<DefaultModelField, ModelPickerConstraints> = {
  assistantModelId: { requireCapabilities: ['chat'] },
  agentModelId: {
    requireCapabilities: ['chat'],
    protocols: ['messages'],
    showProtocolFilter: true
  },
  fastModelId: { requireCapabilities: ['chat'] },
  translationModelId: { requireCapabilities: ['chat'] },
  imageModelId: { requireCapabilities: ['imageGeneration'], showProtocolFilter: false }
}

export function defaultModelConstraints(field: DefaultModelField): ModelPickerConstraints {
  return DEFAULT_MODEL_CONSTRAINTS[field]
}

export function buildDefaultModelCandidates(
  providers: readonly SafeModelProvider[],
  field: DefaultModelField,
  providerNames: Readonly<Record<string, string>> = {}
): ModelPickerCandidate[] {
  // 智能体候选有自己的判据（运行期标记 / messages 能力 / 兼容性证据），复用那一份，不在这里复制规则。
  if (field === 'agentModelId') {
    return flattenAgentModelOptions(buildAgentModelOptions(providers, 'claude-code', undefined, providerNames))
      .filter((option) => option.selectable)
      .map((option) => ({ providerId: option.providerId, model: option.model }))
  }
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({ providerId: provider.id, model }))
  )
}
