import type { AgentRuntimeId, AgentRuntimeProbeSnapshot } from '../../../ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type { ProviderState } from '../../../ai/providers/modelProviderTypes'
import type { AgentModelGatewaySnapshot } from '../agentModelGateway/agentModelGatewayTypes'
import { buildAgentModelProbeSignature } from './agentModelProbeSignature'
import { createClaudeCodeDirectProbe } from './createClaudeCodeDirectProbe'
import { createGatewayProbe } from './createGatewayProbe'

export type AgentModelRuntimeProbeRequest = {
  providerState: ProviderState
  providerId: string
  modelId: string
  runtimeId: AgentRuntimeId
  route?: 'direct' | 'gateway'
  abortSignal?: AbortSignal
}

export type AgentModelRuntimeProbeServiceDependencies = {
  fetch: typeof fetch
  timeoutMs?: number
  now?: () => Date
  getGatewaySnapshot?: () => AgentModelGatewaySnapshot
  getGatewayAuthToken?: () => string
  runGatewayProbe?: (input: AgentModelRuntimeProbeRequest) => Promise<AgentRuntimeProbeSnapshot>
}

export class AgentModelRuntimeProbeService {
  private readonly cache = new Map<string, AgentRuntimeProbeSnapshot>()
  private gatewayConfigVersion = '0'

  constructor(private readonly deps: AgentModelRuntimeProbeServiceDependencies) {}

  getCachedSnapshot(signature: string): AgentRuntimeProbeSnapshot | undefined {
    return this.cache.get(signature)
  }

  invalidateAll(): void {
    this.cache.clear()
  }

  invalidateProvider(providerId: string): void {
    for (const [signature, snapshot] of this.cache.entries()) {
      if (snapshot.providerId === providerId) {
        this.cache.delete(signature)
      }
    }
  }

  invalidateGateway(): void {
    this.gatewayConfigVersion = String(Number(this.gatewayConfigVersion) + 1)
    for (const [signature, snapshot] of this.cache.entries()) {
      if (snapshot.route === 'gateway') {
        this.cache.delete(signature)
      }
    }
  }

  buildSignature(input: {
    providerState: ProviderState
    providerId: string
    modelId: string
    runtimeId: AgentRuntimeId
    route: 'direct' | 'gateway'
  }): string | null {
    const provider = input.providerState.providers.find((entry) => entry.id === input.providerId)
    if (!provider) return null

    return buildAgentModelProbeSignature({
      provider,
      modelId: input.modelId,
      runtimeId: input.runtimeId,
      route: input.route,
      gatewayConfigVersion: input.route === 'gateway' ? this.gatewayConfigVersion : undefined
    })
  }

  async probe(input: AgentModelRuntimeProbeRequest): Promise<AgentRuntimeProbeSnapshot> {
    const route = input.route ?? 'direct'
    const signature = this.buildSignature({
      providerState: input.providerState,
      providerId: input.providerId,
      modelId: input.modelId,
      runtimeId: input.runtimeId,
      route
    })

    if (!signature) {
      return this.createMissingProviderSnapshot(input, route)
    }

    const cached = this.cache.get(signature)
    if (cached) {
      return cached
    }

    const snapshot =
      input.runtimeId === 'claude-code' && route === 'direct'
        ? await createClaudeCodeDirectProbe(
            {
              providerState: input.providerState,
              providerId: input.providerId,
              modelId: input.modelId,
              abortSignal: input.abortSignal
            },
            {
              fetch: this.deps.fetch,
              timeoutMs: this.deps.timeoutMs,
              now: this.deps.now
            }
          )
        : input.runtimeId === 'claude-code' && route === 'gateway'
          ? await this.runGatewayProbe(input)
          : this.createUnsupportedProbeSnapshot(input, route)

    this.cache.set(signature, snapshot)
    return snapshot
  }

  private async runGatewayProbe(input: AgentModelRuntimeProbeRequest): Promise<AgentRuntimeProbeSnapshot> {
    if (this.deps.runGatewayProbe) {
      return this.deps.runGatewayProbe({ ...input, route: 'gateway' })
    }
    if (!this.deps.getGatewaySnapshot || !this.deps.getGatewayAuthToken) {
      return this.createUnsupportedProbeSnapshot(input, 'gateway')
    }
    return createGatewayProbe(
      {
        providerId: input.providerId,
        modelId: input.modelId,
        abortSignal: input.abortSignal
      },
      {
        fetch: this.deps.fetch,
        getGatewaySnapshot: this.deps.getGatewaySnapshot,
        getGatewayAuthToken: this.deps.getGatewayAuthToken,
        timeoutMs: this.deps.timeoutMs,
        now: this.deps.now
      }
    )
  }

  private createMissingProviderSnapshot(
    input: AgentModelRuntimeProbeRequest,
    route: 'direct' | 'gateway'
  ): AgentRuntimeProbeSnapshot {
    const checkedAt = (this.deps.now ?? (() => new Date()))().toISOString()
    return {
      route,
      providerId: input.providerId,
      modelId: input.modelId,
      runtimeId: input.runtimeId,
      signature: `${input.runtimeId}:${route}:${input.providerId}:${input.modelId}:missing-provider`,
      checkedAt,
      status: 'unknown',
      message: 'Provider was not found for runtime probe.'
    }
  }

  private createUnsupportedProbeSnapshot(
    input: AgentModelRuntimeProbeRequest,
    route: 'direct' | 'gateway'
  ): AgentRuntimeProbeSnapshot {
    const checkedAt = (this.deps.now ?? (() => new Date()))().toISOString()
    return {
      route,
      providerId: input.providerId,
      modelId: input.modelId,
      runtimeId: input.runtimeId,
      signature: `${input.runtimeId}:${route}:${input.providerId}:${input.modelId}:unsupported`,
      checkedAt,
      status: 'unknown',
      message: 'Runtime probe route is not implemented yet.'
    }
  }
}

export function createAgentModelRuntimeProbeService(
  deps: AgentModelRuntimeProbeServiceDependencies
): AgentModelRuntimeProbeService {
  return new AgentModelRuntimeProbeService(deps)
}
