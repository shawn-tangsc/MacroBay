import type { ModelChatProtocol, ModelDefinition, ModelProvider } from '../modelProviderTypes'
import {
  buildChatCompletionsUrl,
  buildGeminiGenerateUrl,
  buildMessagesUrl,
  buildResponsesUrl,
  normalizeEndpointBase
} from '../providerEndpoints'
import { configuredModelChatProtocols, resolveProviderChatBase } from '../providerChatEndpoints'
import { mergeProviderHeaders } from '../providerRequestHeaders'
import { isNonTextGenerationModel, type ModelDetectionSkipReasonCode } from './types'

/** 两类检测的请求构造（纯函数）。URL 一律复用 `providerEndpoints`。 */
export type ProviderProbeRequest = { url: string; init: RequestInit; target: ProbeTarget }
export type ProbeTarget = 'chat-completions' | 'responses' | 'messages' | 'gemini' | 'embeddings' | 'rerank'

export type ConnectivityPlan =
  | { kind: 'request'; request: ProviderProbeRequest }
  | { kind: 'failed'; reasonCode: 'endpoint_missing' }
  | { kind: 'skipped'; reasonCode: ModelDetectionSkipReasonCode }

function jsonRequest(
  provider: ModelProvider,
  url: string,
  target: ProbeTarget,
  headers: Record<string, string>,
  body: unknown
): ProviderProbeRequest {
  return {
    url,
    target,
    init: {
      method: 'POST',
      headers: mergeProviderHeaders({ 'content-type': 'application/json', ...headers }, provider.customHeaders),
      body: JSON.stringify(body)
    }
  }
}

/** base + 叶子路径：已带版本段时不再补 `/v1`。 */
export function buildVersionedLeafUrl(base: string, leaf: 'embeddings' | 'rerank'): string {
  const normalized = normalizeEndpointBase(base)
  if (/\/v\d+(?:beta|alpha)?(?:$|\/)/i.test(normalized)) return `${normalized}/${leaf}`
  return `${normalized}/v1/${leaf}`
}

/**
 * 端点 base 一律走 `resolveProviderChatBase(provider, protocol)`（唯一读取口）；
 * 这里**不读**任何供应商端点存储字段，端点结构收敛时零改动。
 */
function requestForProtocol(
  provider: ModelProvider,
  model: ModelDefinition,
  protocol: ModelChatProtocol
): ProviderProbeRequest | null {
  const apiKey = provider.apiKey?.trim() ?? ''
  const base = resolveProviderChatBase(provider, protocol)
  if (!base) return null
  if (protocol === 'chat-completions') {
    return jsonRequest(provider, buildChatCompletionsUrl(base), 'chat-completions', { authorization: `Bearer ${apiKey}` }, {
      model: model.id,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false
    })
  }
  if (protocol === 'responses') {
    return jsonRequest(provider, buildResponsesUrl(base), 'responses', { authorization: `Bearer ${apiKey}` }, {
      model: model.id,
      input: 'ping',
      max_output_tokens: 1
    })
  }
  if (protocol === 'messages') {
    return jsonRequest(provider, buildMessagesUrl(base), 'messages', {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }, {
      model: model.id,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }]
    })
  }
  return jsonRequest(provider, buildGeminiGenerateUrl(base, model.id), 'gemini', { 'x-goog-api-key': apiKey }, {
    contents: [{ parts: [{ text: 'ping' }] }],
    generationConfig: { maxOutputTokens: 1 }
  })
}

/** 联通性计划：chat 走模型自己的协议（无 provider 默认回退）；embedding/rerank 各自的叶子路径。 */
export function planConnectivityProbe(provider: ModelProvider, model: ModelDefinition): ConnectivityPlan {
  const { capabilities } = model
  if (isNonTextGenerationModel(capabilities)) return { kind: 'skipped', reasonCode: 'non_text_generation' }
  if (capabilities.chat) {
    const protocol = model.chatProtocol
    // 没有模型协议 / 该协议端点未配置 ⇒ 不发请求（`endpoint_missing`）。
    if (!protocol || !resolveProviderChatBase(provider, protocol)) {
      return { kind: 'failed', reasonCode: 'endpoint_missing' }
    }
    const request = requestForProtocol(provider, model, protocol)
    return request ? { kind: 'request', request } : { kind: 'failed', reasonCode: 'endpoint_missing' }
  }
  if (capabilities.embedding || capabilities.rerank) {
    const base = normalizeEndpointBase(provider.baseUrl)
    if (!base) return { kind: 'failed', reasonCode: 'endpoint_missing' }
    const leaf = capabilities.embedding ? 'embeddings' : 'rerank'
    const body = leaf === 'embeddings'
      ? { model: model.id, input: 'ping' }
      : { model: model.id, query: 'ping', documents: ['a', 'b'], top_n: 1 }
    return {
      kind: 'request',
      request: jsonRequest(
        provider,
        buildVersionedLeafUrl(base, leaf),
        leaf,
        { authorization: `Bearer ${provider.apiKey?.trim() ?? ''}` },
        body
      )
    }
  }
  return { kind: 'skipped', reasonCode: 'non_text_generation' }
}

/** 协议支持：只测已配置协议（唯一判据 `configuredModelChatProtocols`）。 */
export function planProtocolProbes(
  provider: ModelProvider,
  model: ModelDefinition
): Array<{ protocol: ModelChatProtocol; request: ProviderProbeRequest }> {
  return configuredModelChatProtocols(provider)
    .map((protocol) => ({ protocol, request: requestForProtocol(provider, model, protocol) }))
    .filter((entry): entry is { protocol: ModelChatProtocol; request: ProviderProbeRequest } => entry.request !== null)
}
