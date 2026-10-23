import { resolveModelCapabilities } from './modelCapabilityInference'
import {
  buildChatCompletionsUrl,
  buildGeminiGenerateUrl,
  buildMessagesUrl,
  buildResponsesUrl
} from './providerEndpoints'
import { imageEndpointUrl } from './providerImagePayload'
import { mergeProviderHeaders } from './providerRequestHeaders'
import {
  buildHttpDetail,
  describeTransportFailure,
  readUpstreamErrorMessage
} from './providerFailureMapping'
import type { ModelDefinition, ModelProvider } from './modelProviderTypes'

/**
 * PLAT-63：**单个已保存端点**的连通性测试（模型服务页每行右侧的「测试」）。
 *
 * 判定按端点语义分档，**不**把所有非 2xx 当失败：
 *  - 2xx ⇒ 可用；
 *  - 400 / 422 ⇒ 端点存在（参数问题）；
 *  - 401 / 403 ⇒ 端点存在但鉴权失败；
 *  - 404 / 405 ⇒ 路径不存在；
 *  - 429 / 5xx / 其它 ⇒ 端点存在（可达，只是上游拒了这次请求）；
 *  - 超时 / 网络 ⇒ 不可达；imageEdit 暂不实现请求 ⇒ 暂不支持测试。
 *
 * 安全：只用 provider 运行时的 Key 与自定义头发请求；返回的 message 沿用既有脱敏规则
 * （抹掉 Key / 自定义头值 / URL，≤200 字符 + 状态码前缀），绝不返回原始 JSON、请求体或响应头。
 */
export const endpointProbeKinds = [
  'openai',
  'anthropic',
  'responses',
  'gemini',
  'imageGeneration',
  'imageEdit'
] as const

export type EndpointProbeKind = (typeof endpointProbeKinds)[number]

export const endpointProbeVerdicts = [
  'available',
  'exists_param_error',
  'exists_auth_failed',
  /** 可达但上游因为限流/自身错误拒绝了这次探测请求。 */
  'exists',
  'missing',
  'unreachable',
  'unsupported',
  'no_model'
] as const

export type EndpointProbeVerdict = (typeof endpointProbeVerdicts)[number]

export type EndpointProbeResult = {
  kind: EndpointProbeKind
  verdict: EndpointProbeVerdict
  /** 只有 2xx 才是 true；`exists*` 表示端点存在但这次请求没成功。 */
  ok: boolean
  status: number | null
  /** 已脱敏的一句话（可空）；不含 Key、自定义头值、原始 JSON。 */
  message: string
}

export type EndpointProbeOptions = {
  /** 必填：生产注入平台 fetch（net.fetch，跟随代理）；禁止全局 fetch。 */
  fetch: typeof fetch
  kind: EndpointProbeKind
  baseUrl: string
  modelId?: string
  timeoutMs?: number
}

export const DEFAULT_ENDPOINT_PROBE_TIMEOUT_MS = 12_000

export function isEndpointProbeKind(value: unknown): value is EndpointProbeKind {
  return typeof value === 'string' && (endpointProbeKinds as readonly string[]).includes(value)
}

export function classifyEndpointProbeStatus(status: number): EndpointProbeVerdict {
  if (status >= 200 && status < 300) return 'available'
  if (status === 400 || status === 422) return 'exists_param_error'
  if (status === 401 || status === 403) return 'exists_auth_failed'
  if (status === 404 || status === 405) return 'missing'
  return 'exists'
}

