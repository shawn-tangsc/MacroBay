import { buildMessagesUrl } from '../../../ai/providers/providerEndpoints'
import { resolveProviderChatBase } from '../../../ai/providers/providerChatEndpoints'
import type { ModelProvider } from '../../../ai/providers/modelProviderTypes'
import type { ProviderState } from '../../../ai/providers/modelProviderTypes'
import { summarizeUpstreamFailureBody } from '../../../ai/providers/providerFailureBody'
import { isProtocolUnsupportedFailure } from '../../../ai/providers/providerFailureMapping'
import type { AgentRuntimeProbeSnapshot } from '../../../ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import { buildAgentModelProbeSignature } from './agentModelProbeSignature'

export type ClaudeCodeDirectProbeDependencies = {
  fetch: typeof fetch
  timeoutMs?: number
  now?: () => Date
}

export type ClaudeCodeDirectProbeInput = {
  providerState: ProviderState
  providerId: string
  modelId: string
  abortSignal?: AbortSignal
}

export const DEFAULT_PROBE_TIMEOUT_MS = 30_000
const ANTHROPIC_VERSION = '2023-06-01'

export async function createClaudeCodeDirectProbe(
  input: ClaudeCodeDirectProbeInput,
  deps: ClaudeCodeDirectProbeDependencies
): Promise<AgentRuntimeProbeSnapshot> {
  const checkedAt = (deps.now ?? (() => new Date()))().toISOString()
  const uniqueModelId = `${input.providerId}:${input.modelId}`
  const provider = input.providerState.providers.find((entry) => entry.id === input.providerId)
  const signature = buildAgentModelProbeSignature({
    provider: provider ?? missingProvider(input.providerId),
    modelId: input.modelId,
    runtimeId: 'claude-code',
    route: 'direct'
  })

  const baseSnapshot = {
    route: 'direct' as const,
    providerId: input.providerId,
    modelId: input.modelId,
    runtimeId: 'claude-code' as const,
    signature,
    checkedAt
  }

  const model = provider?.models.find((entry) => entry.id === input.modelId && entry.capabilities.chat)
  const apiKey = provider?.apiKey?.trim() ?? ''
  const baseUrl = provider ? resolveProviderChatBase(provider, 'messages') ?? '' : ''
  if (!provider?.enabled || !model || !apiKey || !baseUrl) {
    return {
      ...baseSnapshot,
      status: mapDirectProbeReadinessFailure({
        providerEnabled: provider?.enabled === true,
        hasModel: Boolean(model),
        hasApiKey: Boolean(apiKey),
        hasBaseUrl: Boolean(baseUrl)
      }),
      message: 'Direct Claude Code runtime probe requires an enabled provider, chat model, API key, and Anthropic-compatible endpoint.'
    }
  }

  const controller = new AbortController()
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const timeout = setTimeout(() => controller.abort(new Error('probe-timeout')), timeoutMs)
  const abortListener = () => controller.abort(input.abortSignal?.reason)
  input.abortSignal?.addEventListener('abort', abortListener, { once: true })

  try {
    const response = await deps.fetch(buildMessagesUrl(baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: model.id,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      signal: controller.signal
    })

    return classifyProbeResponse(response, baseSnapshot, apiKey)
  } catch (error) {
    if (controller.signal.aborted || input.abortSignal?.aborted) {
      const reason = String(controller.signal.reason ?? input.abortSignal?.reason ?? 'aborted')
      if (reason.includes('probe-timeout')) {
        return {
          ...baseSnapshot,
          status: 'timeout',
          message: 'Direct Claude Code runtime probe timed out.'
        }
      }
      return {
        ...baseSnapshot,
        status: 'unknown',
        message: 'Direct Claude Code runtime probe was aborted.'
      }
    }

    return {
      ...baseSnapshot,
      status: 'network-error',
      message: error instanceof Error ? error.message : 'Direct Claude Code runtime probe failed.'
    }
  } finally {
    clearTimeout(timeout)
    input.abortSignal?.removeEventListener('abort', abortListener)
  }
}

