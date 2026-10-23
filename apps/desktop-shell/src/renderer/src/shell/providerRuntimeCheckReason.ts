import {
  isModelRetiredFailure,
  isModelUnavailableFailure,
  type ProviderConnectionFailureCode
} from '@platform/ai/providers/providerConnection'

import type { PlatformText } from '../i18n/platformText'

/**
 * PLAT-61 诊断可用性：把「检查失败」从笼统一句变成**可判定原因**。
 *
 * 分层：
 *  - 主进程探针（`providerConnection`）负责把底层错误/HTTP 状态映射成 `failureCode`；
 *  - 这里只做**渲染层判定**：优先用探针给的 code；旧报告没有 code 时按 status / summary 兜底；
 *    `provider_disabled` / `missing_api_key` 由渲染层结合当前供应商状态判定（探针强制按启用探测）；
 *  - 文案：每个 code 一句人话（EN/ZH 成对，直接取 `platformText.models` 的既有键）。
 *
 * 不猜原则：兜底只看稳定的状态码/错误码关键字；判断不出来就返回 null，UI 保留原始 summary。
 */
export type ProviderRuntimeCheckReasonCode =
  | ProviderConnectionFailureCode
  | 'provider_disabled'
  | 'gateway_disabled'
  | 'model_runtime_disabled'
  | 'unknown'

export type ProviderRuntimeCheckReasonLabels = Pick<
  PlatformText['models'],
  | 'connectionCheckReasonProviderDisabled'
  | 'connectionCheckReasonMissingApiKey'
  | 'connectionCheckReasonUnauthorized'
  | 'connectionCheckReasonDns'
  | 'connectionCheckReasonRefused'
  | 'connectionCheckReasonTimeout'
  | 'connectionCheckReasonTls'
  | 'connectionCheckReasonProxy'
  | 'connectionCheckReasonModelNotFound'
  | 'connectionCheckReasonHttp'
  | 'connectionCheckReasonForbidden'
  | 'connectionCheckReasonNotFound'
  | 'connectionCheckReasonServerError'
  | 'connectionCheckReasonInvalidResponse'
  | 'connectionCheckReasonUnknown'
  | 'connectionCheckReasonRateLimited'
  | 'connectionCheckReasonProtocolUnsupported'
  | 'connectionCheckReasonProtocolUnsupportedHint'
  | 'connectionCheckReasonModelRetired'
  | 'connectionCheckReasonModelUnavailable'
  | 'connectionCheckReasonGeminiNativeMissing'
  | 'connectionCheckReasonAccountBalance'
  | 'connectionCheckReasonGatewayDisabled'
  | 'connectionCheckReasonModelRuntimeDisabled'
  | 'connectionCheckAgentUsableDirect'
  | 'connectionCheckAgentUsableGateway'
  | 'connectionCheckAssistantUsable'
  | 'connectionCheckGatewayRequired'
  | 'connectionCheckProbeTimeout'
  | 'connectionCheckAgentUnconfirmedTimeout'
  | 'connectionCheckOptionalRuntimeDisabled'
  /** PLAT-66 追加：该供应商没有 Anthropic 端点 ⇒ 智能体运行时不可用（不影响普通聊天）。 */
  | 'connectionCheckAgentNeedsAnthropicEndpoint'
  | 'connectionCheckAgentNeedsAnthropicEndpointHint'
  | 'connectionCheckOptionalGatewayDisabled'
  /**
   * PLAT-63：Responses 端点 lane 的标题与判定文案。
   * 与模型服务页端点行的「测试」共用同一套文案（可用/存在/鉴权失败/不存在/不可达/暂不支持）。
   */
  | 'requestConfigResponses'
  | 'connectionCheckGeminiNative'
  | 'endpointTestAvailable'
  | 'endpointTestExistsParamError'
  | 'endpointTestExistsAuthFailed'
  | 'endpointTestExists'
  | 'endpointTestMissing'
  | 'endpointTestUnreachable'
  | 'endpointTestNoModel'
  | 'endpointTestUnsupported'
>

export type ProviderRuntimeCheckReasonInput = {
  failureCode?: ProviderConnectionFailureCode
  status: string
  summary: string
  providerEnabled: boolean
  hasApiKey: boolean
}

const READY_STATUSES = new Set(['ready', 'checking', 'idle'])

/** 归到「网络/代理」一类的 code（抽屉里的网络诊断只列这些）。 */
const NETWORK_REASON_CODES = new Set<string>([
  'network_dns',
  'network_refused',
  'network_timeout',
  'tls_error',
  'proxy_error',
  'dns_error',
  'connection_refused',
  'timeout',
  'invalid_response'
])

export function isNetworkProviderRuntimeCheckReason(code: ProviderRuntimeCheckReasonCode | null): boolean {
  return code !== null && NETWORK_REASON_CODES.has(code)
}

export function resolveProviderRuntimeCheckReasonCode(
  input: ProviderRuntimeCheckReasonInput
): ProviderRuntimeCheckReasonCode | null {
  if (READY_STATUSES.has(input.status)) return null
  // 供应商停用是用户当下最该修的一步（探针会按启用态探测，所以不能只看探针码）。
  if (!input.providerEnabled) return 'provider_disabled'
  if (input.failureCode) return input.failureCode
  if (!input.hasApiKey) return 'missing_api_key'

  switch (input.status) {
    case 'auth-failed':
    case 'forbidden':
      return 'unauthorized'
    case 'timeout':
      return 'network_timeout'
    case 'gateway-required':
      return 'gateway_disabled'
    case 'model-not-enabled':
      return 'model_runtime_disabled'
    case 'protocol-unsupported':
      return 'protocol_unsupported'
    default:
      break
  }

  return classifySummary(input.summary)
}

