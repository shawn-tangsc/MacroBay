import {
  agentTypeToRuntimeId,
  resolveAgentRuntimeCompatibility
} from '../../../ai/agent-platform/runtime/compatibility'
import type {
  AgentRuntimeCompatibilityResult,
  AgentRuntimeId
} from '../../../ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import {
  isProviderRuntimeCheckReportStale,
  isProviderRuntimeCheckReportStaleForGateway
} from '../../../ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import type { ProviderStateAccessor } from '../../../ai/providers/modelProviderTypes'
import type { AgentModelGatewayService } from '../agentModelGateway/AgentModelGatewayService'
import type { AgentModelGatewaySnapshot } from '../agentModelGateway/agentModelGatewayTypes'
import type { AgentModelRuntimeProbeService } from './AgentModelRuntimeProbeService'
import type { AgentRuntimeProbeSnapshotStore } from './AgentRuntimeProbeSnapshotStore'

export type AgentModelCompatibilityControl = {
  getRuntimeCompatibility: (
    providerId: string,
    modelId: string,
    runtimeId: AgentRuntimeId
  ) => Promise<AgentRuntimeCompatibilityResult>
  probeRuntimeCompatibility: (
    providerId: string,
    modelId: string,
    runtimeId: AgentRuntimeId
  ) => Promise<AgentRuntimeCompatibilityResult>
  getModelGatewayStatus: () => AgentModelGatewaySnapshot
  startModelGateway: (providerId?: string, modelId?: string) => Promise<{
    ok: boolean
    snapshot: AgentModelGatewaySnapshot
    message?: string
  }>
  stopModelGateway: () => Promise<{
    ok: boolean
    snapshot: AgentModelGatewaySnapshot
    message?: string
  }>
  setModelGatewayEnabled: (enabled: boolean) => Promise<AgentModelGatewaySnapshot>
}

export type CreateAgentModelCompatibilityControlDependencies = {
  getProviderState: ProviderStateAccessor
  probeService: AgentModelRuntimeProbeService
  gatewayService: AgentModelGatewayService
  snapshotStore?: AgentRuntimeProbeSnapshotStore
}

export function createAgentModelCompatibilityControl(
  deps: CreateAgentModelCompatibilityControlDependencies
): AgentModelCompatibilityControl {
  return {
    getRuntimeCompatibility: async (providerId, modelId, runtimeId) =>
      resolveCompatibility(deps, providerId, modelId, runtimeId, { probe: false }),
    probeRuntimeCompatibility: async (providerId, modelId, runtimeId) =>
      resolveCompatibility(deps, providerId, modelId, runtimeId, { probe: true }),
    getModelGatewayStatus: () => deps.gatewayService.getSnapshot(),
    startModelGateway: async (providerId, modelId) => {
      deps.gatewayService.setEnabled(true)
      if (providerId && modelId) {
        const providerState = await deps.getProviderState()
        const metadataProvider = providerState.providers.find((entry) => entry.id === providerId)
        const provider = deps.getProviderState.resolveRuntimeProvider
          ? await deps.getProviderState.resolveRuntimeProvider(providerId)
          : metadataProvider
        const model = provider?.models.find((entry) => entry.id === modelId)
        if (!provider?.apiKey?.trim() || !model) {
          return {
            ok: false,
            snapshot: deps.gatewayService.getSnapshot(),
            message: 'Provider or model was not found for gateway sync.'
          }
        }
        deps.gatewayService.syncProviderConfig(provider, model)
      }
      const result = await deps.gatewayService.start()
      await invalidateGatewayEvidence(deps)
      return result.ok
        ? { ok: true, snapshot: result.snapshot }
        : { ok: false, snapshot: result.snapshot, message: result.message }
    },
    stopModelGateway: async () => {
      const result = await deps.gatewayService.stop()
      await invalidateGatewayEvidence(deps)
      return result.ok
        ? { ok: true, snapshot: result.snapshot }
        : { ok: false, snapshot: result.snapshot, message: result.message }
    },
    setModelGatewayEnabled: async (enabled) => {
      const snapshot = deps.gatewayService.setEnabled(enabled)
      await invalidateGatewayEvidence(deps)
      return snapshot
    }
  }
}

