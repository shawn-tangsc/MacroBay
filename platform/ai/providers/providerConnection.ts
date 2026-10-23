import { buildChatCompletionsUrl, buildGeminiGenerateUrl } from './providerEndpoints'
import {
  buildHttpDetail,
  classifyHttpFailure,
  classifyProviderTransportFailure,
  describeTransportFailure,
  ProviderConnectionFailurePolicy,
  readUpstreamErrorMessage,
  type ProviderConnectionFailureCode
} from './providerFailureMapping'
import { readUpstreamFailureDetails } from './providerFailureBody'

export type { ProviderConnectionFailureCode } from './providerFailureMapping'
export {
  classifyHttpFailure,
  classifyProviderTransportFailure,
  isAccountBalanceFailure,
  isModelNotActivatedFailure,
  isModelRetiredFailure,
  isModelUnavailableFailure,
  ProviderConnectionFailurePolicy,
  readUpstreamErrorMessage
} from './providerFailureMapping'

import type { ModelProvider } from './modelProviderTypes'
import { resolveModelCapabilities } from './modelCapabilityInference'
import { resolveProviderChatBase } from './providerChatEndpoints'
import { mergeProviderHeaders } from './providerRequestHeaders'

export type ProviderConnectionResult = {
  ok: boolean
  message: string
  failureCode?: ProviderConnectionFailureCode
  /** PLAT-61：上游响应体里提取的错误 message（已脱敏/去换行/≤200）。 */
  upstreamMessage?: string
}

export const ProviderConnectionTestPolicy = {
  owner: 'platform/ai/providers/providerConnection',
  source: 'runtime provider endpoint and resolved API key',
  default: 'allow testing disabled providers without making them runtime-ready',
  failure: 'require endpoint and API key before a network probe',
  testBoundary: 'providerConnection disabled-provider probe tests',
  isTestable(input: { baseUrl: string; hasApiKey: boolean }): boolean {
    return Boolean(input.baseUrl.trim() && input.hasApiKey)
  }
} as const

type ProviderConnectionOptions = {
  /** 必填：生产注入 Electron `net.fetch`（跟随 session 代理）；禁止回退到全局 fetch。 */
  fetch: typeof fetch
  modelId?: string
}

export async function testModelProviderConnection(
  provider: ModelProvider,
  options: ProviderConnectionOptions
): Promise<ProviderConnectionResult> {
  const apiKey = provider.apiKey?.trim() || ''
  if (!ProviderConnectionTestPolicy.isTestable({ baseUrl: provider.baseUrl, hasApiKey: Boolean(apiKey) })) {
    return {
      ok: false,
      message: 'Enable the provider and set an API key first.',
      failureCode: 'missing_api_key'
    }
  }

  const model = provider.models.find((item) => item.id === options.modelId && resolveModelCapabilities(item).chat)
    ?? provider.models.find((item) => item.id === provider.defaultChatModelId && resolveModelCapabilities(item).chat)
    ?? provider.models.find((item) => resolveModelCapabilities(item).chat)
  if (!model) {
    return {
      ok: false,
      message: 'Add at least one chat-capable model first.',
      failureCode: 'model_not_found'
    }
  }

  try {
    // PLAT-75：没有 chat/completions 端点、只有 gemini 端点时，巡检必须打 `:generateContent`，
    // 否则会把"路径不存在"误判成"模型下线"。
    const chatBase = resolveProviderChatBase(provider, 'chat-completions')
    const geminiBase = resolveProviderChatBase(provider, 'gemini')
    const geminiNative = chatBase === undefined && geminiBase !== undefined
    const response = await options.fetch(
      geminiNative ? buildGeminiGenerateUrl(geminiBase, model.id) : buildChatCompletionsUrl(chatBase ?? provider.baseUrl),
      {
        method: 'POST',
        headers: geminiNative
          ? mergeProviderHeaders({
              'content-type': 'application/json',
              'x-goog-api-key': apiKey
            }, provider.customHeaders)
          : mergeProviderHeaders({
              authorization: `Bearer ${apiKey}`,
              'content-type': 'application/json'
            }, provider.customHeaders),
        body: JSON.stringify(geminiNative
          ? {
              contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
              generationConfig: { maxOutputTokens: 8, temperature: 0 }
            }
          : {
              model: model.id,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 8,
              temperature: 0,
              stream: false
            })
      }
    )

    if (!response.ok) {
      // 读上游错误（只取 message / type / code，脱敏 + 截断；不带 Key/请求体/响应头）。
      const upstream = await readUpstreamFailureDetails(response, apiKey)
      return {
        ok: false,
        message: buildHttpDetail(response.status, upstream.message),
        failureCode: classifyHttpFailure(response.status, upstream.message, upstream.hints),
        ...(upstream.message === null ? {} : { upstreamMessage: upstream.message })
      }
    }

    return {
      ok: true,
      message: 'Connection succeeded.'
    }
  } catch (error) {
    const failureCode = classifyProviderTransportFailure(error)
    return {
      ok: false,
      message: describeTransportFailure(error, apiKey),
      ...(failureCode === undefined ? {} : { failureCode })
    }
  }
}

export type ProviderProxyProbeResult = {
  ok: boolean
  status: number | null
  durationMs: number
  /** 失败归类（成功为 null）；与连接检查同一套 code。 */
  reasonCode: ProviderConnectionFailureCode | null
  targetHost: string
}

/**
 * PLAT-61 代理自检：用调用方注入的 fetch（生产 = Electron `net.fetch`，跟随当前 session 代理）
 * 对一个**无鉴权**目标发 GET。不发 Key、不读响应体、不记录 URL/凭据。
 */
export async function probeProviderProxyTarget(
  targetUrl: string,
  fetchImpl: typeof fetch
): Promise<ProviderProxyProbeResult> {
  const started = Date.now()
  const targetHost = resolveTargetHost(targetUrl)
  if (!/^https?:\/\//i.test(targetUrl.trim())) {
    return { ok: false, status: null, durationMs: 0, reasonCode: 'unknown', targetHost }
  }
  try {
    const response = await fetchImpl(targetUrl, { method: 'GET', headers: { accept: 'text/html' } })
    const durationMs = Date.now() - started
    if (response.ok) return { ok: true, status: response.status, durationMs, reasonCode: null, targetHost }
    return {
      ok: false,
      status: response.status,
      durationMs,
      reasonCode: classifyHttpFailure(response.status, await readUpstreamErrorMessage(response, '')),
      targetHost
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - started,
      reasonCode: classifyProviderTransportFailure(error) ?? 'unknown',
      targetHost
    }
  }
}

function resolveTargetHost(targetUrl: string): string {
  try {
    return new URL(targetUrl).host
  } catch {
    return targetUrl.trim()
  }
}

