import type { ProviderConnectionFailureCode } from '../../../providers/providerConnection'
import { endpointProbeVerdicts } from '../../../providers/providerEndpointProbe'
import type { EndpointProbeVerdict } from '../../../providers/providerEndpointProbe'

import type {
  AgentRuntimeCompatibilityResult,
  AgentRuntimeId,
  AgentRuntimeRoute
} from './agentRuntimeCompatibilityTypes'

export type ProviderRuntimeCheckLane =
  | 'ordinary-chat'
  | 'claude-code-direct'
  | 'claude-code-gateway'
  | 'openai-agents'

export type ProviderRuntimeCheckStatus =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'auth-failed'
  | 'forbidden'
  | 'protocol-unsupported'
  | 'gateway-required'
  | 'gateway-stopped'
  | 'network-error'
  | 'timeout'
  | 'unknown'

export type ProviderRuntimeCheckLaneResult = {
  lane: ProviderRuntimeCheckLane
  status: ProviderRuntimeCheckStatus
  summary: string
  /**
   * PLAT-61 诊断可用性：失败时的**可判定原因**（可选，旧报告没有该字段仍合法）。
   * `provider_disabled` / `missing_api_key` 由渲染层结合供应商状态判定，探针只产出传输/HTTP 类 code。
   */
  failureCode?: ProviderConnectionFailureCode
  /** PLAT-61：上游响应体里的错误 message（已脱敏/截断），用于主文案 `{原因}：{上游 message}`。 */
  upstreamMessage?: string
  checkedAt?: string
  route?: Extract<AgentRuntimeRoute, 'direct' | 'gateway' | 'none'>
}

/**
 * PLAT-63：`endpoints` 里的 `responses` / `gemini` 已配置时的端点 lane。
 * 判定沿用端点探测的语义（可用 / 不存在 / 鉴权失败 / 参数问题 / 不可达 / 暂不支持）。
 */
export type ProviderRuntimeCheckEndpointLane = {
  verdict: EndpointProbeVerdict
  status: number | null
  /** 已脱敏的一句话（≤200）；可为空。 */
  message?: string
  checkedAt?: string
}

export type ProviderRuntimeCheckReport = {
  providerId: string
  modelId: string
  runtimeId: AgentRuntimeId
  ordinaryChat: ProviderRuntimeCheckLaneResult
  /** PLAT-63：只在配置了 Responses 端点时出现；聊天主链路仍是 chat/completions。 */
  responses?: ProviderRuntimeCheckEndpointLane
  /** PLAT-63 第二阶段 A：只在配置了 Gemini 端点时出现（与 responses 同构）。 */
  gemini?: ProviderRuntimeCheckEndpointLane
  direct?: ProviderRuntimeCheckLaneResult
  gateway?: ProviderRuntimeCheckLaneResult
  finalCompatibility: AgentRuntimeCompatibilityResult
  updatedAt: string
  signature: string
}

export type SafeProviderRuntimeCheckReport = ProviderRuntimeCheckReport

const REPORT_STALE_MS = 15 * 60 * 1000

export function buildProviderRuntimeCheckReportKey(
  providerId: string,
  modelId: string,
  runtimeId: AgentRuntimeId
): string {
  return `${providerId}:${modelId}:${runtimeId}`
}

export function isProviderRuntimeCheckReport(value: unknown): value is ProviderRuntimeCheckReport {
  if (!value || typeof value !== 'object') return false
  const report = value as Partial<ProviderRuntimeCheckReport>
  return (
    typeof report.providerId === 'string' &&
    typeof report.modelId === 'string' &&
    (report.runtimeId === 'claude-code' || report.runtimeId === 'openai-agents') &&
    isLaneResult(report.ordinaryChat) &&
    isCompatibilityResult(report.finalCompatibility) &&
    typeof report.updatedAt === 'string' &&
    typeof report.signature === 'string' &&
    (report.direct === undefined || isLaneResult(report.direct)) &&
    (report.gateway === undefined || isLaneResult(report.gateway)) &&
    (report.responses === undefined || isEndpointLane(report.responses)) &&
    (report.gemini === undefined || isEndpointLane(report.gemini))
  )
}

