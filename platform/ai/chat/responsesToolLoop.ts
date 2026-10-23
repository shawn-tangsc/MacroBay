import type { ChatProtocolTool, ChatProtocolToolCall } from './chatProtocolTypes'

/**
 * B 包：Responses 工具循环的纯逻辑（翻译 / 抽取 / 回传项 / 预算）。
 *
 * 线上事实（火山方舟 `/api/v3/responses`）：工具声明是**扁平** `{type:'function', name, ...}`；
 * 调用在 `output[]` 里形如 `{type:'function_call', name, arguments, call_id}`；
 * 下一轮 `input` 必须同时带上该 `function_call` item 和 `{type:'function_call_output', call_id, output}`。
 */
export type ResponsesToolDefinition = {
  type: 'function'
  name: string
  description: string
  parameters: unknown
}

export type ResponsesFunctionCallInput = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

export type ResponsesFunctionCallOutput = {
  type: 'function_call_output'
  call_id: string
  output: string
}

/**
 * 工具调用轮次上限的默认值。owner：`platform/ai/chat` 适配器；与 chat/completions 链路同语义。
 * 只有 6 这个数字本身的业务含义需要在 `maxToolCalls` 未注入时兜底，调用方可覆盖。
 */
export const CHAT_PROTOCOL_DEFAULT_MAX_TOOL_CALLS = 6

/** 模型要工具但调用方没给执行器：与 chat 链路同语义，直接失败而不是静默丢工具。 */
export const MODEL_REQUESTED_TOOLS_WITHOUT_EXECUTOR = 'Model requested tools, but no tool executor is configured.'

/** 超过轮次预算：与 chat 链路同语义。 */
export const MODEL_TOOL_CALL_LIMIT_EXCEEDED = 'Model tool call limit exceeded.'

export function toResponsesTools(tools: ChatProtocolTool[]): ResponsesToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }))
}

export function resolveMaxToolCalls(maxToolCalls?: number): number {
  return maxToolCalls ?? CHAT_PROTOCOL_DEFAULT_MAX_TOOL_CALLS
}

/** 从 `output[]`（或单个流式 item）里抽出函数调用；非 function_call item 一律忽略。 */
export function readResponsesFunctionCalls(output: unknown): ChatProtocolToolCall[] {
  if (!Array.isArray(output)) return []
  return output.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as { type?: unknown; name?: unknown; arguments?: unknown; call_id?: unknown }
    if (record.type !== 'function_call') return []
    if (typeof record.name !== 'string' || !record.name) return []
    if (typeof record.call_id !== 'string' || !record.call_id) return []
    return [
      {
        id: record.call_id,
        name: record.name,
        argumentsJson: normalizeArgumentsJson(record.arguments)
      }
    ]
  })
}

export function toFunctionCallInputItem(call: ChatProtocolToolCall): ResponsesFunctionCallInput {
  return { type: 'function_call', call_id: call.id, name: call.name, arguments: call.argumentsJson }
}

export function toFunctionCallOutputItem(
  call: ChatProtocolToolCall,
  output: string
): ResponsesFunctionCallOutput {
  return { type: 'function_call_output', call_id: call.id, output }
}

function normalizeArgumentsJson(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return '{}'
  return JSON.stringify(value)
}
