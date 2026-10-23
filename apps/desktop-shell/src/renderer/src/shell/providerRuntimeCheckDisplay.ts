import type {
  ProviderRuntimeCheckLaneResult,
  ProviderRuntimeCheckReport,
  ProviderRuntimeCheckStatus
} from '@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'

import {
  formatProviderRuntimeCheckReason,
  resolveProviderRuntimeCheckReasonCode,
  type ProviderRuntimeCheckReasonCode,
  type ProviderRuntimeCheckReasonLabels
} from './providerRuntimeCheckReason'
import { pickAgentFailure } from './providerRuntimeCheckAgentVerdict'
import { buildEndpointLane } from './providerRuntimeCheckEndpointLanes'

export type ProviderRuntimeCheckDisplayLane = {
  key: 'ordinaryChat' | 'responses' | 'gemini' | 'direct' | 'gateway' | 'final'
  title: string
  status: ProviderRuntimeCheckStatus | 'ready' | 'unknown'
  summary: string
  tone: 'success' | 'warning' | 'error' | 'neutral' | 'info'
  /** PLAT-61：可判定原因（人话）；失败项一定有值（无法判定时是「无法判定」文案）。 */
  reason: string | null
  /** 结构化 code，供「网络诊断」按类别过滤。 */
  reasonCode: ProviderRuntimeCheckReasonCode | null
  /** 上游响应体里的错误 message（已脱敏）；主文案用它拼 `{原因}：{上游}`。 */
  upstreamMessage: string | null
  /** PLAT-61：保留原始 message 作为 detail（仅在有 reason 时给，避免重复）。 */
  detail: string | null
  /** PLAT-61：Claude Code 两条失败时的灰字说明（不影响普通聊天）。 */
  hint: string | null
  /** 需要就地动作时的入口（「开启网关」/「重试」）。 */
  action: 'enable-gateway' | 'retry' | null
}

export type ProviderRuntimeCheckDisplayModel = {
  overallOk: boolean
  overallTone: 'success' | 'warning' | 'error'
  overallMessage: string
  lanes: ProviderRuntimeCheckDisplayLane[]
}

export type ProviderRuntimeCheckDisplayLabels = {
  ordinaryChat: string
  direct: string
  gateway: string
  final: string
  ready: string
  notReady: string
  checking: string
  mixed: string
  reasons: ProviderRuntimeCheckReasonLabels
  detailPrefix: string
  irrelevantHint: string
  /** 「开启后才能用 Claude Code 网关路由；不影响普通聊天」 */
  gatewayDisabledHint: string
}

/** 判定 `provider_disabled` / `missing_api_key` 需要当前供应商状态（探针会按启用态探测）。 */
export type ProviderRuntimeCheckDisplayContext = {
  providerEnabled: boolean
  hasApiKey: boolean
}