export function formatProviderRuntimeCheckReason(
  code: ProviderRuntimeCheckReasonCode | null,
  labels: ProviderRuntimeCheckReasonLabels,
  message?: string | null
): string | null {
  if (code === null) return null
  switch (code) {
    case 'provider_disabled':
      return labels.connectionCheckReasonProviderDisabled
    case 'missing_api_key':
      return labels.connectionCheckReasonMissingApiKey
    case 'unauthorized':
    case 'http_401':
      return labels.connectionCheckReasonUnauthorized
    case 'http_403':
      return labels.connectionCheckReasonForbidden
    case 'http_404':
      // Google 对已下线模型也返回 404：不能显示成"接口不存在"。
      if (isModelRetiredFailure(message ?? null)) return labels.connectionCheckReasonModelRetired
      if (isModelUnavailableFailure(message ?? null)) return labels.connectionCheckReasonModelUnavailable
      return labels.connectionCheckReasonNotFound
    case 'http_5xx':
      return labels.connectionCheckReasonServerError
    case 'network_dns':
    case 'dns_error':
      return labels.connectionCheckReasonDns
    case 'network_refused':
    case 'connection_refused':
      return labels.connectionCheckReasonRefused
    case 'network_timeout':
    case 'timeout':
      return labels.connectionCheckReasonTimeout
    case 'tls_error':
      return labels.connectionCheckReasonTls
    case 'proxy_error':
      return labels.connectionCheckReasonProxy
    case 'model_not_found':
      return labels.connectionCheckReasonModelNotFound
    case 'invalid_response':
      return labels.connectionCheckReasonInvalidResponse
    case 'rate_limited':
    case 'http_429':
      return labels.connectionCheckReasonRateLimited
    case 'protocol_unsupported':
      return labels.connectionCheckReasonProtocolUnsupported
    // PLAT-66：模型生命周期。必须排在 http_5xx / http_<status> 之前，否则 502 只会说「按状态码排查」。
    case 'model_retired':
      return labels.connectionCheckReasonModelRetired
    case 'model_unavailable':
      return labels.connectionCheckReasonModelUnavailable
    // PLAT-66：Gemini 主端点没配 ⇒ 这是配置缺项，先说清要填什么。
    case 'gemini_native_endpoint_missing':
      return labels.connectionCheckReasonGeminiNativeMissing
    case 'unknown':
      return labels.connectionCheckReasonUnknown
    case 'account_balance_insufficient':
      return labels.connectionCheckReasonAccountBalance
    case 'gateway_disabled':
      return labels.connectionCheckReasonGatewayDisabled
    case 'model_runtime_disabled':
      return labels.connectionCheckReasonModelRuntimeDisabled
    default: {
      const status = Number(code.slice('http_'.length))
      return code.startsWith('http_') && Number.isFinite(status)
        ? labels.connectionCheckReasonHttp(status)
        : labels.connectionCheckReasonUnknown
    }
  }
}

/** 旧报告（无 failureCode）的兜底：只认稳定的状态码/错误码关键字。 */
function classifySummary(summary: string): ProviderRuntimeCheckReasonCode | null {
  const text = summary.toLowerCase()
  if (!text.trim()) return null
  // PLAT-62：429 / overloaded 先于其它状态码（包括旧报告里的 `HTTP 429`）。
  if (/\b429\b|overloaded|rate[\s_-]?limit|too many requests|1305/.test(text)) return 'rate_limited'
  // 401/403 统一归到 unauthorized（与探针的映射一致），其余状态码用 http_<status>。
  if (/\b(401|403)\b|unauthorized|forbidden/.test(text)) return 'unauthorized'
  // PLAT-62：协议不支持先于泛化 HTTP 状态码（AIOnly 500 + 「messages协议」）。
  if (/messages\s*协议/.test(text) || /protocol/.test(text) ||
    (/(协议|protocol)/.test(text) && /(不支持|not support|unsupported|无渠道)/.test(text))) {
    return 'protocol_unsupported'
  }
  // PLAT-66：模型生命周期先于 `http_<status>` 兜底（七牛云 502 +「has been retired」）。
  if (isModelRetiredFailure(summary)) return 'model_retired'
  if (isModelUnavailableFailure(summary)) return 'model_unavailable'
  const http = text.match(/\bhttp\s*(\d{3})\b/)
  if (http) return `http_${Number(http[1])}` as ProviderRuntimeCheckReasonCode
  if (/enotfound|eai_again|getaddrinfo|name_not_resolved|\bdns\b/.test(text)) return 'network_dns'
  if (/econnrefused|econnreset|connection refused|connection reset/.test(text)) return 'network_refused'
  if (/etimedout|timed? ?out|timeout/.test(text)) return 'network_timeout'
  if (/cert|self[- ]signed|\btls\b|\bssl\b|eproto/.test(text)) return 'tls_error'
  if (/balance|insufficient|recharge|quota|credit/.test(text)) return 'account_balance_insufficient'
  if (/\bproxy\b|socks/.test(text)) return 'proxy_error'
  if (/gateway/.test(text) && /(disabled|not enabled|required)/.test(text)) return 'gateway_disabled'
  if (/not enabled for claude code|model-not-enabled/.test(text)) return 'model_runtime_disabled'
  if (/model/.test(text) && /(not found|does not exist|no such|invalid)/.test(text)) return 'model_not_found'
  return null
}
