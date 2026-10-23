import {
  resolveAgentRuntimeCompatibility
} from '../../../ai/agent-platform/runtime/compatibility'
import type {
  AgentRuntimeCompatibilityResult,
  AgentRuntimeId,
  AgentRuntimeProbeSnapshot
} from '../../../ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import {
  createIdleLaneResult,
  type ProviderRuntimeCheckReport
} from '../../../ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import type { ProviderConnectionFailureCode } from '../../../ai/providers/providerConnection'
import { testModelProviderConnection } from '../../../ai/providers/providerConnection'
import type { ModelProvider, ProviderState, ProviderStateAccessor } from '../../../ai/providers/modelProviderTypes'
import { resolveProviderChatBase } from '../../../ai/providers/providerChatEndpoints'
import type { AgentModelGatewayService } from '../agentModelGateway/AgentModelGatewayService'
import type { AgentModelRuntimeProbeService } from './AgentModelRuntimeProbeService'
import type { AgentRuntimeProbeSnapshotStore } from './AgentRuntimeProbeSnapshotStore'
import { buildAgentModelProbeSignature } from './agentModelProbeSignature'
import { mapProbeLane, probeFailureCode } from './providerRuntimeProbeLane'
import { probeConfiguredEndpointLanes } from './providerConfiguredEndpointProbes'
import { probeGeminiNativeChatLane } from './providerGeminiChatProbe'
import {
  buildMissingApiKeyReport,
  buildMissingProviderReport,
  buildProviderDisabledReport,
  mapOrdinaryChatLane
} from './providerRuntimeCheckReport'

export type ProviderRuntimeCheckServiceDependencies = {
  getProviderState: ProviderStateAccessor
  probeService: AgentModelRuntimeProbeService
  gatewayService: AgentModelGatewayService
  snapshotStore: AgentRuntimeProbeSnapshotStore
  /** 必填：平台 fetch（net.fetch）；禁止全局 fetch。 */
  fetch: typeof fetch
  now?: () => Date
  checkGateway?: boolean
}

export type RunProviderRuntimeChecksInput = {
  providerId: string
  modelId: string
  runtimeId?: AgentRuntimeId
  checkGateway?: boolean
}

export class ProviderRuntimeCheckService {
  constructor(private readonly deps: ProviderRuntimeCheckServiceDependencies) {}

  async getReport(
    providerId: string,
    modelId: string,
    runtimeId: AgentRuntimeId = 'claude-code'
  ): Promise<ProviderRuntimeCheckReport | null> {
    return this.deps.snapshotStore.getReport(providerId, modelId, runtimeId)
  }