export function buildProviderRuntimeCheckDisplay(
  report: ProviderRuntimeCheckReport,
  labels: ProviderRuntimeCheckDisplayLabels,
  context: ProviderRuntimeCheckDisplayContext = { providerEnabled: true, hasApiKey: true }
): ProviderRuntimeCheckDisplayModel {
  const directReady = report.direct?.status === 'ready'
  const gatewayReady = report.gateway?.status === 'ready'
  const lanes: ProviderRuntimeCheckDisplayLane[] = [
    toDisplayLane('ordinaryChat', labels.ordinaryChat, report.ordinaryChat, labels, context, {
      directReady,
      gatewayReady
    }),
    // PLAT-63：配置了追加端点才有对应 lane：普通聊天 → Responses → Gemini。
    ...(report.responses
      ? [buildEndpointLane('responses', labels.reasons.requestConfigResponses, report.responses, labels, context)]
      : []),
    ...(report.gemini
      ? [buildEndpointLane('gemini', labels.reasons.connectionCheckGeminiNative, report.gemini, labels, context)]
      : []),
    ...(report.direct
      ? [toDisplayLane('direct', labels.direct, report.direct, labels, context, { directReady, gatewayReady })]
      : []),
    ...(report.gateway
      ? [toDisplayLane('gateway', labels.gateway, report.gateway, labels, context, { directReady, gatewayReady })]
      : [])
  ]

  // PLAT-62 更正：智能体结论只看 Claude Code 直连/网关；普通聊天只证明「助手可用」。
  const direct = lanes.find((lane) => lane.key === 'direct')
  const gateway = lanes.find((lane) => lane.key === 'gateway')
  const usableDirect = directReady
  const usableGateway = !directReady && gatewayReady
  const agentUsable = usableDirect || usableGateway
  const protocolFailed = lanes.some((lane) => lane.reasonCode === 'protocol_unsupported')

  // 供应商停用的结论优先于「无 Anthropic 端点」：停用就是停用。
  const noAnthropicLanes = !report.direct && !report.gateway && context.providerEnabled
  const failure = pickAgentFailure(direct, gateway, labels)
  // PLAT-66：供应商停用时即便报告里没有直连/网关 lane（openai-agents 报告），结论也只能是「先启用」。
  const providerDisabled = !context.providerEnabled
  const finalReasonCode: ProviderRuntimeCheckReasonCode | null = providerDisabled
    ? 'provider_disabled'
    : failure.reasonCode
  const final: ProviderRuntimeCheckDisplayLane = noAnthropicLanes
    ? {
        key: 'final',
        title: labels.final,
        status: 'unknown',
        summary: labels.reasons.connectionCheckAgentNeedsAnthropicEndpoint,
        tone: 'warning',
        reasonCode: null,
        upstreamMessage: null,
        reason: labels.reasons.connectionCheckAgentNeedsAnthropicEndpoint,
        detail: null,
        hint: labels.reasons.connectionCheckAgentNeedsAnthropicEndpointHint,
        action: null
      }
    : usableDirect
    ? buildUsableFinal(labels, labels.reasons.connectionCheckAgentUsableDirect, 'ready', report.direct?.summary)
    : usableGateway
      ? buildUsableFinal(labels, labels.reasons.connectionCheckAgentUsableGateway, 'ready', report.gateway?.summary)
      : {
          key: 'final',
          title: labels.final,
          status: failure.lane?.status ?? 'unknown',
          summary: failure.lane?.summary ?? report.finalCompatibility.summary,
          // 超时只是「暂无法确认」，供应商停用只是「还没启用」；两者都不是硬失败，用 warning。
          tone: failure.unconfirmed || finalReasonCode === 'provider_disabled' ? 'warning' : 'error',
          reasonCode: finalReasonCode,
          upstreamMessage: null,
          reason: providerDisabled ? labels.reasons.connectionCheckReasonProviderDisabled : failure.reason,
          detail: finalReasonCode === 'provider_disabled' ? null : failure.lane?.detail ?? null,
          hint: finalReasonCode === 'provider_disabled'
            ? null
            : protocolFailed
              ? labels.reasons.connectionCheckReasonProtocolUnsupportedHint
              : finalReasonCode === 'gateway_disabled'
                ? labels.gatewayDisabledHint
                : null,
          action: finalReasonCode === 'provider_disabled'
            ? null
            : finalReasonCode === 'gateway_disabled'
              ? 'enable-gateway'
              : failure.unconfirmed
                ? 'retry'
                : null
        }
  lanes.push(final)

  return {
    overallOk: noAnthropicLanes ? true : agentUsable,
    overallTone: noAnthropicLanes ? 'warning' : agentUsable
      ? 'success'
      : failure.unconfirmed || finalReasonCode === 'provider_disabled'
        ? 'warning'
        : 'error',
    overallMessage: noAnthropicLanes || agentUsable ? final.reason ?? labels.ready : final.reason ?? labels.notReady,
    lanes
  }
}

function buildUsableFinal(
  labels: ProviderRuntimeCheckDisplayLabels,
  reason: string,
  status: ProviderRuntimeCheckStatus,
  summary: string | undefined
): ProviderRuntimeCheckDisplayLane {
  return {
    key: 'final',
    title: labels.final,
    status,
    summary: summary ?? '',
    tone: 'success',
    reasonCode: null,
    upstreamMessage: null,
    reason,
    detail: null,
    hint: null,
    action: null
  }
}

