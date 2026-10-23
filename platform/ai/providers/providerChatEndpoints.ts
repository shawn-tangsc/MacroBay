import type {
  ModelChatProtocol,
  ProviderChatEndpoint,
  ProviderImageEndpoints
} from './modelProviderTypes'
import { normalizeEndpointBase } from './providerEndpoints'

/**
 * **供应商聊天端点 base 的唯一读取口**（也是端点写入归一化的唯一实现）。
 *
 * 端点事实只有一份：`ModelProvider.endpoints[]`（`[0]` = 默认端点）。协议一律用
 * `ModelChatProtocol` 命名（`chat-completions` / `responses` / `messages` / `gemini`），
 * 不存在"供应商协议名"这层翻译。
 *
 * 消费方（模型检测、协议 pill、探测通道、聊天派发）只允许调用本模块取 base，
 * 不得自己读 `endpoints` 之外的字段拼端点地址。
 */

/** 端点读取所需的供应商字段集合（只读也接受：UI 用它校验草稿）。 */
export type ProviderChatEndpointSource = {
  readonly endpoints: readonly ProviderChatEndpoint[]
}

/**
 * 某聊天端点的 base；端点未声明或已声明但没配地址 ⇒ `undefined`
 * （调用方据此判定"这条通道不可用"）。
 */
export function resolveProviderChatBase(
  provider: ProviderChatEndpointSource,
  protocol: ModelChatProtocol
): string | undefined {
  const endpoint = provider.endpoints.find((entry) => entry.protocol === protocol)
  return normalizeEndpointBase(endpoint?.baseUrl) || undefined
}

/**
 * 是否有 `chat/completions` 端点（纯 Gemini 供应商不该被探 `/v1/chat/completions`）。
 * 判据只有这一处；检测与标签链路只调用它。
 */
export function providerSupportsChatCompletions(provider: ProviderChatEndpointSource): boolean {
  return provider.endpoints.some((endpoint) => endpoint.protocol === 'chat-completions')
}

/**
 * 该供应商**已配置**（base 非空）的聊天协议，按 `endpoints` 顺序（即默认端点在前）。
 *
 * 同协议重复声明只保留第一条（与 `normalizeProviderChatEndpoints` 同口径）：协议是**通道集合**，
 * 重复项会让协议探测把同一条通道数成两条（"协议 2/2"实际只测了一条）。
 */
export function configuredModelChatProtocols(provider: ProviderChatEndpointSource): ModelChatProtocol[] {
  const seen = new Set<ModelChatProtocol>()
  const protocols: ModelChatProtocol[] = []
  for (const endpoint of provider.endpoints) {
    if (!normalizeEndpointBase(endpoint.baseUrl).length) continue
    if (seen.has(endpoint.protocol)) continue
    seen.add(endpoint.protocol)
    protocols.push(endpoint.protocol)
  }
  return protocols
}

/**
 * 供应商主地址（`ModelProvider.baseUrl`）的**唯一派生口径**：`chat/completions` 端点的 base
 * 优先（历史上 `baseUrl` 就是 OpenAI 兼容 base），没有该端点时取默认端点（Gemini 原生 /
 * Anthropic 原生供应商的主地址就是它们自己的端点）。
 *
 * 空端点清单 ⇒ `''`（未配置）。
 */
export function resolveProviderPrimaryBase(provider: ProviderChatEndpointSource): string {
  return resolveProviderChatBase(provider, 'chat-completions')
    ?? normalizeEndpointBase(provider.endpoints[0]?.baseUrl)
}

/**
 * 端点数组归一化（写入/加载的唯一实现）：
 *  - 丢掉非法协议、非字符串 base；同协议重复只保留**第一条**（顺序即优先级）；
 *  - base 一律 trim + 去尾斜杠，**空串保留**（= 已声明未配置，否则清空的端点行重启会复活）。
 */
export function normalizeProviderChatEndpoints(value: unknown): ProviderChatEndpoint[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<ModelChatProtocol>()
  const endpoints: ProviderChatEndpoint[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<ProviderChatEndpoint>
    const protocol = normalizeProtocol(candidate.protocol)
    if (!protocol || seen.has(protocol)) continue
    seen.add(protocol)
    endpoints.push({
      protocol,
      baseUrl: normalizeEndpointBase(typeof candidate.baseUrl === 'string' ? candidate.baseUrl : '')
    })
  }
  return endpoints
}

/** 图片端点归一：去空/去重、空串不保留（缺省 = 未配置）。 */
export function normalizeProviderImageEndpoints(value: unknown): ProviderImageEndpoints | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const imageEndpoints: ProviderImageEndpoints = {}
  for (const key of ['generation', 'edit'] as const) {
    const base = normalizeEndpointBase(typeof source[key] === 'string' ? source[key] : '')
    if (base) imageEndpoints[key] = base
  }
  return Object.keys(imageEndpoints).length > 0 ? imageEndpoints : undefined
}

const knownChatProtocols: readonly ModelChatProtocol[] = ['chat-completions', 'responses', 'gemini', 'messages']

function normalizeProtocol(value: unknown): ModelChatProtocol | undefined {
  return typeof value === 'string' && (knownChatProtocols as readonly string[]).includes(value)
    ? value as ModelChatProtocol
    : undefined
}
