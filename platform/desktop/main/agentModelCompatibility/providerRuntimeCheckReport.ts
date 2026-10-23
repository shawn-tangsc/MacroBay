import type {
  AgentRuntimeCompatibilityResult,
  AgentRuntimeId
} from '../../../ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type {
  ProviderRuntimeCheckLaneResult,
  ProviderRuntimeCheckReport,
  ProviderRuntimeCheckStatus
} from '../../../ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import type {
  ProviderConnectionFailureCode,
  ProviderConnectionResult
} from '../../../ai/providers/providerConnection'

/**
 * PLAT-61/66：连接检查报告的**纯构造**（从 `ProviderRuntimeCheckService` 抽出，保持单文件 <300 行）。
 * 这里只拼 `ProviderRuntimeCheckReport`，不发请求、不做判定。
 */

export function mapOrdinaryChatLane(
  result: ProviderConnectionResult,
  checkedAt: string
): ProviderRuntimeCheckLaneResult {
  return {
    lane: 'ordinary-chat',
    status: result.ok ? 'ready' : mapOrdinaryChatFailureStatus(result.message),
    summary: result.message,
    // PLAT-61：只透传可判定原因；成功/失败判定与 status 映射保持原样。
    ...(result.failureCode ? { failureCode: result.failureCode } : {}),
    ...(result.upstreamMessage ? { upstreamMessage: result.upstreamMessage } : {}),
    checkedAt
  }
}

function mapOrdinaryChatFailureStatus(message: string): ProviderRuntimeCheckStatus {
  const lower = message.toLowerCase()
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('api key')) {
    return 'auth-failed'
  }
  if (lower.includes('403') || lower.includes('forbidden')) return 'forbidden'
  if (lower.includes('timeout')) return 'timeout'
  if (lower.includes('network') || lower.includes('fetch')) return 'network-error'
  return 'unknown'
}

/**
 * PLAT-66：供应商停用时的报告。**一个请求都不发**，也不带任何上游 message/detail ——
 * 用户要修的只有一件事：先启用。所有 lane 都落到 `provider_disabled`（渲染层按 code 出文案）。
 */
export function buildProviderDisabledReport(
  providerId: string,
  modelId: string,
  runtimeId: AgentRuntimeId,
  checkedAt: string
): ProviderRuntimeCheckReport {
  const summary = 'The provider is disabled. Enable it before running the check.'
  const finalCompatibility: AgentRuntimeCompatibilityResult = {
    providerId,
    modelId,
    runtimeId,
    selectable: false,
    route: 'none',
    status: 'provider-disabled',
    summary,
    checkedAt
  }
  const lane = (
    key: ProviderRuntimeCheckLaneResult['lane'],
    route?: 'direct' | 'gateway'
  ): ProviderRuntimeCheckLaneResult => ({
    lane: key,
    status: 'unknown',
    summary,
    checkedAt,
    ...(route ? { route } : {})
  })

  return {
    providerId,
    modelId,
    runtimeId,
    ordinaryChat: lane('ordinary-chat'),
    ...(runtimeId === 'claude-code'
      ? { direct: lane('claude-code-direct', 'direct'), gateway: lane('claude-code-gateway', 'gateway') }
      : {}),
    finalCompatibility,
    updatedAt: checkedAt,
    signature: `${runtimeId}:provider-disabled:${providerId}:${modelId}`
  }
}

export function buildMissingProviderReport(
  providerId: string,
  modelId: string,
  runtimeId: AgentRuntimeId,
  checkedAt: string,
  failureCode?: ProviderConnectionFailureCode
): ProviderRuntimeCheckReport {
  const finalCompatibility: AgentRuntimeCompatibilityResult = {
    providerId,
    modelId,
    runtimeId,
    selectable: false,
    route: 'none',
    status: 'unknown',
    summary: 'Provider or model was not found.',
    checkedAt
  }
  return {
    providerId,
    modelId,
    runtimeId,
    ordinaryChat: {
      lane: 'ordinary-chat',
      status: 'unknown',
      summary: 'Provider or model was not found.',
      ...(failureCode ? { failureCode } : {}),
      checkedAt
    },
    finalCompatibility,
    updatedAt: checkedAt,
    signature: `${runtimeId}:missing:${providerId}:${modelId}`
  }
}

export function buildMissingApiKeyReport(
  providerId: string,
  modelId: string,
  runtimeId: AgentRuntimeId,
  checkedAt: string
): ProviderRuntimeCheckReport {
  const summary = 'Provider runtime key is unavailable.'
  return {
    providerId,
    modelId,
    runtimeId,
    ordinaryChat: {
      lane: 'ordinary-chat',
      status: 'unknown',
      summary,
      failureCode: 'missing_api_key',
      checkedAt
    },
    finalCompatibility: {
      providerId,
      modelId,
      runtimeId,
      selectable: false,
      route: 'none',
      status: 'missing-api-key',
      summary,
      checkedAt
    },
    updatedAt: checkedAt,
    signature: `${runtimeId}:missing-api-key:${providerId}:${modelId}`
  }
}
