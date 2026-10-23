import type { ProviderRuntimeCheckReasonCode } from './providerRuntimeCheckReason'
import type {
  ProviderRuntimeCheckDisplayLabels,
  ProviderRuntimeCheckDisplayLane
} from './providerRuntimeCheckDisplay'

/**
 * PLAT-62：智能体最终结论的失败原因选择。
 * 硬失败优先级：协议 > 401/403 > 余额 > 限流；超时只算「暂无法确认」；
 * 其余情况才落到「需开启模型网关」。
 */
const HARD_FAILURE_PRIORITY: ProviderRuntimeCheckReasonCode[] = [
  'protocol_unsupported',
  'unauthorized',
  'http_401',
  'http_403',
  'account_balance_insufficient',
  'rate_limited'
]

export type AgentFailure = {
  lane?: ProviderRuntimeCheckDisplayLane
  reasonCode: ProviderRuntimeCheckReasonCode | null
  reason: string
  /** 超时等「无法确认」而非硬失败：结论用 warning + 可重试。 */
  unconfirmed: boolean
}

export function pickAgentFailure(
  direct: ProviderRuntimeCheckDisplayLane | undefined,
  gateway: ProviderRuntimeCheckDisplayLane | undefined,
  labels: ProviderRuntimeCheckDisplayLabels
): AgentFailure {
  const gatewayRequired = labels.reasons.connectionCheckGatewayRequired
  const candidates = [direct, gateway].filter((lane): lane is ProviderRuntimeCheckDisplayLane => lane !== undefined)
  for (const code of HARD_FAILURE_PRIORITY) {
    const lane = candidates.find((candidate) => candidate.reasonCode === code)
    if (!lane) continue
    return { lane, reasonCode: code, reason: lane.reason ?? gatewayRequired, unconfirmed: false }
  }
  // 只有直连超时（协议未确认）+ 网关没开 ⇒ 暂无法确认，而不是断言"需开启网关"。
  if (direct?.reasonCode === 'network_timeout') {
    return {
      lane: direct,
      reasonCode: 'network_timeout',
      reason: labels.reasons.connectionCheckAgentUnconfirmedTimeout,
      unconfirmed: true
    }
  }
  const gatewayLane = candidates.find((candidate) => candidate.reasonCode === 'gateway_disabled')
  if (gatewayLane) {
    return { lane: gatewayLane, reasonCode: 'gateway_disabled', reason: gatewayRequired, unconfirmed: false }
  }
  const first = candidates[0]
  return {
    lane: first,
    reasonCode: first?.reasonCode ?? null,
    reason: first?.reason ?? gatewayRequired,
    unconfirmed: false
  }
}
