/**
 * T4/T5：聊天协议适配器共用的最小消息/结果契约（无助手/智能体依赖）。
 *
 * B 包：新增**中性**工具契约。助手侧的 `ChatCompletionTool`（嵌套 `function`）在
 * `assistantChatProtocolClient` 里映射成这里的扁平形状；适配器再翻成各自供应商形状。
 * 中性层不 import 助手的消息 part 类型，`messagePart` 只做原样回传。
 */
export type ChatProtocolRole = 'system' | 'user' | 'assistant' | 'tool'

export type ChatProtocolMessage = {
  role: ChatProtocolRole
  content: string
}

/** 中立工具声明：只有名字、说明和 JSON Schema，不带任何线路形状。 */
export type ChatProtocolTool = {
  name: string
  description: string
  parameters: unknown
}

/** 模型请求的一次函数调用（`id` 是供应商的 call id）。 */
export type ChatProtocolToolCall = {
  id: string
  name: string
  argumentsJson: string
}

/** 调用方执行工具后的结果；失败也用 `ok:false` + `content` 回传给模型，由模型自己恢复。 */
export type ChatProtocolToolResult = {
  ok: boolean
  content: string
  /** 调用方自定义的消息片段（助手侧是网页搜索卡片）；中性层只按顺序回传，不解释形状。 */
  messagePart?: unknown
}

export type ChatProtocolStats = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type ChatProtocolResult = {
  text: string
  stats: ChatProtocolStats | null
  /** 成功执行的工具片段，顺序与执行顺序一致；调用方负责映射成自己的消息 part。 */
  messageParts?: unknown[]
}

export type ChatProtocolClientInput = {
  baseUrl: string
  apiKey: string
  providerId?: string
  modelId: string
  messages: ChatProtocolMessage[]
  temperature?: number
  signal?: AbortSignal
  fetch?: typeof fetch
  onDelta?: (partialText: string) => Promise<void> | void
  tools?: ChatProtocolTool[]
  executeTool?: (call: ChatProtocolToolCall) => Promise<ChatProtocolToolResult>
  maxToolCalls?: number
}
