import type { ModelChatProtocol, ModelProvider, ProviderState } from '../../../../providers/modelProviderTypes'
import { resolveProviderChatBase } from '../../../../providers/providerChatEndpoints'
import { supportsAnthropicServerWebSearch } from '../../../../providers/providerServerTools'
import { resolveChatModel } from '../../../../invocation/resolveChatModel'
import {
  isAgentRuntimeSelectable,
  isClaudeCodeAnthropicEndpointProvider,
  isClaudeCodeNativeDirectProvider,
  resolveAgentRuntimeCompatibility
} from '../../compatibility'
import type {
  AgentRuntimeCompatibilityResult,
  AgentRuntimeProbeSnapshot,
  AgentRuntimeRoute
} from '../../compatibility/agentRuntimeCompatibilityTypes'

export type ClaudeCodeProviderEnvironmentMetadata = {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  /** 默认端点协议（`endpoints[0].protocol`；空端点 ⇒ `undefined`）。 */
  protocol?: ModelChatProtocol
  baseUrl: string
  route: AgentRuntimeRoute
  /** 模型能力 `capabilities.reasoning`；`undefined` = 厂商未声明，保持默认行为。 */
  modelReasoningSupported?: boolean
  /**
   * 该路由能否承载 Anthropic server-side web tools（WebSearch/WebFetch）。
   * gateway 路由恒为 false：适配层会把 server tool 转成普通 function，语义不成立。
   */
  serverWebToolsSupported: boolean
}

export type ClaudeCodeProviderEnvironmentSuccess = {
  ok: true
  modelId: string
  env: Record<string, string>
  metadata: ClaudeCodeProviderEnvironmentMetadata
  compatibility: AgentRuntimeCompatibilityResult
}

export type ClaudeCodeProviderEnvironmentFailure = {
  ok: false
  errorCode:
    | 'model-not-ready'
    | 'provider-disabled'
    | 'missing-api-key'
    | 'unsupported-provider-protocol'
    | 'runtime-not-ready'
  message: string
  compatibility?: AgentRuntimeCompatibilityResult
}

export type ClaudeCodeProviderEnvironmentResult =
  | ClaudeCodeProviderEnvironmentSuccess
  | ClaudeCodeProviderEnvironmentFailure

export type ClaudeCodeProviderEnvironmentOptions = {
  directProbe?: AgentRuntimeProbeSnapshot
  gatewayProbe?: AgentRuntimeProbeSnapshot
  gatewayEnabled?: boolean
  gateway?: {
    baseUrl: string
    authToken: string
  }
}

export function createClaudeCodeProviderEnvironment(
  providerState: ProviderState,
  uniqueModelId: string,
  options: ClaudeCodeProviderEnvironmentOptions = {}
): ClaudeCodeProviderEnvironmentResult {
  const reference = parseUniqueModelId(uniqueModelId)
  if (!reference) {
    return {
      ok: false,
      errorCode: 'model-not-ready',
      message: 'Claude Code provider environment requires a provider:model id.'
    }
  }

  const resolved = resolveChatModel(providerState, reference.providerId, reference.modelId)
  if (!resolved.ok) {
    return {
      ok: false,
      errorCode: resolved.errorCode,
      message: toFailureMessage(resolved.errorCode)
    }
  }

  const provider = providerState.providers.find((entry: ModelProvider) => entry.id === resolved.model.providerId)
  if (!provider) {
    return {
      ok: false,
      errorCode: 'model-not-ready',
      message: 'Claude Code provider was not found.'
    }
  }

  const model = provider.models.find((entry) => entry.id === resolved.model.modelId)
  if (!model) {
    return {
      ok: false,
      errorCode: 'model-not-ready',
      message: 'Claude Code model was not found.'
    }
  }

  const compatibility = resolveAgentRuntimeCompatibility({
    provider,
    model,
    runtimeId: 'claude-code',
    directProbe: options.directProbe,
    gatewayProbe: options.gatewayProbe,
    gatewayEnabled: options.gatewayEnabled,
    requireReadyProvider: true
  })
  const modelReasoningSupported = resolveModelReasoningSupport(model)

  if (!compatibility.selectable) {
    return {
      ok: false,
      errorCode: mapCompatibilityFailureCode(compatibility.status),
      message: compatibility.summary,
      compatibility
    }
  }

  if (compatibility.route === 'gateway') {
    if (!options.gateway?.baseUrl || !options.gateway.authToken) {
      return {
        ok: false,
        errorCode: 'runtime-not-ready',
        message: 'Claude Code gateway route is selected but local gateway environment is unavailable.',
        compatibility
      }
    }

    return {
      ok: true,
      modelId: resolved.model.modelId,
      env: buildGatewayEnv(resolved.model.modelId, options.gateway),
      metadata: {
        providerId: resolved.model.providerId,
        providerName: resolved.model.providerName,
        modelId: resolved.model.modelId,
        modelName: resolved.model.modelName,
        protocol: provider.endpoints[0]?.protocol,
        baseUrl: options.gateway.baseUrl,
        route: 'gateway',
        serverWebToolsSupported: false,
        ...(modelReasoningSupported === undefined ? {} : { modelReasoningSupported })
      },
      compatibility
    }
  }

  const baseUrl = resolveProviderChatBase(provider, 'messages') ?? ''
  if (
    !baseUrl ||
    !isClaudeCodeAnthropicEndpointProvider(provider) ||
    !isAgentRuntimeSelectable(
      {
        provider,
        model,
        runtimeId: 'claude-code',
        requireReadyProvider: true,
        directProbe: options.directProbe,
        gatewayProbe: options.gatewayProbe,
        gatewayEnabled: options.gatewayEnabled
      },
      'claude-code'
    )
  ) {
    return {
      ok: false,
      errorCode: 'unsupported-provider-protocol',
      message: 'Claude Code agents require a compatible Anthropic Messages endpoint and model.',
      compatibility
    }
  }

  return {
    ok: true,
    modelId: resolved.model.modelId,
    env: buildDirectEnv(resolved.model.modelId, resolved.model.apiKey, baseUrl, provider),
    metadata: {
      providerId: resolved.model.providerId,
      providerName: resolved.model.providerName,
      modelId: resolved.model.modelId,
      modelName: resolved.model.modelName,
      protocol: provider.endpoints[0]?.protocol,
      baseUrl,
      route: 'direct',
      serverWebToolsSupported: supportsAnthropicServerWebSearch(provider),
      ...(modelReasoningSupported === undefined ? {} : { modelReasoningSupported })
    },
    compatibility
  }
}

