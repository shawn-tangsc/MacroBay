import type { ModelDefinition, ModelProvider } from '../../../ai/providers/modelProviderTypes'
import { resolveProviderChatBase } from '../../../ai/providers/providerChatEndpoints'

export type AgentModelGatewayApiType = 'anthropic-messages' | 'openai-chat-completions' | 'openai-responses'

export type AgentModelGatewayProviderRoute = {
  apiType: AgentModelGatewayApiType
  baseUrl: string
  providerId: string
  modelId: string
}

/**
 * 供应商**默认端点**（`endpoints[0]`）决定网关走哪种 API 形状；
 * 没有默认端点时按 OpenAI 兼容处理（与历史行为一致）。
 */
export function determineAgentModelGatewayApiType(
  provider: Pick<ModelProvider, 'endpoints'>,
  model: ModelDefinition
): AgentModelGatewayApiType {
  const defaultProtocol = provider.endpoints[0]?.protocol
  if (defaultProtocol === 'messages') return 'anthropic-messages'
  if (defaultProtocol === 'responses') return 'openai-responses'

  void model
  return 'openai-chat-completions'
}

export function getAgentModelGatewayBaseUrlForApiType(
  provider: Pick<ModelProvider, 'id' | 'baseUrl' | 'endpoints'>,
  apiType: AgentModelGatewayApiType
): string {
  if (apiType === 'anthropic-messages') {
    const host = resolveProviderChatBase(provider, 'messages') ?? provider.baseUrl.trim()
    return formatAnthropicGatewayUrl(host)
  }

  return formatOpenAiGatewayUrl(provider)
}

export function resolveAgentModelGatewayProviderRoute(
  provider: ModelProvider,
  model: ModelDefinition
): AgentModelGatewayProviderRoute {
  const apiType = determineAgentModelGatewayApiType(provider, model)
  return {
    apiType,
    baseUrl: getAgentModelGatewayBaseUrlForApiType(provider, apiType),
    providerId: provider.id,
    modelId: model.id
  }
}

export function formatOpenAiGatewayUrl(
  provider: Pick<ModelProvider, 'id' | 'baseUrl'>
): string {
  if (provider.id === 'copilot' || provider.id === 'github') {
    return withoutTrailingSlash(provider.baseUrl.trim())
  }

  const url = withoutTrailingSlash(provider.baseUrl.trim())

  // 形态判断一律按 URL（不再按供应商协议枚举）：Google 的 OpenAI 兼容前缀是 `/v1beta/openai`。
  if (url.includes('generativelanguage.googleapis.com')) {
    return `${url}/v1beta/openai`
  }

  if (url.endsWith('/v1/ai')) {
    return url.replace(/\/v1\/ai$/, '/v1')
  }

  if (hasApiVersion(url)) {
    return url
  }

  return `${url}/v1`
}

export function formatAnthropicGatewayUrl(apiHost: string): string {
  return withoutTrailingSlash(apiHost.trim())
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function hasApiVersion(url: string): boolean {
  return /\/v\d+(?:\/|$)/.test(url)
}
