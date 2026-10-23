import type { ModelProvider } from '../../../ai/providers/modelProviderTypes'
import type { ProviderRuntimeCheckLaneResult } from '../../../ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import { classifyHttpFailure } from '../../../ai/providers/providerConnection'
import { resolveProviderChatBase } from '../../../ai/providers/providerChatEndpoints'
import { probeProviderEndpoint } from '../../../ai/providers/providerEndpointProbe'

/**
 * PLAT-66：`protocol === 'gemini'` 供应商的「普通聊天」lane。
 *
 * Gemini 的原生 API 没有 OpenAI 兼容的 `/v1/chat/completions`，主链路（及这里的探测）必须走
 * `/v1beta/models/{model}:generateContent`；否则把主机名当 OpenAI base 用，必然 404。
 *
 * 判定沿用端点探测的语义，再映射成连接检查的 lane（判据与 `providerConnection` 一致）：
 *  - 2xx ⇒ ready；
 *  - 401/403 ⇒ auth-failed；
 *  - 404/405 ⇒ 端点不存在（http_404）；
 *  - 429/5xx/其它 ⇒ 交给统一分类（限流、模型已下线、无可用渠道…）；
 *  - 超时/网络 ⇒ network-error，具体原因交给渲染层按 summary 兜底。
 * 原生端点没配 ⇒ **不发任何请求**，直接给配置提示。
 */
export type GeminiNativeChatLaneOptions = {
  fetch: typeof fetch
  modelId: string
  checkedAt: string
}

export function resolveGeminiNativeBaseUrl(provider: ModelProvider): string {
  // 端点清单是唯一来源：没有 `gemini` 端点（或已声明但没配地址）⇒ 原生端点缺失。
  return resolveProviderChatBase(provider, 'gemini') ?? ''
}

export async function probeGeminiNativeChatLane(
  provider: ModelProvider,
  options: GeminiNativeChatLaneOptions
): Promise<ProviderRuntimeCheckLaneResult> {
  const checkedAt = options.checkedAt
  const baseUrl = resolveGeminiNativeBaseUrl(provider)
  if (!baseUrl) {
    return {
      lane: 'ordinary-chat',
      status: 'unknown',
      summary: 'Gemini native endpoint is not configured.',
      failureCode: 'gemini_native_endpoint_missing',
      checkedAt
    }
  }

  const result = await probeProviderEndpoint(provider, {
    fetch: options.fetch,
    kind: 'gemini',
    baseUrl,
    modelId: options.modelId
  })
  const summary = result.message.trim() || defaultVerdictSummary(result.verdict)
  const base = { lane: 'ordinary-chat' as const, summary, checkedAt }

  if (result.verdict === 'available') return { ...base, status: 'ready' }
  if (result.verdict === 'exists_auth_failed') {
    return {
      ...base,
      status: 'auth-failed',
      ...(result.status === null ? {} : { failureCode: classifyHttpFailure(result.status, result.message) })
    }
  }
  if (result.verdict === 'unreachable') return { ...base, status: 'network-error' }
  if (result.verdict === 'missing') return { ...base, status: 'unknown', failureCode: 'http_404' }
  if (result.verdict === 'no_model') return { ...base, status: 'unknown', failureCode: 'model_not_found' }
  // exists / exists_param_error ⇒ 端点存在，但这次请求被上游拒了（限流 / 5xx / 模型已下线…）。
  return {
    ...base,
    status: 'unknown',
    ...(result.status === null ? {} : { failureCode: classifyHttpFailure(result.status, result.message) })
  }
}

function defaultVerdictSummary(verdict: string): string {
  if (verdict === 'no_model') return 'Add at least one chat-capable model first.'
  return 'Gemini native probe did not return a readable message.'
}
