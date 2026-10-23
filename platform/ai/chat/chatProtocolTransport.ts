import { resolveModelChatProtocol, type ModelChatProtocol } from '../providers/modelChatProtocol'
import { ProviderRuntimeFailureError, ProviderRuntimeFailurePolicy } from '../providers/modelProviderTypes'
import type { ProviderChatEndpoint } from '../providers/modelProviderTypes'
import { resolveProviderChatBase } from '../providers/providerChatEndpoints'
import { requestResponsesChatCompletion } from './responsesChatClient'
import { requestGeminiChatCompletion } from './geminiChatClient'
import { requestMessagesChatCompletion } from './messagesChatClient'
import type {
  ChatProtocolMessage,
  ChatProtocolResult,
  ChatProtocolTool,
  ChatProtocolToolCall,
  ChatProtocolToolResult
} from './chatProtocolTypes'

/**
 * T4/T5：**已配置协议**的聊天补全（助手与智能体共用）。
 *
 * 只处理 `responses` / `gemini` / `messages`：
 * - 模型协议是 `chat-completions` ⇒ 返回 `null`，
 *   由调用方自己的既有链路处理（助手/智能体各一套，行为逐字不变）；
 * - 协议选了但供应商没配对应端点 ⇒ 抛 `provider-configuration-required`（不发任何请求）；
 * - `responses` 支持 SSE 流式 + 工具循环（B 包）；`gemini` / `messages` 仍是
 *   非流式（拿到全文后通过 `onDelta` 一次性回调），**不接收 tools**。
 */
export type ConfiguredChatProtocolRequest = {
  /** 模型自己的聊天协议（同步/新增时写入 `ModelDefinition.chatProtocol`）。 */
  protocol?: ModelChatProtocol
  /** 供应商的端点清单（`provider.endpoints`）；端点 base 由它解析。 */
  endpoints?: readonly ProviderChatEndpoint[]
  apiKey: string
  providerId?: string
  modelId: string
  messages: ChatProtocolMessage[]
  temperature?: number
  signal?: AbortSignal
  fetch?: typeof fetch
  onDelta?: (partialText: string) => Promise<void> | void
  /** 只有 `responses` 会消费工具；其余协议保持不发 tools。 */
  tools?: ChatProtocolTool[]
  executeTool?: (call: ChatProtocolToolCall) => Promise<ChatProtocolToolResult>
  maxToolCalls?: number
}

export async function requestConfiguredChatProtocolCompletion(
  input: ConfiguredChatProtocolRequest
): Promise<ChatProtocolResult | null> {
  const resolved = resolveModelChatProtocol({
    protocol: input.protocol,
    endpoints: input.endpoints
  })
  if (!resolved.ok) {
    throw new ProviderRuntimeFailureError(ProviderRuntimeFailurePolicy.configurationRequired)
  }
  if (resolved.protocol === 'chat-completions') return null

  // 端点 base 只能从端点清单解析；解析不到 = 这条通道不可用（不发请求）。
  const endpointBase = resolveProviderChatBase({ endpoints: input.endpoints ?? [] }, resolved.protocol)
  if (!endpointBase) {
    throw new ProviderRuntimeFailureError(ProviderRuntimeFailurePolicy.configurationRequired)
  }
  const shared = {
    baseUrl: endpointBase,
    apiKey: input.apiKey,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    modelId: input.modelId,
    messages: input.messages,
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.fetch ? { fetch: input.fetch } : {}),
    ...(input.onDelta ? { onDelta: input.onDelta } : {})
  }

  if (resolved.protocol === 'responses') {
    return requestResponsesChatCompletion({
      ...shared,
      ...(input.tools?.length ? { tools: input.tools } : {}),
      ...(input.executeTool ? { executeTool: input.executeTool } : {}),
      ...(input.maxToolCalls === undefined ? {} : { maxToolCalls: input.maxToolCalls })
    })
  }
  if (resolved.protocol === 'messages') return requestMessagesChatCompletion(shared)
  return requestGeminiChatCompletion(shared)
}