function toDisplayLane(
  key: ProviderRuntimeCheckDisplayLane['key'],
  title: string,
  lane: ProviderRuntimeCheckLaneResult,
  labels: ProviderRuntimeCheckDisplayLabels,
  context: ProviderRuntimeCheckDisplayContext,
  readiness: { directReady: boolean; gatewayReady: boolean }
): ProviderRuntimeCheckDisplayLane {
  const failure = lane.status !== 'ready'
  let reasonCode = resolveReasonCode(lane.status, lane.summary, context, lane.failureCode, failure)
  // 供应商停用/缺 Key 优先于网关状态（否则会被误写成「需开启网关」）。
  const contextBlocked = reasonCode === 'provider_disabled' || reasonCode === 'missing_api_key'
  // PLAT-66：停用只是「还没启用」，不是上游失败：主文案只留「先启用」，绝不拼上游 message。
  const providerDisabled = reasonCode === 'provider_disabled'
  if (!contextBlocked && key === 'gateway' && (lane.status === 'gateway-stopped' || lane.status === 'gateway-required')) {
    reasonCode = 'gateway_disabled'
  }
  // 可选能力只在「另一条路可用」时用 info 解释，避免掩盖"两者都不可用"。
  const optionalRuntime =
    key === 'direct' && reasonCode === 'model_runtime_disabled' && readiness.gatewayReady
  const optionalGateway =
    !contextBlocked && key === 'gateway' && reasonCode === 'gateway_disabled' && readiness.directReady
  const optional = optionalRuntime || optionalGateway
  // 超时 ≠ 协议不支持：探针 lane 用 warning + 「重试」，直连超时提供重试动作。
  const probeTimeout = (key === 'direct' || key === 'gateway') && lane.status === 'timeout'
  const reason = providerDisabled
    ? labels.reasons.connectionCheckReasonProviderDisabled
    : optionalRuntime
      ? labels.reasons.connectionCheckOptionalRuntimeDisabled
      : optionalGateway
        ? labels.reasons.connectionCheckOptionalGatewayDisabled
        : probeTimeout
          ? labels.reasons.connectionCheckProbeTimeout
          : composeReason(formatProviderRuntimeCheckReason(reasonCode, labels.reasons, lane.upstreamMessage ?? null), lane.upstreamMessage ?? null)
  const assistantHint =
    key === 'ordinaryChat' && lane.status === 'ready'
      ? labels.reasons.connectionCheckAssistantUsable
      : null
  return {
    key,
    title,
    status: lane.status,
    summary: lane.summary,
    tone: providerDisabled ? 'warning' : optional ? 'info' : probeTimeout ? 'warning' : toneForStatus(lane.status),
    reasonCode,
    upstreamMessage: providerDisabled ? null : lane.upstreamMessage ?? null,
    reason,
    detail: failure && !optional && !providerDisabled ? summarizeDetail(lane.summary) : null,
    hint: providerDisabled
      ? null
      : optional || probeTimeout
        ? null
        : (assistantHint ?? resolveLaneHint(key, toneForStatus(lane.status), reasonCode, labels)),
    action: providerDisabled || contextBlocked
      ? null
      : reasonCode === 'gateway_disabled'
        ? 'enable-gateway'
        : probeTimeout && key === 'direct'
          ? 'retry'
          : null
  }
}

function resolveReasonCode(
  status: string,
  summary: string,
  context: ProviderRuntimeCheckDisplayContext,
  failureCode: ProviderRuntimeCheckLaneResult['failureCode'] | undefined,
  failure: boolean
): ProviderRuntimeCheckReasonCode | null {
  const code = resolveProviderRuntimeCheckReasonCode({
    failureCode,
    status,
    summary,
    providerEnabled: context.providerEnabled,
    hasApiKey: context.hasApiKey
  })
  // PLAT-61：主行必须是具体原因；确实无法归类时用「无法判定（见原始信息）」，
  // 绝不把 `Connection failed.` 这类笼统串当主文案。
  return code ?? (failure ? 'unknown' : null)
}

/** 主文案 = `{归类原因}：{上游 message}`；中文用全角冒号，英文用半角。 */
function composeReason(reason: string | null, upstreamMessage: string | null): string | null {
  if (reason === null) return null
  if (upstreamMessage === null || upstreamMessage.length === 0) return reason
  const separator = /[\u4e00-\u9fff]/.test(reason) ? '：' : ': '
  return `${reason}${separator}${upstreamMessage}`
}

function resolveLaneHint(
  key: ProviderRuntimeCheckDisplayLane['key'],
  tone: ProviderRuntimeCheckDisplayLane['tone'],
  reasonCode: ProviderRuntimeCheckReasonCode | null,
  labels: ProviderRuntimeCheckDisplayLabels
): string | null {
  if (reasonCode === 'model_runtime_disabled') return labels.irrelevantHint
  if (reasonCode === 'gateway_disabled') return labels.gatewayDisabledHint
  // PLAT-62：协议不支持的「开网关或换模型」建议行。
  if (reasonCode === 'protocol_unsupported') return labels.reasons.connectionCheckReasonProtocolUnsupportedHint
  return (key === 'direct' || key === 'gateway') && (tone === 'error' || tone === 'warning')
    ? labels.irrelevantHint
    : null
}

function summarizeDetail(summary: string): string | null {
  const detail = summary.trim()
  return detail.length === 0 ? null : detail
}

function toneForStatus(status: ProviderRuntimeCheckStatus): ProviderRuntimeCheckDisplayLane['tone'] {
  switch (status) {
    case 'ready':
      return 'success'
    case 'checking':
    case 'idle':
    case 'gateway-required':
    case 'gateway-stopped':
      return 'warning'
    case 'auth-failed':
    case 'forbidden':
    case 'protocol-unsupported':
    case 'network-error':
    case 'timeout':
      return 'error'
    default:
      return 'neutral'
  }
}
