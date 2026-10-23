import type { ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { resolveProviderChatBase } from '@platform/ai/providers/providerChatEndpoints'

import {
  MODEL_PROTOCOL_TABS,
  type ModelProtocolTab
} from '../../model-service/modelProtocolFilter'

/**
 * 模型「已声明协议」的**唯一口径**（协议筛选 + 智能体 messages 硬约束都走这里）。
 *
 * 派生顺序：模型显式声明（`chatProtocol` / `supportedProtocols` / `messagesSupport` /
 * `responsesSupport`）> 供应商默认端点（`endpoints[0]`，即「没声明就跟随默认端点」）；
 * 另外「供应商已配好 messages 端点且该模型探测通过」也算可走 messages。
 *
 * 只用于选择/展示，不写回持久化。
 */
export const MODEL_PICKER_PROTOCOL_ORDER: readonly ModelProtocolTab[] =
  MODEL_PROTOCOL_TABS.map((tab) => tab.key)

export function resolveModelPickerProtocols(
  provider: SafeModelProvider,
  model: ModelDefinition
): ModelProtocolTab[] {
  const declared = new Set<ModelProtocolTab>()
  if (model.chatProtocol) declared.add(model.chatProtocol)
  for (const protocol of model.supportedProtocols ?? []) declared.add(protocol)
  if (model.messagesSupport === 'yes') declared.add('messages')
  if (model.responsesSupport === 'yes') declared.add('responses')
  if (declared.size === 0) {
    const fallback = provider.endpoints[0]?.protocol
    if (fallback) declared.add(fallback)
  }
  if (model.probeStatus === 'passed' && resolveProviderChatBase(provider, 'messages')) {
    declared.add('messages')
  }
  return MODEL_PICKER_PROTOCOL_ORDER.filter((protocol) => declared.has(protocol))
}

/** 智能体侧硬性约束：该模型能不能走 Anthropic `/v1/messages`。 */
export function isMessagesCapableModel(
  provider: SafeModelProvider,
  model: ModelDefinition
): boolean {
  return resolveModelPickerProtocols(provider, model).includes('messages')
}