export function normalizeProviderRuntimeCheckReport(
  value: unknown
): ProviderRuntimeCheckReport | null {
  if (!isProviderRuntimeCheckReport(value)) return null
  return {
    providerId: value.providerId,
    modelId: value.modelId,
    runtimeId: value.runtimeId,
    ordinaryChat: normalizeLaneResult(value.ordinaryChat, 'ordinary-chat'),
    ...(value.responses ? { responses: normalizeEndpointLane(value.responses) } : {}),
    ...(value.gemini ? { gemini: normalizeEndpointLane(value.gemini) } : {}),
    ...(value.direct ? { direct: normalizeLaneResult(value.direct, 'claude-code-direct') } : {}),
    ...(value.gateway ? { gateway: normalizeLaneResult(value.gateway, 'claude-code-gateway') } : {}),
    finalCompatibility: value.finalCompatibility,
    updatedAt: value.updatedAt,
    signature: value.signature
  }
}

export function isProviderRuntimeCheckReportStale(
  report: ProviderRuntimeCheckReport,
  options: { now?: Date; signature?: string; staleMs?: number } = {}
): boolean {
  if (options.signature && options.signature !== report.signature) return true
  const nowMs = (options.now ?? new Date()).getTime()
  const updatedMs = Date.parse(report.updatedAt)
  if (!Number.isFinite(updatedMs)) return true
  return nowMs - updatedMs > (options.staleMs ?? REPORT_STALE_MS)
}

export type ProviderRuntimeCheckGatewayView = {
  enabled: boolean
  state: string
}

export function isProviderRuntimeCheckReportStaleForGateway(
  report: ProviderRuntimeCheckReport,
  gateway: ProviderRuntimeCheckGatewayView | null | undefined
): boolean {
  const running = gateway?.enabled === true && gateway.state === 'running'
  if (report.finalCompatibility.route === 'gateway' && report.finalCompatibility.selectable) {
    return !running
  }
  if (
    report.finalCompatibility.status === 'gateway-stopped' ||
    report.finalCompatibility.status === 'gateway-required'
  ) {
    return running
  }
  if (report.gateway?.status === 'ready' && !running) {
    return true
  }
  return false
}

export function isGatewayDependentRuntimeCheckReport(report: ProviderRuntimeCheckReport): boolean {
  return (
    report.finalCompatibility.route === 'gateway' ||
    report.finalCompatibility.status === 'gateway-required' ||
    report.finalCompatibility.status === 'gateway-stopped' ||
    (report.gateway != null && report.gateway.status !== 'idle')
  )
}

export function createIdleLaneResult(
  lane: ProviderRuntimeCheckLane,
  summary = 'Not checked yet.'
): ProviderRuntimeCheckLaneResult {
  return {
    lane,
    status: 'idle',
    summary
  }
}

function normalizeLaneResult(
  value: ProviderRuntimeCheckLaneResult,
  fallbackLane: ProviderRuntimeCheckLane
): ProviderRuntimeCheckLaneResult {
  return {
    lane: value.lane || fallbackLane,
    status: value.status,
    summary: value.summary,
    ...(value.failureCode ? { failureCode: value.failureCode } : {}),
    ...(value.upstreamMessage ? { upstreamMessage: value.upstreamMessage } : {}),
    ...(value.checkedAt ? { checkedAt: value.checkedAt } : {}),
    ...(value.route ? { route: value.route } : {})
  }
}

function normalizeEndpointLane(value: ProviderRuntimeCheckEndpointLane): ProviderRuntimeCheckEndpointLane {
  return {
    verdict: value.verdict,
    status: value.status,
    ...(value.message ? { message: value.message } : {}),
    ...(value.checkedAt ? { checkedAt: value.checkedAt } : {})
  }
}

function isEndpointLane(value: unknown): value is ProviderRuntimeCheckEndpointLane {
  if (!value || typeof value !== 'object') return false
  const lane = value as Partial<ProviderRuntimeCheckEndpointLane>
  return (
    typeof lane.verdict === 'string' &&
    // verdict 必须是已知判定：未知值一律视为脏报告。
    (endpointProbeVerdicts as readonly string[]).includes(lane.verdict) &&
    (lane.status === null || typeof lane.status === 'number')
  )
}

function isLaneResult(value: unknown): value is ProviderRuntimeCheckLaneResult {
  if (!value || typeof value !== 'object') return false
  const lane = value as Partial<ProviderRuntimeCheckLaneResult>
  return typeof lane.lane === 'string' && typeof lane.status === 'string' && typeof lane.summary === 'string'
}

function isCompatibilityResult(value: unknown): value is AgentRuntimeCompatibilityResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<AgentRuntimeCompatibilityResult>
  return (
    typeof result.providerId === 'string' &&
    typeof result.modelId === 'string' &&
    typeof result.runtimeId === 'string' &&
    typeof result.selectable === 'boolean' &&
    typeof result.route === 'string' &&
    typeof result.status === 'string' &&
    typeof result.summary === 'string'
  )
}
