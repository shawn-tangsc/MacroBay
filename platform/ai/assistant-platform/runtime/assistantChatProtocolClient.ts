import { resolveModelChatProtocol, type ModelChatProtocol } from '../../providers/modelChatProtocol'
import { ProviderRuntimeFailureError, ProviderRuntimeFailurePolicy } from '../../providers/modelProviderTypes'
import type { ProviderChatEndpoint } from '../../providers/modelProviderTypes'
import {
  streamOpenAiCompatibleChatCompletion,
  type AssistantStreamResult,
  type AssistantToolCall,
  type AssistantToolExecutionResult,
  type ChatCompletionMessage,
  type ChatCompletionTool
} from './assistantOpenAiStreamClient'
import { AssistantInvocationFailureError } from './assistantInvocationFailureEvidence'
import { ChatProtocolFailureError } from '../../chat/chatProtocolFailure'
import { requestConfiguredChatProtocolCompletion } from '../../chat/chatProtocolTransport'
import type { ChatProtocolTool, ChatProtocolToolCall, ChatProtocolToolResult } from '../../chat/chatProtocolTypes'
import type { AssistantMessagePart } from '../schemas/messageSchemas'

/**
 * T4/T5：助手聊天的协议派发。
 *
 * - 模型协议是 `chat-completions` ⇒ 既有链路（逐字不变，含工具/网页搜索）；
 * - `responses` / `gemini` ⇒ 走共用适配器；只在该供应商配置了对应端点时改道，否则
 *   在发请求前抛 `provider-configuration-required`；
 * - 非默认链路的工具：chat 形状的 `tools` 在这里映射成中性 `ChatProtocolTool`（唯一映射点），
 *   由 `responses` 适配器跑工具循环；`gemini` / `messages` 仍不接收 tools；
 * - 适配器的中性失败错误在这里翻译成既有的失败证据错误（programmatic invocation 仍能拿到 evidence）。
 */
export type AssistantChatProtocolRequest = {
  /** 模型自己的聊天协议（`ModelDefinition.chatProtocol`）。 */
  protocol?: ModelChatProtocol
  baseUrl: string
  /** 供应商的端点清单（`provider.endpoints`）；端点 base 由它解析。 */
  endpoints?: readonly ProviderChatEndpoint[]
  apiKey: string
  providerId?: string
  modelId: string
  messages: ChatCompletionMessage[]
  temperature?: number
  signal?: AbortSignal
  fetch?: typeof fetch
  onDelta?: (partialText: string) => Promise<void> | void
  tools?: ChatCompletionTool[]
  executeTool?: (call: AssistantToolCall) => Promise<AssistantToolExecutionResult>
  maxToolCalls?: number
}

export async function requestAssistantChatCompletion(
  input: AssistantChatProtocolRequest
): Promise<AssistantStreamResult> {
  const resolved = resolveModelChatProtocol({
    protocol: input.protocol,
    endpoints: input.endpoints
  })
  if (!resolved.ok) {
    throw new ProviderRuntimeFailureError(ProviderRuntimeFailurePolicy.configurationRequired)
  }

  if (resolved.protocol !== 'chat-completions') {
    try {
      const result = await requestConfiguredChatProtocolCompletion({
        protocol: resolved.protocol,
        ...(input.endpoints ? { endpoints: [...input.endpoints] } : {}),
        apiKey: input.apiKey,
        ...(input.providerId ? { providerId: input.providerId } : {}),
        modelId: input.modelId,
        messages: input.messages,
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.fetch ? { fetch: input.fetch } : {}),
        ...(input.onDelta ? { onDelta: input.onDelta } : {}),
        ...(input.tools?.length ? { tools: toChatProtocolTools(input.tools) } : {}),
        ...(input.executeTool ? { executeTool: toChatProtocolToolExecutor(input.executeTool) } : {}),
        ...(input.maxToolCalls === undefined ? {} : { maxToolCalls: input.maxToolCalls })
      })
      if (!result) throw new ProviderRuntimeFailureError(ProviderRuntimeFailurePolicy.configurationRequired)
      const messageParts = toAssistantMessageParts(result.messageParts)
      return {
        text: result.text,
        stats: result.stats,
        ...(messageParts.length ? { messageParts } : {})
      }
    } catch (error) {
      throw toAssistantFailure(error, input)
    }
  }

  return streamOpenAiCompatibleChatCompletion({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    modelId: input.modelId,
    messages: input.messages,
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.fetch ? { fetch: input.fetch } : {}),
    ...(input.onDelta ? { onDelta: input.onDelta } : {}),
    ...(input.tools ? { tools: input.tools } : {}),
    ...(input.executeTool ? { executeTool: input.executeTool } : {}),
    ...(input.maxToolCalls === undefined ? {} : { maxToolCalls: input.maxToolCalls })
  })
}

/**
 * 助手 `ChatCompletionTool`（嵌套 `function`）⇒ 中性 `ChatProtocolTool`（扁平）。
 * 这是唯一的形状映射点：适配器只管各自供应商形状。
 */
function toChatProtocolTools(tools: ChatCompletionTool[]): ChatProtocolTool[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters
  }))
}

/** 中性调用 ⇒ 助手执行器；结果里的 `messagePart` 原样回传给中性层。 */
function toChatProtocolToolExecutor(
  executeTool: (call: AssistantToolCall) => Promise<AssistantToolExecutionResult>
): (call: ChatProtocolToolCall) => Promise<ChatProtocolToolResult> {
  return async (call) => {
    const result = await executeTool({ id: call.id, name: call.name, argumentsJson: call.argumentsJson })
    return {
      ok: result.ok,
      content: result.content,
      ...(result.messagePart === undefined ? {} : { messagePart: result.messagePart })
    }
  }
}

/**
 * 中性层只做原样回传，片段实际由助手的 `executeTool` 产出，
 * 因此这里收窄回 `AssistantMessagePart` 是安全的（不信任任何外部输入）。
 */
function toAssistantMessageParts(parts: unknown[] | undefined): AssistantMessagePart[] {
  return (parts ?? []) as AssistantMessagePart[]
}

/** 中性失败 ⇒ 既有失败证据（providerId/modelId 由助手侧补齐，evidence 里仍不含 Key）。 */
function toAssistantFailure(error: unknown, input: AssistantChatProtocolRequest): unknown {
  if (!(error instanceof ChatProtocolFailureError)) return error
  return new AssistantInvocationFailureError('provider-request-failed', {
    phase: error.evidence.phase,
    summary: error.evidence.summary,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    modelId: input.modelId,
    ...(error.evidence.httpStatus === undefined ? {} : { httpStatus: error.evidence.httpStatus }),
    ...(error.evidence.body ? { body: error.evidence.body } : {})
  })
}