function resolveModelReasoningSupport(model: {
  capabilities?: { reasoning?: boolean }
}): boolean | undefined {
  return typeof model.capabilities?.reasoning === 'boolean' ? model.capabilities.reasoning : undefined
}

function buildDirectEnv(
  modelId: string,
  apiKey: string,
  baseUrl: string,
  provider: ModelProvider
): Record<string, string> {
  const sdkModelId = resolveClaudeCodeSdkModelId(provider, modelId, baseUrl)
  const smallModelId = resolveClaudeCodeSmallModelId(provider, sdkModelId, baseUrl)
  const env = {
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_MODEL: sdkModelId,
    ANTHROPIC_DEFAULT_OPUS_MODEL: sdkModelId,
    ANTHROPIC_DEFAULT_SONNET_MODEL: sdkModelId,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: smallModelId,
    CLAUDE_CODE_USE_BEDROCK: '0'
  }

  if (!isClaudeCodeNativeDirectProvider(provider)) {
    return {
      ...env,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      CLAUDE_CODE_SUBAGENT_MODEL: smallModelId,
      CLAUDE_CODE_EFFORT_LEVEL: 'max'
    }
  }

  return env
}

function resolveClaudeCodeSdkModelId(provider: ModelProvider, modelId: string, baseUrl: string): string {
  if (!isOfficialDeepSeekAnthropicEndpoint(provider, baseUrl)) return modelId
  if (/\[1m\]$/i.test(modelId)) return modelId
  if (/flash/i.test(modelId)) return modelId
  if (!isDeepSeekV4PlusProModel(modelId)) return modelId
  return `${modelId}[1m]`
}

function resolveClaudeCodeSmallModelId(provider: ModelProvider, fallbackModelId: string, baseUrl: string): string {
  if (!isOfficialDeepSeekAnthropicEndpoint(provider, baseUrl)) return fallbackModelId
  const flashModel = provider.models.find((model) => model.id === 'deepseek-v4-flash')
  return flashModel?.id ?? fallbackModelId
}

function isOfficialDeepSeekAnthropicEndpoint(provider: ModelProvider, baseUrl: string): boolean {
  if (provider.id !== 'deepseek') return false
  const normalized = baseUrl.trim()
  if (!normalized) return false
  try {
    const url = new URL(normalized)
    return url.hostname === 'api.deepseek.com' && url.pathname.replace(/\/+$/, '').endsWith('/anthropic')
  } catch {
    return false
  }
}

function isDeepSeekV4PlusProModel(modelId: string): boolean {
  return /(\w+-)?deepseek-v([4-9]|\d{2,})([.-]\w+)*$/i.test(modelId)
}

function buildGatewayEnv(
  modelId: string,
  gateway: NonNullable<ClaudeCodeProviderEnvironmentOptions['gateway']>
): Record<string, string> {
  return {
    ANTHROPIC_API_KEY: gateway.authToken,
    ANTHROPIC_AUTH_TOKEN: gateway.authToken,
    ANTHROPIC_BASE_URL: gateway.baseUrl,
    ANTHROPIC_MODEL: modelId,
    ANTHROPIC_DEFAULT_OPUS_MODEL: modelId,
    ANTHROPIC_DEFAULT_SONNET_MODEL: modelId,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: modelId,
    CLAUDE_CODE_USE_BEDROCK: '0'
  }
}

function parseUniqueModelId(value: string): { providerId: string; modelId: string } | null {
  const separatorIndex = value.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null

  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1)
  }
}

function mapCompatibilityFailureCode(
  status: AgentRuntimeCompatibilityResult['status']
): ClaudeCodeProviderEnvironmentFailure['errorCode'] {
  switch (status) {
    case 'provider-disabled':
      return 'provider-disabled'
    case 'missing-api-key':
      return 'missing-api-key'
    case 'auth-failed':
    case 'forbidden':
    case 'gateway-required':
    case 'gateway-stopped':
    case 'probe-timeout':
    case 'protocol-unsupported':
      return 'runtime-not-ready'
    case 'missing-endpoint':
    case 'model-not-enabled':
    case 'unknown':
    default:
      return 'unsupported-provider-protocol'
  }
}

function toFailureMessage(errorCode: ClaudeCodeProviderEnvironmentFailure['errorCode']): string {
  switch (errorCode) {
    case 'provider-disabled':
      return 'Claude Code provider is disabled.'
    case 'missing-api-key':
      return 'Claude Code provider is missing an API key.'
    case 'runtime-not-ready':
      return 'Claude Code runtime route is not ready for the selected model.'
    case 'model-not-ready':
    case 'unsupported-provider-protocol':
    default:
      return 'Claude Code provider is not ready.'
  }
}
