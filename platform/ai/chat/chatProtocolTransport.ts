import { resolveModelChatProtocol, type ModelChatProtocol } from '../providers/modelChatProtocol'
import { classifyHttpFailure } from '../providers/providerFailureMapping'
import { ProviderRuntimeFailureError, ProviderRuntimeFailurePolicy } from '../providers/modelProviderTypes'
import { ChatProtocolFailureError } from './chatProtocolFailure'
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
  /** 出网通道，必传；缺了就在编译期失败，而不是在运行时静默回退到全局 fetch。 */
  fetch: typeof fetch
  onDelta?: (partialText: string) => Promise<void> | void
  /** 只有 `responses` 会消费工具；其余协议保持不发 tools。 */
  tools?: ChatProtocolTool[]
  executeTool?: (call: ChatProtocolToolCall) => Promise<ChatProtocolToolResult>
  maxToolCalls?: number
  /**
   * 凭据判定信号（可选，默认为空 = 行为与之前完全一致）。
   *
   * 只把 `classifyHttpFailure()` 的**已有结论**翻成一个事实：`http_401`/`http_403` → `invalid`，
   * 请求成功 → `ok`，**其余一律不报**（超时、代理、限流不是凭据问题，报出去就是误报）。
   * 翻转去重不在这一层做——`reportProviderCredential` 自己的 `changed` 就是唯一判据。
   */
  onProviderCredentialSignal?: (input: { providerId: string; state: 'ok' | 'invalid' }) => void
}

let missingProviderIdReported = false

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
    fetch: input.fetch,
    ...(input.onDelta ? { onDelta: input.onDelta } : {})
  }

  const signal = input.onProviderCredentialSignal
  // 正常链路里 providerId 一定在；缺了说明传参有 bug——每进程只留一次痕迹，别每次请求刷日志。
  if (signal && !input.providerId && !missingProviderIdReported) {
    missingProviderIdReported = true
    console.warn('provider-credential-signal: providerId is missing; credential health is not reported')
  }
  const finish = async (run: () => Promise<ChatProtocolResult>): Promise<ChatProtocolResult> => {
    try {
      const result = await run()
      if (signal && input.providerId) signal({ providerId: input.providerId, state: 'ok' })
      return result
    } catch (error) {
      if (signal && error instanceof ChatProtocolFailureError && error.evidence.httpStatus !== undefined) {
        const code = classifyHttpFailure(error.evidence.httpStatus, error.evidence.summary)
        if ((code === 'http_401' || code === 'http_403') && input.providerId) {
          signal({ providerId: input.providerId, state: 'invalid' })
        }
      }
      throw error
    }
  }

  if (resolved.protocol === 'responses') {
    return finish(() => requestResponsesChatCompletion({
      ...shared,
      ...(input.tools?.length ? { tools: input.tools } : {}),
      ...(input.executeTool ? { executeTool: input.executeTool } : {}),
      ...(input.maxToolCalls === undefined ? {} : { maxToolCalls: input.maxToolCalls })
    }))
  }
  if (resolved.protocol === 'messages') return finish(() => requestMessagesChatCompletion(shared))
  return finish(() => requestGeminiChatCompletion(shared))
}
