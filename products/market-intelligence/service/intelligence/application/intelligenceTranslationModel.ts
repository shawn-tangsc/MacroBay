import {
  resolveConfiguredModel,
  type ResolvableProvider
} from '@platform/ai/model-defaults/configuredDefaultModel'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import type { IntelligenceTranslationSettings } from '../schema/intelligenceTranslation'

/**
 * 翻译任务用哪个模型——**唯一解析器**。
 *
 * 规则只有一条：显式绑定优先，未绑定才跟随模型服务里的默认翻译模型。
 * 默认模型在每次任务开始时解析，不写回 MI 设置（改默认后未绑定的翻译立即跟随）。
 *
 * | 设置里的 provider/model | 模型服务默认 | 结果 |
 * | --- | --- | --- |
 * | 有 | 任意 | `explicit`（即使默认更新也不影响） |
 * | 无 | 可用 | `platform-default` |
 * | 无 | 未配置/失效 | `fallback`（沿用旧行为：供应商默认聊天模型） |
 */
export type IntelligenceTranslationModelSource = 'explicit' | 'platform-default' | 'fallback'

export type IntelligenceTranslationDefaultModelState = 'unset' | 'ready' | 'unavailable'

export type IntelligenceTranslationModelResolution = {
  source: IntelligenceTranslationModelSource
  /**
   * 只让设置页展示「跟随默认」的状态：未配置 / 可用 / 已配置但当前不可用。
   * 显式绑定时也返回，便于界面在未来同时解释两种情况。
   */
  defaultModelState: IntelligenceTranslationDefaultModelState
  /** 实际要发给模型服务的引用；`fallback` 时为空，走平台既有供应商默认。 */
  providerId?: string
  modelId?: string
}

export function isTranslationChatModel(model: { capabilities: { chat?: boolean } }): boolean {
  return model.capabilities.chat === true
}

export function resolveTranslationModel(input: {
  settings: Pick<IntelligenceTranslationSettings, 'providerId' | 'modelId'>
  modelDefaults?: Pick<ModelDefaultsSettings, 'translationModelId'> | null
  providers: readonly ResolvableProvider[]
}): IntelligenceTranslationModelResolution {
  const explicitProviderId = input.settings.providerId?.trim() ?? ''
  const explicitModelId = input.settings.modelId?.trim() ?? ''
  const defaultValue = input.modelDefaults?.translationModelId?.trim() ?? ''

  const defaultResolution = resolveConfiguredModel({
    value: defaultValue,
    providers: input.providers,
    isModelAcceptable: (_provider, model) => isTranslationChatModel(model)
  })
  const defaultModelState: IntelligenceTranslationDefaultModelState =
    defaultValue.length === 0 ? 'unset' : defaultResolution.ok ? 'ready' : 'unavailable'

  if (explicitProviderId && explicitModelId) {
    // 显式绑定即使当前不可用也保持绑定：报错比静默换模型可诊断。
    return {
      source: 'explicit',
      defaultModelState,
      providerId: explicitProviderId,
      modelId: explicitModelId
    }
  }

  if (defaultResolution.ok) {
    return {
      source: 'platform-default',
      defaultModelState,
      providerId: defaultResolution.ref.providerId,
      modelId: defaultResolution.ref.modelId
    }
  }

  return { source: 'fallback', defaultModelState }
}