async function invalidateGatewayEvidence(
  deps: CreateAgentModelCompatibilityControlDependencies
): Promise<void> {
  deps.probeService.invalidateGateway()
  await deps.snapshotStore?.invalidateGatewayDependentReports()
}

async function resolveCompatibility(
  deps: CreateAgentModelCompatibilityControlDependencies,
  providerId: string,
  modelId: string,
  runtimeId: AgentRuntimeId,
  options: { probe: boolean }
): Promise<AgentRuntimeCompatibilityResult> {
  const normalizedRuntimeId = agentTypeToRuntimeId(runtimeId) ?? runtimeId
  const providerState = await deps.getProviderState()
  const metadataProvider = providerState.providers.find((entry) => entry.id === providerId)
  const runtimeProvider = options.probe && deps.getProviderState.resolveRuntimeProvider
    ? await deps.getProviderState.resolveRuntimeProvider(providerId)
    : metadataProvider
  const provider = runtimeProvider
  const model = provider?.models.find((entry) => entry.id === modelId)
  if (!provider || !model) {
    return {
      providerId,
      modelId,
      runtimeId: normalizedRuntimeId,
      selectable: false,
      route: 'none',
      status: 'unknown',
      summary: 'Provider or model was not found.'
    }
  }

  const gatewaySnapshot = deps.gatewayService.getSnapshot()
  const gatewayEnabled = gatewaySnapshot.enabled

  if (options.probe && !provider.apiKey?.trim()) {
    return resolveAgentRuntimeCompatibility({
      provider: { ...provider, apiKeyRef: undefined },
      model,
      runtimeId: normalizedRuntimeId,
      requireReadyProvider: true,
      gatewayEnabled
    })
  }

  if (!options.probe && deps.snapshotStore && normalizedRuntimeId === 'claude-code') {
    const stored = await deps.snapshotStore.getReport(providerId, modelId, normalizedRuntimeId)
    if (
      stored &&
      !isProviderRuntimeCheckReportStale(stored) &&
      !isProviderRuntimeCheckReportStaleForGateway(stored, gatewaySnapshot)
    ) {
      return stored.finalCompatibility
    }
  }

  let directProbe
  let gatewayProbe
  if (options.probe && normalizedRuntimeId === 'claude-code') {
    directProbe = await deps.probeService.probe({
      providerState,
      providerId,
      modelId,
      runtimeId: 'claude-code',
      route: 'direct'
    })
    if (gatewayEnabled) {
      deps.gatewayService.syncProviderConfig(provider, model)
      deps.probeService.invalidateGateway()
      gatewayProbe = await deps.probeService.probe({
        providerState,
        providerId,
        modelId,
        runtimeId: 'claude-code',
        route: 'gateway'
      })
    }
  } else if (normalizedRuntimeId === 'claude-code') {
    const directSignature = deps.probeService.buildSignature({
      providerState,
      providerId,
      modelId,
      runtimeId: 'claude-code',
      route: 'direct'
    })
    directProbe = directSignature ? deps.probeService.getCachedSnapshot(directSignature) : undefined
    if (gatewayEnabled) {
      const gatewaySignature = deps.probeService.buildSignature({
        providerState,
        providerId,
        modelId,
        runtimeId: 'claude-code',
        route: 'gateway'
      })
      gatewayProbe = gatewaySignature ? deps.probeService.getCachedSnapshot(gatewaySignature) : undefined
    }
  }

  const result = resolveAgentRuntimeCompatibility({
    provider,
    model,
    runtimeId: normalizedRuntimeId,
    requireReadyProvider: true,
    gatewayEnabled,
    directProbe,
    gatewayProbe
  })

  if (!options.probe && !directProbe && !gatewayProbe && result.selectable && result.route === 'direct') {
    return {
      ...result,
      selectable: false,
      route: 'none',
      status: 'unknown',
      summary:
        'Claude Code runtime route has not been verified yet. Run a runtime connection check before selecting this model.'
    }
  }

  return result
}