/** 供应商不在库里时的空壳（签名需要稳定输入）。 */
function missingProvider(providerId: string): Pick<ModelProvider, 'id' | 'enabled' | 'baseUrl' | 'endpoints' | 'apiKey'> {
  return { id: providerId, enabled: false, baseUrl: '', endpoints: [], apiKey: undefined }
}

async function classifyProbeResponse(
  response: Response,
  baseSnapshot: Omit<AgentRuntimeProbeSnapshot, 'status' | 'message'>,
  apiKey: string
): Promise<AgentRuntimeProbeSnapshot> {
  if (response.status === 401) {
    return {
      ...baseSnapshot,
      status: 'auth-failed',
      message: 'Direct Claude Code runtime authentication failed.'
    }
  }

  if (response.status === 403) {
    return {
      ...baseSnapshot,
      status: 'forbidden',
      message: 'Direct Claude Code runtime access was denied.'
    }
  }

  if (response.status >= 200 && response.status < 300) {
    return {
      ...baseSnapshot,
      status: 'ready',
      message: 'Direct Claude Code runtime probe passed.'
    }
  }

  const bodyText = await safeReadResponseText(response)
  const authFailure = detectAuthenticationFailure(response.status, bodyText)
  if (authFailure) {
    return {
      ...baseSnapshot,
      status: authFailure,
      message: summarizeResponseBody(bodyText) ?? 'Direct Claude Code runtime authentication failed.'
    }
  }

  // PLAT-62：解析 JSON 后只留一行（type/code/message/request_id，≤200），绝不原样渲染整段 JSON。
  const summary = summarizeUpstreamFailureBody(bodyText, response.status, apiKey)

  // 协议不支持优先于 400/422 的「auth 通过」与泛化 500（AIOnly：
  // 「模型…下无渠道支持messages协议」）。
  if (isProtocolUnsupportedFailure(response.status, summary.detail)) {
    return {
      ...baseSnapshot,
      status: 'protocol-unsupported',
      message: summary.detail
    }
  }

  if (response.status === 400 || response.status === 422) {
    return {
      ...baseSnapshot,
      status: 'ready',
      message: 'Direct Claude Code runtime authentication passed; provider rejected the minimal probe payload.'
    }
  }

  if (response.status === 404 || response.status === 405) {
    return {
      ...baseSnapshot,
      status: 'protocol-unsupported',
      message: 'Direct Claude Code runtime endpoint did not expose Anthropic Messages.'
    }
  }

  return {
    ...baseSnapshot,
    status: 'unknown',
    message: summary.detail
  }
}

function mapDirectProbeReadinessFailure(input: {
  providerEnabled: boolean
  hasModel: boolean
  hasApiKey: boolean
  hasBaseUrl: boolean
}): AgentRuntimeProbeSnapshot['status'] {
  if (!input.hasBaseUrl) return 'protocol-unsupported'
  if (!input.providerEnabled || !input.hasApiKey) return 'auth-failed'
  if (!input.hasModel) return 'unknown'
  return 'unknown'
}

function detectAuthenticationFailure(status: number, bodyText: string): 'auth-failed' | 'forbidden' | null {
  const normalized = bodyText.toLowerCase()
  if (status === 401 || normalized.includes('authentication') || normalized.includes('invalid api key')) {
    return 'auth-failed'
  }
  if (status === 403 || normalized.includes('forbidden') || normalized.includes('permission')) {
    return 'forbidden'
  }
  return null
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function summarizeResponseBody(bodyText: string): string | undefined {
  const trimmed = bodyText.trim()
  if (!trimmed) return undefined
  if (trimmed.length <= 240) return trimmed
  return `${trimmed.slice(0, 237)}...`
}
