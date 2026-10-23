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
 * 顶部「默认模型」条的分组（布局单一事实）：
 *  - primary：常用的 4 个文本入口，始终显示在第一行；
 *  - more：绘画模型，收进第二行，默认收起，点「更多默认模型设置」才展开。
 * 两组必须覆盖 `defaultModelFields` 的全部字段（组件按 `Record` 取标签，漏字段会编译失败）。
 */
export const primaryDefaultModelFields: readonly DefaultModelField[] = [
  'assistantModelId',
  'agentModelId',
  'fastModelId',
  'translationModelId'
]

export const moreDefaultModelFields: readonly DefaultModelField[] = ['imageModelId']

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
  field: DefaultModelField
): ModelPickerCandidate[] {
  // 智能体候选有自己的判据（运行期标记 / messages 能力 / 兼容性证据），复用那一份，不在这里复制规则。
  if (field === 'agentModelId') {
    return flattenAgentModelOptions(buildAgentModelOptions(providers, 'claude-code'))
      .filter((option) => option.selectable)
      .map((option) => ({ providerId: option.providerId, model: option.model }))
  }
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({ providerId: provider.id, model }))
  )
}
