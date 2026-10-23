import type { ProviderRuntimeCheckEndpointLane } from '@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'

import { describeEndpointProbe } from './model-service/endpointTestDisplay'
import type {
  ProviderRuntimeCheckDisplayContext,
  ProviderRuntimeCheckDisplayLane,
  ProviderRuntimeCheckDisplayLabels
} from './providerRuntimeCheckDisplay'

/**
 * PLAT-63：追加端点（OpenAI Responses / Gemini 原生）已经接入连接检查后各自的 lane。
 * 单独成文件（保持主 display 文件 <300 行）；判定文案与模型服务页端点行右侧的「测试」完全共用
 * （同一套 可用 / 存在 / 鉴权失败 / 参数问题 / 不存在 / 不可达）。
 */
export function buildEndpointLane(
  key: Extract<ProviderRuntimeCheckDisplayLane['key'], 'responses' | 'gemini'>,
  title: string,
  lane: ProviderRuntimeCheckEndpointLane,
  labels: ProviderRuntimeCheckDisplayLabels,
  context: ProviderRuntimeCheckDisplayContext = { providerEnabled: true, hasApiKey: true }
): ProviderRuntimeCheckDisplayLane {
  // PLAT-66：供应商停用时端点 lane 也必须说「先启用」，不能把端点判定当成要修的问题。
  if (!context.providerEnabled) {
    return {
      key,
      title,
      status: 'unknown',
      summary: '',
      tone: 'warning',
      reasonCode: 'provider_disabled',
      upstreamMessage: null,
      reason: labels.reasons.connectionCheckReasonProviderDisabled,
      detail: null,
      hint: null,
      action: null
    }
  }
  const display = describeEndpointProbe(
    { verdict: lane.verdict, status: lane.status, message: lane.message ?? '' },
    labels.reasons
  )
  return {
    key,
    title,
    status: statusForVerdict(lane.verdict),
    summary: display.detail ?? display.label,
    tone: display.tone,
    reasonCode: null,
    upstreamMessage: null,
    reason: display.label,
    detail: display.detail,
    hint: null,
    action: null
  }
}

function statusForVerdict(
  verdict: ProviderRuntimeCheckEndpointLane['verdict']
): ProviderRuntimeCheckDisplayLane['status'] {
  if (verdict === 'available') return 'ready'
  if (verdict === 'exists_auth_failed') return 'auth-failed'
  if (verdict === 'unreachable') return 'network-error'
  return 'unknown'
}
