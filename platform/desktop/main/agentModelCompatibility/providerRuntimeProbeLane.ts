import type { AgentRuntimeProbeSnapshot } from '../../../ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type {
  ProviderRuntimeCheckEndpointLane,
  ProviderRuntimeCheckLaneResult,
  ProviderRuntimeCheckStatus
} from '../../../ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import type { ProviderConnectionFailureCode } from '../../../ai/providers/providerConnection'
import type { EndpointProbeResult } from '../../../ai/providers/providerEndpointProbe'
import { isProtocolUnsupportedFailure, isRateLimitedFailure } from '../../../ai/providers/providerFailureMapping'

/**
 * PLAT-62：Claude Code 探针结果 → 运行时检查 lane。
 * 从 `ProviderRuntimeCheckService` 抽出（保持单文件 <300 行），只做纯映射。
 */
export function mapProbeLane(
  lane: 'claude-code-direct' | 'claude-code-gateway',
  probe: AgentRuntimeProbeSnapshot,
  route: 'direct' | 'gateway'
): ProviderRuntimeCheckLaneResult {
  const failureCode = probeFailureCode(probe)
  return {
    lane,
    status: mapProbeStatus(probe),
    summary: probe.message ?? defaultProbeSummary(probe.status, route),
    ...(failureCode ? { failureCode } : {}),
    checkedAt: probe.checkedAt,
    route
  }
}

/** PLAT-63：端点探测结果 → 报告里的端点 lane（Responses）。只做纯映射，不改判定。 */
export function mapEndpointLane(
  probe: EndpointProbeResult,
  checkedAt: string
): ProviderRuntimeCheckEndpointLane {
  return {
    verdict: probe.verdict,
    status: probe.status,
    ...(probe.message ? { message: probe.message } : {}),
    checkedAt
  }
}

/** 探针结果 → 渲染层可判定 code（限流优先，其次协议不支持）。 */
export function probeFailureCode(probe: AgentRuntimeProbeSnapshot | undefined): ProviderConnectionFailureCode | undefined {
  if (!probe || probe.status === 'ready') return undefined
  const message = probe.message ?? null
  if (isRateLimitedFailure(null, message)) return 'rate_limited'
  if (probe.status === 'protocol-unsupported' || isProtocolUnsupportedFailure(null, message)) {
    return 'protocol_unsupported'
  }
  return undefined
}

function mapProbeStatus(probe: AgentRuntimeProbeSnapshot): ProviderRuntimeCheckStatus {
  const message = probe.message?.toLowerCase() ?? ''
  if (probe.route === 'gateway' && (message.includes('stopped') || message.includes('disabled'))) {
    return message.includes('disabled') ? 'gateway-required' : 'gateway-stopped'
  }
  switch (probe.status) {
    case 'ready':
      return 'ready'
    case 'auth-failed':
      return 'auth-failed'
    case 'forbidden':
      return 'forbidden'
    case 'protocol-unsupported':
      return 'protocol-unsupported'
    case 'timeout':
      return 'timeout'
    case 'network-error':
      return 'network-error'
    default:
      return 'unknown'
  }
}

function defaultProbeSummary(
  status: AgentRuntimeProbeSnapshot['status'],
  route: 'direct' | 'gateway'
): string {
  const label = route === 'direct' ? 'Direct Claude Code' : 'Agent model gateway'
  switch (status) {
    case 'ready':
      return `${label} probe passed.`
    case 'auth-failed':
      return `${label} authentication failed.`
    case 'forbidden':
      return `${label} access was forbidden.`
    case 'protocol-unsupported':
      return `${label} protocol is unsupported.`
    case 'timeout':
      return `${label} probe timed out.`
    case 'network-error':
      return `${label} network error.`
    default:
      return `${label} probe result is unknown.`
  }
}
