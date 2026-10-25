import { resolveConfiguredModel, type ResolvableProvider } from '@platform/ai/model-defaults/configuredDefaultModel'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import type {
  NewsSentimentDefaultModelState,
  NewsSentimentModelResolution,
  NewsSentimentSettings
} from '../schema/newsSentiment'

export const NEWS_SENTIMENT_SETTINGS_ERROR_CODES = Object.freeze({
  halfBoundModel: 'news-sentiment-model-half-bound',
  invalidSettings: 'news-sentiment-settings-invalid'
})

export function createDefaultNewsSentimentSettings(now = new Date().toISOString()): NewsSentimentSettings {
  return {
    modelScoringEnabled: true,
    providerId: '',
    modelId: '',
    updatedAt: now
  }
}

/** 读盘容错：缺字段按默认，非法时间回退到 now；不因一个坏字段丢掉整个设置。 */
export function normalizeNewsSentimentSettings(
  input: Partial<NewsSentimentSettings> | undefined,
  now = new Date().toISOString()
): NewsSentimentSettings {
  return {
    modelScoringEnabled: input?.modelScoringEnabled !== false,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : '',
    modelId: typeof input?.modelId === 'string' ? input.modelId.trim() : '',
    updatedAt: typeof input?.updatedAt === 'string' && input.updatedAt.trim() ? input.updatedAt : now
  }
}

export function applyNewsSentimentSettingsPatch(
  current: NewsSentimentSettings,
  patch: Partial<NewsSentimentSettings>,
  now = new Date().toISOString()
): NewsSentimentSettings {
  const providerId = patch.providerId !== undefined ? patch.providerId.trim() : current.providerId
  const modelId = patch.modelId !== undefined ? patch.modelId.trim() : current.modelId
  const touchesModel = patch.providerId !== undefined || patch.modelId !== undefined
  const hasProvider = providerId.length > 0
  const hasModel = modelId.length > 0

  if (touchesModel && hasProvider !== hasModel) {
    throw new Error(NEWS_SENTIMENT_SETTINGS_ERROR_CODES.halfBoundModel)
  }

  return {
    modelScoringEnabled: patch.modelScoringEnabled ?? current.modelScoringEnabled,
    providerId: hasProvider ? providerId : '',
    modelId: hasModel ? modelId : '',
    updatedAt: now
  }
}

/**
 * 舆情用哪个模型——唯一解析器。
 *
 * | 产品设置 | 平台快速模型 | 结果 |
 * | --- | --- | --- |
 * | 显式绑定 | 任意 | explicit（即使不可用也保持绑定） |
 * | 空 | 可解析 | platform-fast |
 * | 空 | 未配置 / 失效 | unavailable → 规则兜底 |
 */
export function resolveNewsSentimentModel(input: {
  settings: Pick<NewsSentimentSettings, 'providerId' | 'modelId'>
  modelDefaults?: Pick<ModelDefaultsSettings, 'fastModelId'> | null
  providers: readonly ResolvableProvider[]
}): NewsSentimentModelResolution {
  const explicitProviderId = input.settings.providerId.trim()
  const explicitModelId = input.settings.modelId.trim()
  const fastValue = input.modelDefaults?.fastModelId?.trim() ?? ''

  const fastResolution = resolveConfiguredModel({
    value: fastValue,
    providers: input.providers,
    isModelAcceptable: (_provider, model) => model.capabilities.chat === true
  })
  const defaultModelState: NewsSentimentDefaultModelState =
    fastValue.length === 0 ? 'unset' : fastResolution.ok ? 'ready' : 'unavailable'

  if (explicitProviderId && explicitModelId) {
    return {
      source: 'explicit',
      defaultModelState,
      providerId: explicitProviderId,
      modelId: explicitModelId
    }
  }

  if (fastResolution.ok) {
    return {
      source: 'platform-fast',
      defaultModelState,
      providerId: fastResolution.ref.providerId,
      modelId: fastResolution.ref.modelId
    }
  }

  return { source: 'unavailable', defaultModelState }
}
