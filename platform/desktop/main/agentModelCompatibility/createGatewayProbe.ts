import { buildMessagesUrl } from '../../../ai/providers/providerEndpoints'
import type { AgentRuntimeProbeSnapshot } from '../../../ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type { AgentModelGatewaySnapshot } from '../agentModelGateway/agentModelGatewayTypes'
import { classifyGatewayHttpStatus, classifyGatewayTransportError } from '../agentModelGateway/gatewayErrorClassifier'
import { buildAgentModelProbeSignature } from './agentModelProbeSignature'

export type GatewayProbeDependencies = {
  fetch: typeof fetch
  getGatewaySnapshot: () => AgentModelGatewaySnapshot
  getGatewayAuthToken: () => string
  timeoutMs?: number
  now?: () => Date
}

export type GatewayProbeInput = {
  providerId: string
  modelId: string
  abortSignal?: AbortSignal
}

export const DEFAULT_PROBE_TIMEOUT_MS = 30_000

export async function createGatewayProbe(
  input: GatewayProbeInput,
  deps: GatewayProbeDependencies
): Promise<AgentRuntimeProbeSnapshot> {
  const checkedAt = (deps.now ?? (() => new Date()))().toISOString()
  const snapshot = deps.getGatewaySnapshot()
  const signature = buildAgentModelProbeSignature({
    provider: {
      id: input.providerId,
      enabled: snapshot.enabled,
      baseUrl: snapshot.baseUrl ?? '',
      // 网关端点在这里等价于一条 messages 端点（签名只关心"地址 + 形态"）。
      endpoints: [{ protocol: 'messages', baseUrl: snapshot.baseUrl ?? '' }],
      apiKey: deps.getGatewayAuthToken()
    },
    modelId: input.modelId,
    runtimeId: 'claude-code',
    route: 'gateway',
    gatewayConfigVersion: snapshot.updatedAt
  })

  const baseSnapshot = {
    route: 'gateway' as const,
    providerId: input.providerId,
    modelId: input.modelId,
    runtimeId: 'claude-code' as const,
    signature,
    checkedAt
  }

  if (!snapshot.enabled) {
    return {
      ...baseSnapshot,
      status: 'unknown',
      message: 'Agent model gateway is disabled.'
    }
  }

  if (snapshot.state === 'stopped' || snapshot.state === 'disabled') {
    return {
      ...baseSnapshot,
      status: 'unknown',
      message: 'Agent model gateway is stopped.'
    }
  }

  if (snapshot.state === 'starting') {
    return {
      ...baseSnapshot,
      status: 'unknown',
      message: 'Agent model gateway is still starting.'
    }
  }

  if (snapshot.state === 'error') {
    return {
      ...baseSnapshot,
      status: 'unknown',
      message: snapshot.message ?? 'Agent model gateway is in an error state.'
    }
  }

  if (!snapshot.baseUrl) {
    return {
      ...baseSnapshot,
      status: 'unknown',
      message: 'Agent model gateway base URL is unavailable.'
    }
  }

  const controller = new AbortController()
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const timeout = setTimeout(() => controller.abort(new Error('probe-timeout')), timeoutMs)
  const abortListener = () => controller.abort(input.abortSignal?.reason)
  input.abortSignal?.addEventListener('abort', abortListener, { once: true })

  try {
    const healthResponse = await deps.fetch(`http://127.0.0.1:${snapshot.port}/health`, {
      signal: controller.signal
    })
    if (!healthResponse.ok) {
      return {
        ...baseSnapshot,
        status: 'unknown',
        message: `Agent model gateway health check failed with status ${healthResponse.status}.`
      }
    }

    const messagesResponse = await deps.fetch(buildMessagesUrl(snapshot.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': deps.getGatewayAuthToken(),
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: input.modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      signal: controller.signal
    })

    if (messagesResponse.status >= 200 && messagesResponse.status < 300) {
      return {
        ...baseSnapshot,
        status: 'ready',
        message: 'Agent model gateway runtime probe passed through the converted provider route.'
      }
    }

    if (messagesResponse.status === 400 || messagesResponse.status === 422) {
      return {
        ...baseSnapshot,
        status: 'ready',
        message:
          'Agent model gateway accepted the converted probe; upstream rejected only the minimal payload.'
      }
    }

    const bodyText = await safeReadText(messagesResponse)
    const classified = classifyGatewayHttpStatus(messagesResponse.status, {
      location: messagesResponse.status === 401 || messagesResponse.status === 403 ? 'local' : 'upstream',
      bodyText
    })

    return {
      ...baseSnapshot,
      status: mapClassifiedKindToProbeStatus(classified.kind),
      message: classified.message
    }
  } catch (error) {
    if (controller.signal.aborted || input.abortSignal?.aborted) {
      const reason = String(controller.signal.reason ?? input.abortSignal?.reason ?? 'aborted')
      if (reason.includes('probe-timeout')) {
        return {
          ...baseSnapshot,
          status: 'timeout',
          message: 'Agent model gateway runtime probe timed out.'
        }
      }
      return {
        ...baseSnapshot,
        status: 'unknown',
        message: 'Agent model gateway runtime probe was aborted.'
      }
    }

    const classified = classifyGatewayTransportError(error)
    return {
      ...baseSnapshot,
      status: mapClassifiedKindToProbeStatus(classified.kind),
      message: classified.message
    }
  } finally {
    clearTimeout(timeout)
    input.abortSignal?.removeEventListener('abort', abortListener)
  }
}

function mapClassifiedKindToProbeStatus(
  kind: ReturnType<typeof classifyGatewayHttpStatus>['kind']
): AgentRuntimeProbeSnapshot['status'] {
  switch (kind) {
    case 'auth':
      return 'auth-failed'
    case 'forbidden':
      return 'forbidden'
    case 'protocol':
      return 'protocol-unsupported'
    case 'timeout':
      return 'timeout'
    case 'network':
      return 'network-error'
    default:
      return 'unknown'
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}
