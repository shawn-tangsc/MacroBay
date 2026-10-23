import { buildResponsesUrl } from '../providers/providerEndpoints'
import { ChatProtocolFailureError, readChatProviderFailure } from './chatProtocolFailure'
import type {
  ChatProtocolClientInput,
  ChatProtocolMessage,
  ChatProtocolResult
} from './chatProtocolTypes'
import {
  MODEL_REQUESTED_TOOLS_WITHOUT_EXECUTOR,
  MODEL_TOOL_CALL_LIMIT_EXCEEDED,
  readResponsesFunctionCalls,
  resolveMaxToolCalls,
  toFunctionCallInputItem,
  toFunctionCallOutputItem,
  toResponsesTools,
  type ResponsesFunctionCallInput,
  type ResponsesFunctionCallOutput
} from './responsesToolLoop'
import {
  normalizeResponsesUsage,
  readResponsesStream,
  RESPONSES_WITHOUT_ASSISTANT_TEXT,
  type ResponsesTurn,
  type ResponsesUsage
} from './responsesStreamReader'

/**
 * T4：OpenAI Responses（`POST /v1/responses`）适配器。
 *
 * 请求形状与 chat/completions 不同：`{model, input: [{role, content}]}`，
 * 响应归一化优先 `output_text`，其次 `output[]` 里 `type:'message'` 的 `output_text` 片段。
 *
 * B 包：
 * - 传了 `tools` ⇒ 请求体加扁平 `tools` + `tool_choice:'auto'` 并跑工具循环（同时开流式）；
 *   没传 tools ⇒ 请求体逐字不变（`{model, input, temperature}`），也不流式。
 * - 流式按 SSE 读取（`response.output_text.delta` / `output_item.done` / `completed`）；
 *   供应商回 `application/json` 时回退到 JSON 解析。
 * - 工具失败只回传给模型（`ok:false` 的 content），不直接抛给用户；成功结果的 `messagePart`
 *   按执行顺序放进 `messageParts` 交给助手侧渲染卡片。
 */
export type ResponsesChatRequest = ChatProtocolClientInput

type ResponsesPayload = {
  output_text?: unknown
  output?: unknown
  usage?: ResponsesUsage
}

type ResponsesInputItem = { role: string; content: string } | ResponsesFunctionCallInput | ResponsesFunctionCallOutput

export async function requestResponsesChatCompletion(input: ResponsesChatRequest): Promise<ChatProtocolResult> {
  const tools = input.tools?.length ? input.tools : undefined
  const responsesTools = tools ? toResponsesTools(tools) : undefined
  // 只有工具轮次需要 SSE（边跑工具边吐字）；无 tools 时请求体保持原样、不流式。
  const streaming = Boolean(responsesTools)
  const messageParts: unknown[] = []
  let inputItems: ResponsesInputItem[] = toResponsesInput(input.messages)
  let executedToolCalls = 0

  while (true) {
    const response = await (input.fetch ?? fetch)(buildResponsesUrl(input.baseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json'
      },
      signal: input.signal,
      body: JSON.stringify({
        model: input.modelId,
        input: inputItems,
        temperature: input.temperature ?? 0.2,
        ...(responsesTools ? { tools: responsesTools, tool_choice: 'auto' } : {}),
        ...(streaming ? { stream: true } : {})
      })
    })

    if (!response.ok) {
      const failure = await readChatProviderFailure(response)
      throw new ChatProtocolFailureError({
        phase: 'response',
        summary: failure.summary,
        httpStatus: response.status,
        ...(failure.body ? { body: failure.body } : {})
      })
    }

    const turn = await readResponsesTurn(response, input, streaming)
    if (!turn.functionCalls.length) {
      return {
        text: turn.text,
        stats: turn.stats,
        ...(messageParts.length ? { messageParts } : {})
      }
    }

    if (!input.executeTool || !responsesTools) throw new Error(MODEL_REQUESTED_TOOLS_WITHOUT_EXECUTOR)

    executedToolCalls += turn.functionCalls.length
    if (executedToolCalls > resolveMaxToolCalls(input.maxToolCalls)) {
      throw new Error(MODEL_TOOL_CALL_LIMIT_EXCEEDED)
    }

    for (const call of turn.functionCalls) {
      // 下一轮 input 需要 assistant 的 function_call item + 它对应的 output item。
      inputItems = [...inputItems, toFunctionCallInputItem(call)]
      const toolResult = await input.executeTool(call)
      if (toolResult.messagePart !== undefined) messageParts.push(toolResult.messagePart)
      inputItems = [...inputItems, toFunctionCallOutputItem(call, toolResult.content)]
    }
  }
}

async function readResponsesTurn(
  response: Response,
  input: ResponsesChatRequest,
  streamingRequested: boolean
): Promise<ResponsesTurn> {
  const contentType = response.headers.get('content-type') ?? ''
  if (streamingRequested && contentType.includes('text/event-stream')) {
    return readResponsesStream(response, {
      ...(input.onDelta ? { onDelta: input.onDelta } : {}),
      ...(input.signal ? { signal: input.signal } : {})
    })
  }

  const payload = (await response.json().catch(() => null)) as ResponsesPayload | null
  const functionCalls = readResponsesFunctionCalls(payload?.output)
  const text = readResponsesText(payload, functionCalls.length > 0)
  await input.onDelta?.(text)
  return { text, stats: normalizeResponsesUsage(payload?.usage), functionCalls }
}

/** chat 的角色里没有 responses 的 `developer`；tool 消息在这条链路上不发送。 */
function toResponsesInput(messages: ChatProtocolMessage[]): ResponsesInputItem[] {
  return messages
    .filter((message) => message.role !== 'tool')
    .map((message) => ({ role: message.role, content: message.content }))
}

/**
 * `allowEmpty` 只在**本轮拿到了函数调用**时为真：纯工具轮次没有面向用户的文本是正常的，
 * 但最终答案（无函数调用）必须非空，否则会落一条空白助手消息。
 */
export function readResponsesText(payload: ResponsesPayload | null, allowEmpty = false): string {
  const text = extractResponsesText(payload)
  if (text) return text
  if (allowEmpty) return ''
  throw new Error(RESPONSES_WITHOUT_ASSISTANT_TEXT)
}

function extractResponsesText(payload: ResponsesPayload | null): string {
  if (!payload) return ''
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim()

  const output = Array.isArray(payload.output) ? payload.output : []
  const chunks: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const record = item as { type?: unknown; content?: unknown }
    if (record.type !== 'message' || !Array.isArray(record.content)) continue
    for (const part of record.content) {
      if (!part || typeof part !== 'object') continue
      const contentPart = part as { type?: unknown; text?: unknown }
      if (contentPart.type !== 'output_text' || typeof contentPart.text !== 'string') continue
      if (contentPart.text) chunks.push(contentPart.text)
    }
  }
  return chunks.join('').trim()
}
