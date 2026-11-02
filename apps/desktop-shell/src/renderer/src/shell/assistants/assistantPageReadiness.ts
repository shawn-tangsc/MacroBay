import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { ProviderRuntimeFailurePolicy } from '@platform/ai/providers/modelProviderTypes'
import type { AssistantEntity } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import type { AssistantTopicStreamSnapshot } from '@platform/ai/assistant-platform/schemas/streamSchemas'

import type { PlatformText } from '../../i18n/platformText'

/**
 * 助手页「这条会话现在能不能发消息」的判定，与流错误的说法。
 *
 * 从 `AssistantPage.tsx` 抽出来：这些是纯函数（输入就是助手、供应商清单、错误码），
 * 和页面的状态机与渲染没有关系。放在页面里时它们跟着页面一起长，把文件顶过了体积门禁；
 * 抽出来之后页面只负责状态与布局，这里的判定可以单独读、单独测。
 */

export function parseAssistantModelId(
  value: string | null | undefined
): { providerId: string; modelId: string } | null {
  if (!value) return null
  const separatorIndex = value.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) return null
  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1)
  }
}

export function hasReadyChatModel(provider: SafeModelProvider): boolean {
  return provider.enabled && provider.hasApiKey && provider.models.some((model) => model.capabilities.chat)
}

/** 没绑模型时「任一条可用的 chat 模型」就算就绪；绑了就必须那条模型本身可用。 */
export function isAssistantChatReady(
  assistant: AssistantEntity | null,
  providers: readonly SafeModelProvider[]
): boolean {
  if (!assistant) return false
  const modelReference = parseAssistantModelId(assistant.modelId)
  if (!modelReference) {
    return providers.some(hasReadyChatModel)
  }

  const provider = providers.find((entry) => entry.id === modelReference.providerId)
  if (!provider || !provider.enabled || !provider.hasApiKey) return false
  return provider.models.some((model) => model.id === modelReference.modelId && model.capabilities.chat)
}

export function normalizeAssistantStatusMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

type AssistantStreamErrorTextLabels = Pick<
  PlatformText['assistants'],
  'modelNotReady' | 'conversationOperationFailed' | 'modelRetired' | 'modelNotActivated' | 'modelNotFound'
>

/** Renderer-safe stream errors are stable runtime codes, never upstream messages. */
export function resolveAssistantStreamErrorText(error: unknown, labels: AssistantStreamErrorTextLabels): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  if (code === ProviderRuntimeFailurePolicy.configurationRequired) return labels.modelNotReady
  // PLAT-74：模型生命周期失败给真实结论，不再只说「请重试」。
  if (code === ProviderRuntimeFailurePolicy.modelRetired) return labels.modelRetired
  if (code === ProviderRuntimeFailurePolicy.modelNotActivated) return labels.modelNotActivated
  if (code === ProviderRuntimeFailurePolicy.modelNotFound) return labels.modelNotFound
  return labels.conversationOperationFailed
}

const ASSISTANT_COMPOSER_TERMINAL_STREAM_STATUSES = new Set<AssistantTopicStreamSnapshot['status']>([
  'done',
  'aborted',
  'error'
])

export function isTerminalAssistantComposerSnapshot(snapshot: AssistantTopicStreamSnapshot): boolean {
  return ASSISTANT_COMPOSER_TERMINAL_STREAM_STATUSES.has(snapshot.status)
}
