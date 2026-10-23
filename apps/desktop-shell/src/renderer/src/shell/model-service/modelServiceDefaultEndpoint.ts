import type { ModelChatProtocol, ProviderChatEndpoint } from '@platform/ai/providers/modelProviderTypes'
import { resolveProviderChatBase } from '@platform/ai/providers/providerChatEndpoints'

/**
 * 「默认端点」在 UI 里的行语义：**端点清单的顺序就是优先级** —— `endpoints[0]` 是默认端点。
 *
 * 因此「设为默认」= 把该端点移到数组头部，「删除」= 从数组里移除（剩下的第一条自动成为默认），
 * 不再有独立的"默认端点协议"字段需要同步。
 */

/** 某协议端点当前的地址（草稿值，未配置 ⇒ 空串）。 */
export function endpointBaseOf(
  endpoints: readonly ProviderChatEndpoint[],
  protocol: ModelChatProtocol
): string {
  return endpoints.find((endpoint) => endpoint.protocol === protocol)?.baseUrl ?? ''
}

/** 写入某协议端点的地址：已声明就改，未声明就**追加**到末尾。 */
export function setEndpointBase(
  endpoints: readonly ProviderChatEndpoint[],
  protocol: ModelChatProtocol,
  baseUrl: string
): ProviderChatEndpoint[] {
  const exists = endpoints.some((endpoint) => endpoint.protocol === protocol)
  if (!exists) return [...endpoints, { protocol, baseUrl }]
  return endpoints.map((endpoint) => (endpoint.protocol === protocol ? { protocol, baseUrl } : endpoint))
}

/** 删除某协议的端点（剩下的第一条自动成为默认端点）。 */
export function removeEndpoint(
  endpoints: readonly ProviderChatEndpoint[],
  protocol: ModelChatProtocol
): ProviderChatEndpoint[] {
  return endpoints.filter((endpoint) => endpoint.protocol !== protocol)
}

/** 端点清单的规范顺序（也是「添加端点」菜单的候选顺序）：Chat → Responses → Messages → Gemini。 */
const CHAT_ENDPOINT_ORDER: readonly ModelChatProtocol[] = [
  'chat-completions',
  'responses',
  'messages',
  'gemini'
]

/** 设为默认端点 = 移到数组头部（`endpoints[0]` 即默认）。 */
export function setDefaultEndpoint(
  endpoints: readonly ProviderChatEndpoint[],
  protocol: ModelChatProtocol
): ProviderChatEndpoint[] {
  const target = endpoints.find((endpoint) => endpoint.protocol === protocol)
  if (!target) return [...endpoints]
  return [target, ...endpoints.filter((endpoint) => endpoint.protocol !== protocol)]
}

/** 「添加端点」还能加哪些协议：清单里还没有的，按规范顺序。 */
export function availableEndpointProtocols(
  endpoints: readonly ProviderChatEndpoint[]
): ModelChatProtocol[] {
  return CHAT_ENDPOINT_ORDER.filter((protocol) => !endpoints.some((endpoint) => endpoint.protocol === protocol))
}

/**
 * 新建端点的预填值：Chat / Responses / Messages 用供应商主地址；
 * **Gemini 原生**只填已声明的原生主机，没有就留空 —— 中转站 base 会拼出
 * `…/v1beta/models` 这种不存在的路径。
 */
export function prefillEndpointBase(
  protocol: ModelChatProtocol,
  provider: { endpoints: readonly ProviderChatEndpoint[] }
): string {
  if (protocol === 'gemini') return resolveProviderChatBase(provider, 'gemini') ?? ''
  return resolveProviderChatBase(provider, 'chat-completions') ?? ''
}

/** 端点行是否允许删除：删完至少要留下一个端点。 */
export function canRemoveEndpoint(endpoints: readonly ProviderChatEndpoint[]): boolean {
  return endpoints.length > 1
}
