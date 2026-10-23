import type { ProviderRuntimeCheckEndpointLane } from '../../../ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import type { ModelProvider } from '../../../ai/providers/modelProviderTypes'
import { resolveProviderChatBase } from '../../../ai/providers/providerChatEndpoints'
import { probeProviderEndpoint, type EndpointProbeKind } from '../../../ai/providers/providerEndpointProbe'
import { mapEndpointLane } from './providerRuntimeProbeLane'

/**
 * PLAT-63：追加端点（Responses / Gemini）的连接检查 lane。
 * 只探测**已配置**的端点，未配置既不产出 lane 也不发请求；探测并发执行，互不影响。
 * 从 `ProviderRuntimeCheckService` 抽出（保持单文件 <300 行），只做编排 + 纯映射。
 */
export type ConfiguredEndpointLanes = {
  responses?: ProviderRuntimeCheckEndpointLane
  gemini?: ProviderRuntimeCheckEndpointLane
}

type ConfiguredEndpointProbeOptions = {
  fetch: typeof fetch
  modelId: string
  checkedAt: string
}

export async function probeConfiguredEndpointLanes(
  provider: ModelProvider,
  options: ConfiguredEndpointProbeOptions
): Promise<ConfiguredEndpointLanes> {
  // PLAT-66：默认端点就是原生 gemini 时它已是**主链路**（由「普通聊天」lane 探测），
  // 不再重复产出一条 Gemini 端点 lane，也不再重复发请求。
  const geminiIsPrimary = provider.endpoints[0]?.protocol === 'gemini'
  const geminiBaseUrl = geminiIsPrimary ? undefined : resolveProviderChatBase(provider, 'gemini')
  const [responses, gemini] = await Promise.all([
    probeEndpoint(provider, 'responses', resolveProviderChatBase(provider, 'responses'), options),
    probeEndpoint(provider, 'gemini', geminiBaseUrl, options)
  ])
  return {
    ...(responses ? { responses } : {}),
    ...(gemini ? { gemini } : {})
  }
}

async function probeEndpoint(
  provider: ModelProvider,
  kind: Extract<EndpointProbeKind, 'responses' | 'gemini'>,
  baseUrl: string | undefined,
  options: ConfiguredEndpointProbeOptions
): Promise<ProviderRuntimeCheckEndpointLane | null> {
  const trimmed = baseUrl?.trim() ?? ''
  if (!trimmed) return null
  const result = await probeProviderEndpoint(provider, {
    fetch: options.fetch,
    kind,
    baseUrl: trimmed,
    modelId: options.modelId
  })
  return mapEndpointLane(result, options.checkedAt)
}
