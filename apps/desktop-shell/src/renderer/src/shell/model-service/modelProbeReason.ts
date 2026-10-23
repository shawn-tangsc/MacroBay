import type { ModelDetectionSkipReasonCode } from '@platform/ai/providers/modelDetection/types'

import type { PlatformText } from '../../i18n/platformText'

/**
 * PLAT-82：原因码 → 人话的**唯一实现**（模型行内状态与任何失败明细共用）。
 *
 * 只接受检测真实会产生的原因码（设计 §4）；不存在 `http_4xx`，也不再有「未验证 / 已验证」。
 */
export function probeReasonLabel(labels: PlatformText['models'], reason: string | undefined): string {
  if (reason === 'model_not_activated') return labels.probeReasonModelNotActivated
  if (reason === 'model_not_found') return labels.connectionCheckReasonModelNotFound
  // PLAT-66：模型生命周期（已下线 / 无可用渠道）要说清，不再落「其它原因」。
  if (reason === 'model_retired') return labels.connectionCheckReasonModelRetired
  if (reason === 'model_unavailable') return labels.connectionCheckReasonModelUnavailable
  if (reason === 'endpoint_unsupported') return labels.probeReasonEndpointUnsupported
  if (reason === 'endpoint_missing') return labels.probeReasonEndpointMissing
  if (reason === 'missing_api_key') return labels.connectionCheckReasonMissingApiKey
  if (reason === 'timeout') return labels.probeReasonTimeout
  if (reason === 'http_401' || reason === 'http_403' || reason === 'unauthorized') return labels.probeReasonAuth
  if (reason === 'rate_limited' || reason === 'http_429') return labels.probeReasonRateLimit
  if (reason === 'account_balance_insufficient') return labels.probeReasonBalance
  if (reason === 'cancelled') return labels.probeReasonCancelled
  if (reason === 'network_error') return labels.probeReasonNetworkError
  if (reason !== undefined && /^http_4\d\d$/.test(reason)) return labels.probeReasonHttp4xx
  if (reason === 'http_5xx' || (reason !== undefined && /^http_5\d\d$/.test(reason)) || reason === 'server_error') {
    return labels.probeReasonHttp5xx
  }
  if (reason?.startsWith('network_')) return labels.probeReasonNetwork
  return labels.probeReasonOther
}

/** PLAT-82：跳过原因码 → 人话（`ModelDetectionSkipReasonCode` 四个码）。 */
export function probeSkipReasonLabel(
  labels: PlatformText['models'],
  reason: ModelDetectionSkipReasonCode | undefined
): string {
  if (reason === 'non_text_generation') return labels.probeSkipNonTextGeneration
  if (reason === 'provider_disabled') return labels.probeSkipProviderDisabled
  if (reason === 'not_chat_model') return labels.probeSkipNotChatModel
  if (reason === 'protocol_not_configured') return labels.probeSkipProtocolNotConfigured
  return labels.probeReasonOther
}
