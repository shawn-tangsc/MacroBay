import type { EndpointProbeResult } from '@platform/ai/providers/providerEndpointProbe'

import type { PlatformText } from '../../i18n/platformText'

/**
 * PLAT-63：端点探测判定 → 一句人话。
 * 行内「测试」结果与连接检查的 Responses lane 共用这一套标签，避免两处文案漂移。
 */
export type EndpointTestLabels = Pick<
  PlatformText['models'],
  | 'endpointTestAvailable'
  | 'endpointTestExistsParamError'
  | 'endpointTestExistsAuthFailed'
  | 'endpointTestExists'
  | 'endpointTestMissing'
  | 'endpointTestUnreachable'
  | 'endpointTestNoModel'
  | 'endpointTestUnsupported'
>

export type EndpointProbeDisplay = {
  tone: 'success' | 'warning' | 'error' | 'neutral'
  label: string
  /** 已脱敏的 detail（HTTP 状态 + 上游 message / 传输原因）；没有就 null。 */
  detail: string | null
}

export function describeEndpointProbe(
  result: Pick<EndpointProbeResult, 'verdict' | 'status' | 'message'>,
  labels: EndpointTestLabels
): EndpointProbeDisplay {
  const detail = result.message.trim().length > 0 ? result.message.trim() : null
  switch (result.verdict) {
    case 'available':
      return { tone: 'success', label: labels.endpointTestAvailable, detail }
    case 'exists_param_error':
      return { tone: 'warning', label: labels.endpointTestExistsParamError, detail }
    case 'exists_auth_failed':
      return { tone: 'warning', label: labels.endpointTestExistsAuthFailed, detail }
    case 'exists':
      return { tone: 'warning', label: labels.endpointTestExists, detail }
    case 'missing':
      return { tone: 'error', label: labels.endpointTestMissing, detail }
    case 'unreachable':
      return { tone: 'error', label: labels.endpointTestUnreachable, detail }
    case 'no_model':
      return { tone: 'neutral', label: labels.endpointTestNoModel, detail }
    case 'unsupported':
    default:
      return { tone: 'neutral', label: labels.endpointTestUnsupported, detail }
  }
}
