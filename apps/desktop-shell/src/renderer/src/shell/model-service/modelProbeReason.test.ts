import { describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { probeReasonLabel, probeSkipReasonLabel } from './modelProbeReason'

/**
 * PLAT-82：原因码 → 人话的**唯一实现**。
 * 只覆盖检测真实会产生的原因码（设计 §4）；不存在 `http_4xx`。
 */
describe('PLAT-82 probe reason labels', () => {
  const labels = platformText['en-US'].models

  it('maps HTTP / network / timeout reasons', () => {
    expect(probeReasonLabel(labels, 'http_404')).toBe(labels.probeReasonHttp4xx)
    expect(probeReasonLabel(labels, 'http_500')).toBe(labels.probeReasonHttp5xx)
    expect(probeReasonLabel(labels, 'http_5xx')).toBe(labels.probeReasonHttp5xx)
    expect(probeReasonLabel(labels, 'timeout')).toBe(labels.probeReasonTimeout)
    expect(probeReasonLabel(labels, 'network_error')).toBe(labels.probeReasonNetworkError)
    expect(probeReasonLabel(labels, 'network_dns')).toBe(labels.probeReasonNetwork)
    expect(probeReasonLabel(labels, 'http_429')).toBe(labels.probeReasonRateLimit)
    expect(probeReasonLabel(labels, 'account_balance_insufficient')).toBe(labels.probeReasonBalance)
    expect(probeReasonLabel(labels, 'http_401')).toBe(labels.probeReasonAuth)
  })

  it('labels the endpoint-level and cancellation codes added by the redesign', () => {
    expect(probeReasonLabel(labels, 'endpoint_unsupported')).toBe(labels.probeReasonEndpointUnsupported)
    expect(probeReasonLabel(labels, 'endpoint_missing')).toBe(labels.probeReasonEndpointMissing)
    expect(probeReasonLabel(labels, 'cancelled')).toBe(labels.probeReasonCancelled)
    expect(probeReasonLabel(labels, 'missing_api_key')).toBe(labels.connectionCheckReasonMissingApiKey)
  })

  // PLAT-66：模型生命周期原因也要说人话，而不是落「其它原因」。
  it('labels the model lifecycle failures with the shared sentences', () => {
    expect(probeReasonLabel(labels, 'model_retired')).toBe(labels.connectionCheckReasonModelRetired)
    expect(probeReasonLabel(labels, 'model_unavailable')).toBe(labels.connectionCheckReasonModelUnavailable)
    expect(probeReasonLabel(labels, 'model_not_found')).toBe(labels.connectionCheckReasonModelNotFound)
    expect(probeReasonLabel(labels, 'model_not_activated')).toBe(labels.probeReasonModelNotActivated)
    expect(probeReasonLabel(labels, 'unexpected_body')).toBe(labels.probeReasonOther)
  })

  it('labels the four skip reason codes', () => {
    expect(probeSkipReasonLabel(labels, 'non_text_generation')).toBe(labels.probeSkipNonTextGeneration)
    expect(probeSkipReasonLabel(labels, 'provider_disabled')).toBe(labels.probeSkipProviderDisabled)
    expect(probeSkipReasonLabel(labels, 'not_chat_model')).toBe(labels.probeSkipNotChatModel)
    expect(probeSkipReasonLabel(labels, 'protocol_not_configured')).toBe(labels.probeSkipProtocolNotConfigured)
    expect(probeSkipReasonLabel(labels, undefined)).toBe(labels.probeReasonOther)
  })
})