  async runChecks(input: RunProviderRuntimeChecksInput): Promise<ProviderRuntimeCheckReport> {
    const runtimeId = input.runtimeId ?? 'claude-code'
    const checkedAt = (this.deps.now ?? (() => new Date()))().toISOString()
    const providerState = await this.deps.getProviderState()
    const metadataProvider = providerState.providers.find((entry) => entry.id === input.providerId)
    const resolvedProvider = this.deps.getProviderState.resolveRuntimeProvider
      ? await this.deps.getProviderState.resolveRuntimeProvider(input.providerId)
      : metadataProvider
    const provider = resolvedProvider
    const model = provider?.models.find((entry) => entry.id === input.modelId)

    // PLAT-66：供应商停用 ⇒ **最先**短路。停用状态下不发任何网络请求（省一次调用，也不产生
    // 误导性的上游错误），报告里也不带上游 message —— 主文案只由渲染层说「先启用」。
    if (provider && provider.enabled === false) {
      const report = buildProviderDisabledReport(input.providerId, input.modelId, runtimeId, checkedAt)
      await this.deps.snapshotStore.writeReport(report)
      return report
    }

    if (!provider || !model || !provider.apiKey?.trim()) {
      const report = metadataProvider?.models.some((entry) => entry.id === input.modelId)
        ? buildMissingApiKeyReport(input.providerId, input.modelId, runtimeId, checkedAt)
        : buildMissingProviderReport(
            input.providerId,
            input.modelId,
            runtimeId,
            checkedAt,
            metadataProvider ? 'model_not_found' : undefined
          )
      await this.deps.snapshotStore.writeReport(report)
      return report
    }

    // Checks may probe a disabled draft, but must not grant it runtime readiness.
    const providerForCheck: ModelProvider = { ...provider, enabled: true }
    const providerStateForProbe: ProviderState = {
      providers: providerState.providers.map((entry) => entry.id === provider.id ? providerForCheck : entry)
    }

    const gatewaySnapshot = this.deps.gatewayService.getSnapshot()
    const shouldCheckGateway =
      input.checkGateway === true ||
      this.deps.checkGateway === true ||
      gatewaySnapshot.enabled === true

    // PLAT-66：没有 chat/completions 端点（默认端点就是原生 gemini）时，探测必须走
    // `:generateContent`；走 `/v1/chat/completions` 在 Google 上必然 404。
    const ordinaryChat = providerForCheck.endpoints[0]?.protocol === 'gemini'
      ? await probeGeminiNativeChatLane(providerForCheck, {
          fetch: this.deps.fetch,
          modelId: input.modelId,
          checkedAt
        })
      : mapOrdinaryChatLane(await testModelProviderConnection(providerForCheck, {
          fetch: this.deps.fetch,
          modelId: input.modelId
        }), checkedAt)

    // PLAT-63：配置了 Responses / Gemini 端点才探测（未配置不产出 lane）；聊天主链路仍是 chat/completions。
    const endpointLanes = await probeConfiguredEndpointLanes(providerForCheck, {
      fetch: this.deps.fetch,
      modelId: input.modelId,
      checkedAt
    })

    let directProbe: AgentRuntimeProbeSnapshot | undefined
    let gatewayProbe: AgentRuntimeProbeSnapshot | undefined

    // 没有 Anthropic 端点（例如 Gemini 原生供应商）就没有 Claude Code 运行时可言：
    // 不探测、不产出 lane，避免把「不支持 Anthropic 协议」当成该供应商的错误。
    const hasAnthropicEndpoint = Boolean(resolveProviderChatBase(providerForCheck, 'messages'))

    if (runtimeId === 'claude-code' && hasAnthropicEndpoint) {
      directProbe = await this.deps.probeService.probe({
        providerState: providerStateForProbe,
        providerId: input.providerId,
        modelId: input.modelId,
        runtimeId: 'claude-code',
        route: 'direct'
      })

      if (shouldCheckGateway) {
        this.deps.gatewayService.syncProviderConfig(providerForCheck, model)
        this.deps.probeService.invalidateGateway()
        gatewayProbe = await this.deps.probeService.probe({
          providerState: providerStateForProbe,
          providerId: input.providerId,
          modelId: input.modelId,
          runtimeId: 'claude-code',
          route: 'gateway'
        })
      }
    }

    const resolvedCompatibility = resolveAgentRuntimeCompatibility({
      provider,
      model,
      runtimeId,
      requireReadyProvider: true,
      gatewayEnabled: gatewaySnapshot.enabled || shouldCheckGateway,
      directProbe,
      gatewayProbe
    })
    // PLAT-62：探针明确命中「不支持 Anthropic 协议」时覆盖结论，
    // 不能退化成「该模型未启用 Claude Code 运行时」（那是 model-not-enabled 的语义）。
    const protocolUnsupported =
      probeFailureCode(directProbe) === 'protocol_unsupported' ||
      probeFailureCode(gatewayProbe) === 'protocol_unsupported'
    const finalCompatibility: AgentRuntimeCompatibilityResult = protocolUnsupported
      ? {
          ...resolvedCompatibility,
          selectable: false,
          status: 'protocol-unsupported',
          summary: 'This model does not support the Anthropic Messages protocol. Enable the agent gateway or choose another model.'
        }
      : resolvedCompatibility

    const signature = buildAgentModelProbeSignature({
      provider: providerForCheck,
      modelId: input.modelId,
      runtimeId,
      route: finalCompatibility.route === 'gateway' ? 'gateway' : 'direct',
      gatewayConfigVersion: gatewaySnapshot.updatedAt
    })

    const report: ProviderRuntimeCheckReport = {
      providerId: input.providerId,
      modelId: input.modelId,
      runtimeId,
      ordinaryChat,
      ...endpointLanes,
      ...(directProbe ? { direct: mapProbeLane('claude-code-direct', directProbe, 'direct') } : {}),
      ...(gatewayProbe
        ? { gateway: mapProbeLane('claude-code-gateway', gatewayProbe, 'gateway') }
        : shouldCheckGateway
          ? {
              gateway: createIdleLaneResult(
                'claude-code-gateway',
                'Agent model gateway probe was requested but no result was produced.'
              )
            }
          : {
              gateway: createIdleLaneResult(
                'claude-code-gateway',
                gatewaySnapshot.enabled
                  ? 'Agent model gateway is enabled but was not probed.'
                  : 'Agent model gateway is disabled.'
              )
            }),
      finalCompatibility,
      updatedAt: checkedAt,
      signature
    }

    await this.deps.snapshotStore.writeReport(report)
    return report
  }
}

export function createProviderRuntimeCheckService(
  deps: ProviderRuntimeCheckServiceDependencies
): ProviderRuntimeCheckService {
  return new ProviderRuntimeCheckService(deps)
}
