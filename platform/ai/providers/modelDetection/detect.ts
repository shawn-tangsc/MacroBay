import type { ModelChatProtocol, ModelDefinition, ModelProvider } from '../modelProviderTypes'
import {
  classifyHttpFailure,
  classifyProviderTransportFailure,
  sanitizeUpstreamMessage
} from '../providerFailureMapping'
import { isEndpointUnsupported } from './endpointUnsupported'
import {
  MODEL_DETECTION_TIMEOUT_MS,
  type ModelDetectionMode,
  type ModelDetectionReasonCode,
  type ModelDetectionResult,
  type ModelProtocolProbeOutcome
} from './types'
import { planConnectivityProbe, planProtocolProbes, type ProviderProbeRequest } from './requests'

export type ModelDetectionOptions = {
  fetch: typeof fetch
  timeoutMs?: number
  signal?: AbortSignal
}

type ProbeOutcome = { ok: true } | { ok: false; reasonCode: ModelDetectionReasonCode; detail?: string }

async function readFailureText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 2_000)
  } catch {
    return ''
  }
}

async function executeProbe(request: ProviderProbeRequest, options: ModelDetectionOptions): Promise<ProbeOutcome> {
  if (options.signal?.aborted) return { ok: false, reasonCode: 'cancelled' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('model-detection-timeout')), options.timeoutMs ?? MODEL_DETECTION_TIMEOUT_MS)
  const onAbort = (): void => controller.abort(new Error('model-detection-cancelled'))
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await options.fetch(request.url, { ...request.init, signal: controller.signal })
    if (response.ok) return { ok: true }
    const bodyText = await readFailureText(response)
    const message = sanitizeUpstreamMessage(bodyText, '') ?? ''
    if (isEndpointUnsupported(request.target, response.status, bodyText)) {
      return { ok: false, reasonCode: 'endpoint_unsupported', ...(message ? { detail: message } : {}) }
    }
    const reasonCode = classifyHttpFailure(response.status, message, bodyText)
    // protocol_unsupported 一律归并为 endpoint_unsupported（不留透传路径）。
    const normalized: ModelDetectionReasonCode = reasonCode === 'protocol_unsupported' ? 'endpoint_unsupported' : reasonCode
    return { ok: false, reasonCode: normalized, ...(message ? { detail: message } : {}) }
  } catch (error) {
    if (options.signal?.aborted) return { ok: false, reasonCode: 'cancelled' }
    const transport = classifyProviderTransportFailure(error)
    return { ok: false, reasonCode: (transport === 'network_timeout' ? 'timeout' : transport ?? 'network_error') as ModelDetectionReasonCode }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * 供应商级前置（§2.0）：未启用 ⇒ 全部 skipped: provider_disabled；没有可用 Key ⇒ 全部
 * failed: missing_api_key，**都不发请求**。
 */
function providerPrecheck(
  provider: ModelProvider
): { kind: 'skip'; reasonCode: 'provider_disabled' } | { kind: 'fail'; reasonCode: 'missing_api_key' } | null {
  if (provider.enabled === false) return { kind: 'skip', reasonCode: 'provider_disabled' }
  if (!provider.apiKey?.trim()) return { kind: 'fail', reasonCode: 'missing_api_key' }
  return null
}

function declaresProtocol(model: ModelDefinition, protocol: ModelChatProtocol): boolean {
  if (protocol === 'messages') return model.messagesSupport === 'yes'
  if (protocol === 'responses') return model.responsesSupport === 'yes'
  return false
}

/** 汇总状态：任一 failed ⇒ failed；否则 skipped 优先于 ok。 */
function summarize(
  result: ModelDetectionResult,
  protocols: readonly ModelProtocolProbeOutcome[] | undefined
): void {
  const connectivity = result.connectivity
  if (connectivity?.status === 'cancelled') {
    result.status = 'cancelled'
    return
  }
  if (connectivity?.status === 'failed' && connectivity.reasonCode === 'cancelled') {
    result.status = 'cancelled'
    result.reasonCode = 'cancelled'
    return
  }
  if (connectivity?.status === 'failed') {
    result.status = 'failed'
    result.reasonCode = connectivity.reasonCode
    return
  }
  if (protocols?.some((entry) => entry.reasonCode === 'cancelled')) {
    result.status = 'cancelled'
    result.reasonCode = 'cancelled'
    return
  }
  if (protocols?.some((entry) => !entry.ok)) {
    const failed = protocols.find((entry) => !entry.ok)
    result.status = 'failed'
    result.reasonCode = failed?.reasonCode ?? 'endpoint_unsupported'
    return
  }
  if (connectivity?.status === 'skipped' || result.protocolSkipReason) {
    result.status = 'skipped'
    return
  }
  result.status = 'ok'
}

/** 单模型检测：按所选模式产出完整明细（不写任何持久化）。 */
export async function detectModel(
  provider: ModelProvider,
  model: ModelDefinition,
  modes: readonly ModelDetectionMode[],
  options: ModelDetectionOptions & { runId: string }
): Promise<ModelDetectionResult> {
  const result: ModelDetectionResult = { runId: options.runId, modelId: model.id, status: 'ok' }
  const precheck = providerPrecheck(provider)
  let protocolOutcomes: ModelProtocolProbeOutcome[] | undefined
  // 单模型内**跨模式去重**：两个模式选同一条通道时，url+body 相同只发一次。
  // 复用的一定是**结论**（成功或失败），并如实标 `reused`：不允许静默变成"没测"。
  const probed = new Map<string, ProbeOutcome>()
  async function probeOnce(request: ProviderProbeRequest): Promise<{ outcome: ProbeOutcome; reused: boolean }> {
    const key = `${request.url}\u0000${String(request.init.body ?? '')}`
    const cached = probed.get(key)
    if (cached) return { outcome: cached, reused: true }
    const outcome = await executeProbe(request, options)
    probed.set(key, outcome)
    return { outcome, reused: false }
  }

  if (modes.includes('connectivity')) {
    if (precheck?.kind === 'skip') {
      result.connectivity = { status: 'skipped', reasonCode: precheck.reasonCode }
    } else if (precheck?.kind === 'fail') {
      result.connectivity = { status: 'failed', reasonCode: precheck.reasonCode }
    } else {
      const plan = planConnectivityProbe(provider, model)
      if (plan.kind === 'skipped') result.connectivity = { status: 'skipped', reasonCode: plan.reasonCode }
      else if (plan.kind === 'failed') result.connectivity = { status: 'failed', reasonCode: plan.reasonCode }
      else {
        const { outcome } = await probeOnce(plan.request)
        result.connectivity = outcome.ok
          ? { status: 'ok' }
          : { status: 'failed', reasonCode: outcome.reasonCode, ...(outcome.detail ? { detail: outcome.detail } : {}) }
      }
    }
  }

  if (modes.includes('protocol')) {
    if (precheck?.kind === 'skip') {
      result.protocolSkipReason = precheck.reasonCode
    } else if (precheck?.kind === 'fail') {
      result.protocolSkipReason = precheck.reasonCode
    } else if (!model.capabilities.chat) {
      result.protocolSkipReason = 'not_chat_model'
    } else {
      const plans = planProtocolProbes(provider, model)
      if (plans.length === 0) {
        result.protocolSkipReason = 'protocol_not_configured'
      } else {
        const outcomes: ModelProtocolProbeOutcome[] = []
        for (const plan of plans) {
          const { outcome, reused } = await probeOnce(plan.request)
          outcomes.push({
            protocol: plan.protocol,
            ok: outcome.ok,
            ...(outcome.ok ? {} : { reasonCode: outcome.reasonCode }),
            ...(reused ? { reused: true } : {})
          })
        }
        protocolOutcomes = outcomes
        result.declaredProtocolFailures = outcomes
          .filter((entry) => !entry.ok && declaresProtocol(model, entry.protocol))
          .map((entry) => entry.protocol)
      }
    }
    if (protocolOutcomes) Object.assign(result, { protocols: protocolOutcomes })
  }

  summarize(result, protocolOutcomes)
  return result
}