export async function probeProviderEndpoint(
  provider: ModelProvider,
  options: EndpointProbeOptions
): Promise<EndpointProbeResult> {
  const kind = options.kind
  if (kind === 'imageEdit') return buildResult(kind, 'unsupported', null, '')
  const baseUrl = options.baseUrl.trim()
  if (!/^https?:\/\//i.test(baseUrl)) return buildResult(kind, 'unreachable', null, '')
  const model = resolveProbeModel(provider, kind, options.modelId)
  if (!model) return buildResult(kind, 'no_model', null, '')

  const apiKey = provider.apiKey?.trim() ?? ''
  const url = buildProbeUrl(kind, baseUrl, model.id)
  const init: RequestInit = {
    method: 'POST',
    headers: mergeProviderHeaders(buildProbeAuthHeaders(kind, apiKey), provider.customHeaders),
    body: JSON.stringify(buildProbeBody(kind, model.id))
  }

  try {
    const response = await sendProbe(options.fetch, url, init, options.timeoutMs ?? DEFAULT_ENDPOINT_PROBE_TIMEOUT_MS)
    if (response.ok) return buildResult(kind, 'available', response.status, '')
    const upstream = await readUpstreamErrorMessage(response, apiKey)
    return buildResult(
      kind,
      classifyEndpointProbeStatus(response.status),
      response.status,
      redactSecrets(buildHttpDetail(response.status, upstream), provider)
    )
  } catch (error) {
    // 超时 / DNS / 拒绝连接 / TLS / 代理都归到「不可达」；detail 已脱敏。
    return buildResult(kind, 'unreachable', null, redactSecrets(describeTransportFailure(error, apiKey), provider))
  }
}

function buildResult(
  kind: EndpointProbeKind,
  verdict: EndpointProbeVerdict,
  status: number | null,
  message: string
): EndpointProbeResult {
  return { kind, verdict, ok: verdict === 'available', status, message }
}

function resolveProbeModel(
  provider: ModelProvider,
  kind: EndpointProbeKind,
  modelId?: string
): ModelDefinition | undefined {
  const picked = modelId ? provider.models.find((model) => model.id === modelId) : undefined
  if (picked) return picked
  const chatModels = provider.models.filter((model) => resolveModelCapabilities(model).chat)
  if (kind === 'imageGeneration') {
    return provider.models.find((model) => resolveModelCapabilities(model).imageGeneration) ?? chatModels[0]
  }
  return chatModels[0]
}

function buildProbeAuthHeaders(kind: EndpointProbeKind, apiKey: string): Record<string, string> {
  const defaults: Record<string, string> = { 'content-type': 'application/json' }
  if (!apiKey) return defaults
  if (kind === 'anthropic') {
    defaults['x-api-key'] = apiKey
    defaults['anthropic-version'] = '2023-06-01'
    return defaults
  }
  if (kind === 'gemini') {
    defaults['x-goog-api-key'] = apiKey
    return defaults
  }
  defaults.authorization = `Bearer ${apiKey}`
  return defaults
}

function buildProbeBody(kind: EndpointProbeKind, modelId: string): Record<string, unknown> {
  const ping = [{ role: 'user', content: 'ping' }]
  switch (kind) {
    case 'anthropic':
      return { model: modelId, max_tokens: 8, messages: ping }
    case 'responses':
      return { model: modelId, input: 'ping', max_output_tokens: 16 }
    case 'gemini':
      // Gemini 原生：contents + generationConfig（上限压到 16，避免探测产生多余 token）。
      return {
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 16 }
      }
    case 'imageGeneration':
      return { model: modelId, prompt: 'ping', n: 1, size: '256x256' }
    default:
      return { model: modelId, messages: ping, max_tokens: 8 }
  }
}

/** 端点探测只是"按 kind 选一个共享 URL"：URL 规则本身在 `providerEndpoints`，不在这里复制。 */
function buildProbeUrl(kind: EndpointProbeKind, baseUrl: string, modelId: string): string {
  if (kind === 'gemini') return buildGeminiGenerateUrl(baseUrl, modelId)
  if (kind === 'anthropic') return buildMessagesUrl(baseUrl)
  if (kind === 'responses') return buildResponsesUrl(baseUrl)
  if (kind === 'imageGeneration') return imageEndpointUrl(baseUrl, 'generations')
  return buildChatCompletionsUrl(baseUrl)
}

async function sendProbe(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('endpoint-probe-timeout')), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** 响应体/错误文本里可能回显自定义头值；返回前一律抹掉。 */
function redactSecrets(message: string, provider: ModelProvider): string {
  let safe = message
  for (const header of provider.customHeaders ?? []) {
    const value = header.value.trim()
    if (value.length < 4) continue
    safe = safe.split(value).join('[redacted]')
  }
  return safe
}
