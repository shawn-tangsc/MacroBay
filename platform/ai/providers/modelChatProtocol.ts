import type {
  ModelChatProtocol,
  ModelMessagesSupport,
  ProviderChatEndpoint
} from './modelProviderTypes'
import { normalizeEndpointBase } from './providerEndpoints'

export type { ModelChatProtocol }

/**
 * T4/T5：模型级聊天协议解析。
 *
 * 协议是**模型自己的事实**：同步/新增模型时就已经把它写进 `ModelDefinition.chatProtocol`
 * （厂商声明优先，否则取当时供应商的默认端点），运行时**只读模型**，不再动态跟随供应商默认。
 *
 * 四种协议平权；模型没有协议 ⇒ 拒绝发送（`endpoint_missing`），绝不静默回落到某个协议。
 */
export const modelChatProtocols = ['chat-completions', 'responses', 'gemini', 'messages'] as const

export function normalizeModelChatProtocol(value: unknown): ModelChatProtocol | undefined {
  return typeof value === 'string' && (modelChatProtocols as readonly string[]).includes(value)
    ? (value as ModelChatProtocol)
    : undefined
}

/**
 * `supportedProtocols` 归一：只保留合法协议、去重，并按固定顺序
 * （`chat-completions` / `responses` / `gemini` / `messages`）输出，便于稳定比较与渲染。
 * 非数组 / 空集合 ⇒ `undefined`（缺省 = 旧数据，由存储层回填）。
 */
export function normalizeModelSupportedProtocols(value: unknown): ModelChatProtocol[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<ModelChatProtocol>()
  for (const entry of value) {
    const protocol = normalizeModelChatProtocol(entry)
    if (protocol) seen.add(protocol)
  }
  if (seen.size === 0) return undefined
  return modelChatProtocols.filter((protocol) => seen.has(protocol))
}

/** 多来源合并成 `supportedProtocols`（去重 + 固定顺序）；空集合 ⇒ `undefined`。 */
export function buildModelSupportedProtocols(
  values: readonly (ModelChatProtocol | undefined)[]
): ModelChatProtocol[] | undefined {
  return normalizeModelSupportedProtocols(values.filter((value): value is ModelChatProtocol => value !== undefined))
}

/**
 * `supportedProtocols` 的回填口径（缺失时才用）：
 * `[供应商默认端点协议] ∪ [模型自己的 chatProtocol] ∪ [厂商声明的 messages/responses]`。
 *
 * 用 `chatProtocol` **反推**会漏掉「声明了 responses 但默认端点仍是 chat」的模型，
 * 所以供应商默认端点协议（`endpoints[0].protocol`）也并进来。
 *
 * **供应商默认端点只并入聊天模型**（产品仲裁 2026-10-20）：视频/语音/图像模型不因为
 * 供应商默认端点是 chat/completions 就出现在 Chat pill 里；它们只保留厂商逐条声明的协议。
 */
/** 厂商逐条声明 → `declaredProtocols`；默认端点不参与。 */
export function deriveDeclaredProtocols(input: {
  messagesSupport?: ModelMessagesSupport
  responsesSupport?: ModelMessagesSupport
}): ModelChatProtocol[] | undefined {
  return buildModelSupportedProtocols([
    input.messagesSupport === 'yes' ? 'messages' : undefined,
    input.responsesSupport === 'yes' ? 'responses' : undefined
  ])
}

export function deriveModelSupportedProtocols(input: {
  chat: boolean
  chatProtocol?: ModelChatProtocol
  /** 供应商默认端点协议（`provider.endpoints[0]?.protocol`）。 */
  providerDefaultProtocol?: ModelChatProtocol
  messagesSupport?: ModelMessagesSupport
  responsesSupport?: ModelMessagesSupport
}): ModelChatProtocol[] | undefined {
  return buildModelSupportedProtocols([
    input.chat ? input.providerDefaultProtocol : undefined,
    input.chatProtocol,
    input.messagesSupport === 'yes' ? 'messages' : undefined,
    input.responsesSupport === 'yes' ? 'responses' : undefined
  ])
}

export type ResolvedModelChatProtocol =
  | { ok: true; protocol: ModelChatProtocol }
  | { ok: false; reasonCode: 'endpoint_missing' }

/**
 * 模型协议在这个供应商上是否真的可用：`endpoints` 里必须有该协议**且 base 非空**。
 *
 * 只看端点数组 —— 端点是否配置是唯一的可用性判据，不再按协议种类另开一套判断。
 */
export function resolveModelChatProtocol(input: {
  /** 模型自己的协议（同步/新增时写入，运行时不再跟随供应商默认）。 */
  protocol?: ModelChatProtocol
  endpoints?: readonly ProviderChatEndpoint[]
}): ResolvedModelChatProtocol {
  const protocol = input.protocol
  // 模型没有协议 = 无法判断链路 ⇒ 不发请求（不猜、不回落）。
  if (!protocol) return { ok: false, reasonCode: 'endpoint_missing' }
  const endpoint = input.endpoints?.find((entry) => entry.protocol === protocol)
  if (!endpoint || !normalizeEndpointBase(endpoint.baseUrl)) {
    return { ok: false, reasonCode: 'endpoint_missing' }
  }
  return { ok: true, protocol }
}
