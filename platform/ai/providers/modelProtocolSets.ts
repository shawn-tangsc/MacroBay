import type { ModelChatProtocol, ModelDefinition } from './modelProviderTypes'
import {
  deriveDeclaredProtocols,
  deriveModelSupportedProtocols,
  normalizeModelSupportedProtocols
} from './modelChatProtocol'
import { resolveModelCapabilities } from './modelCapabilityInference'

/**
 * PLAT-82：模型协议集合的**唯一补齐口径**（存储归一、预设合并、同步链共用）。
 *
 *  - `supportedProtocols`（可用）= 厂商声明 ∪ 模型 `chatProtocol` ∪ 供应商默认端点（仅 chat 模型）；
 *  - `declaredProtocols`（厂商声明）= 只来自逐条声明，**绝不**含默认端点；
 *  - `probedProtocols`（检测证据）= 只来自实测通过，**不**在这里推导（只做归一）。
 *
 * 已有值不覆盖（只补缺）；三个集合都没有 ⇒ 原样返回。
 */
export function applyProtocolSets(
  model: ModelDefinition,
  providerDefaultProtocol?: ModelChatProtocol
): ModelDefinition {
  const supportedProtocols = normalizeModelSupportedProtocols(model.supportedProtocols)
    ?? deriveModelSupportedProtocols({
      chat: resolveModelCapabilities(model).chat,
      chatProtocol: model.chatProtocol,
      providerDefaultProtocol,
      messagesSupport: model.messagesSupport,
      responsesSupport: model.responsesSupport
    })
  const declaredProtocols = normalizeModelSupportedProtocols(model.declaredProtocols)
    ?? deriveDeclaredProtocols({
      messagesSupport: model.messagesSupport,
      responsesSupport: model.responsesSupport
    })
  // 检测证据只归一，不推导：没有就是没有（失败不写负结论）。
  const probedProtocols = normalizeModelSupportedProtocols(model.probedProtocols)
  if (!supportedProtocols && !declaredProtocols && !probedProtocols) return model
  return {
    ...model,
    ...(supportedProtocols ? { supportedProtocols } : {}),
    ...(declaredProtocols ? { declaredProtocols } : {}),
    ...(probedProtocols ? { probedProtocols } : {})
  }
}
