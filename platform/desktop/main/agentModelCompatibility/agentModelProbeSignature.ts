import { createHash } from 'node:crypto'

import type { ModelProvider, ProviderState } from '../../../ai/providers/modelProviderTypes'

export type AgentModelProbeSignatureInput = {
  provider: Pick<
    ModelProvider,
    'id' | 'enabled' | 'baseUrl' | 'endpoints' | 'apiKey'
  >
  modelId: string
  runtimeId: 'claude-code' | 'openai-agents'
  route: 'direct' | 'gateway'
  gatewayConfigVersion?: string
}

export function buildAgentModelProbeSignature(input: AgentModelProbeSignatureInput): string {
  const secretVersion = hashSecretVersion(input.provider.apiKey)
  return [
    input.runtimeId,
    input.route,
    input.provider.id,
    input.modelId,
    input.provider.enabled ? '1' : '0',
    normalizeUrl(input.provider.baseUrl),
    // 端点清单变化（顺序 / 地址）必须让签名失效，否则探测结论会被当成仍然有效。
    input.provider.endpoints.map((endpoint) => `${endpoint.protocol}:${normalizeUrl(endpoint.baseUrl)}`).join(','),
    secretVersion,
    input.gatewayConfigVersion ?? ''
  ].join('|')
}

function hashSecretVersion(apiKey: string | undefined): string {
  const trimmed = apiKey?.trim() ?? ''
  if (!trimmed) return 'missing'
  return createHash('sha256').update(trimmed).digest('hex').slice(0, 16)
}

function normalizeUrl(value: string | undefined): string {
  return value?.trim() ?? ''
}
