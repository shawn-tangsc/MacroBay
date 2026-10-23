import type { ModelChatProtocol } from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../i18n/platformText'

/**
 * 端点标签文案的唯一映射：协议（`ModelChatProtocol`）→ 端点种类名。
 *
 * 「API 地址」摘要标签与抽屉端点行都用它 —— 显示的是**端点种类**
 * （Chat / Responses / Anthropic Messages / Gemini 原生），不是笼统的协议名
 * （`OpenAI` 会把 chat/completions 与 responses 混为一谈）。
 */
export function endpointKindLabel(labels: PlatformText['models'], protocol: ModelChatProtocol): string {
  if (protocol === 'chat-completions') return labels.endpointKindChat
  if (protocol === 'responses') return labels.endpointKindResponses
  if (protocol === 'messages') return labels.endpointKindMessages
  return labels.endpointKindGemini
}

/** 图像端点（生成 / 编辑）的字段名 —— 它们不是聊天协议，单独一套文案。 */
export function imageEndpointLabel(
  labels: PlatformText['models'],
  kind: 'generation' | 'edit'
): string {
  return kind === 'generation' ? labels.requestConfigImageGeneration : labels.requestConfigImageEdit
}
