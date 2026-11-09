import {
  createClaudeCodeProviderEnvironment,
  type ClaudeCodeProviderEnvironmentOptions,
  type ClaudeCodeProviderEnvironmentResult
} from '../../ai/agent-platform/runtime/drivers/claudeCode'
import type { ProviderState, ProviderStateAccessor } from '../../ai/providers/modelProviderTypes'
import {
  isProviderRuntimeCheckReportStale,
  isProviderRuntimeCheckReportStaleForGateway,
  type ProviderRuntimeCheckReport
} from '../../ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import type { AgentRuntimeProbeSnapshot } from '../../ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type { AgentModelGatewayService } from './agentModelGateway/AgentModelGatewayService'
import type { AgentRuntimeProbeSnapshotStore } from './agentModelCompatibility/AgentRuntimeProbeSnapshotStore'

/**
 * Claude Code 每次回合的 **provider environment**：解析模型引用、按运行时兼容性证据选直连还是网关。
 *
 * 从 `claudeCodeRuntimeDependencies.ts` 原样搬出（行为 0 改动）：那一块只依赖 provider 状态与
 * 兼容性探针，与 SDK 驱动装配无关；主文件继续 re-export，外部 import 面不变。
 */
export type ProviderEnvironmentResolverDependencies = {
  getProviderState: ProviderStateAccessor
  refreshRuntimeCheck?: (providerId: string, modelId: string, checkGateway?: boolean) => Promise<ProviderRuntimeCheckReport | null>
  gatewayService?: Pick<
    AgentModelGatewayService,
    'getSnapshot' | 'getAuthToken' | 'isSyncedFor' | 'syncProviderConfig'
  >
  snapshotStore?: Pick<AgentRuntimeProbeSnapshotStore, 'getReport'>
}

/** 与原 `ClaudeCodeRuntimeDriverDependencies['resolveProviderEnvironment']` 同形。 */
export type ClaudeCodeProviderEnvironmentResolver =
  (uniqueModelId: string) => Promise<ClaudeCodeProviderEnvironmentResult>

export function createClaudeCodeProviderEnvironmentResolver(
  deps: ProviderEnvironmentResolverDependencies
): ClaudeCodeProviderEnvironmentResolver {
  return async (uniqueModelId: string): Promise<ClaudeCodeProviderEnvironmentResult> => {
    const providerState = await deps.getProviderState()
    const reference = parseProviderModelReference(uniqueModelId)
    const runtimeProvider = reference && deps.getProviderState.resolveRuntimeProvider
      ? await deps.getProviderState.resolveRuntimeProvider(reference.providerId)
      : null
    if (reference && deps.getProviderState.resolveRuntimeProvider && !runtimeProvider?.apiKey?.trim()) {
      return {
        ok: false,
        errorCode: 'missing-api-key',
        message: 'Claude Code provider API key is unavailable.'
      }
    }
    const runtimeState = runtimeProvider
      ? { providers: providerState.providers.map((provider) => provider.id === runtimeProvider.id ? runtimeProvider : provider) }
      : providerState
    const options = await resolveProviderEnvironmentOptions(runtimeState, uniqueModelId, deps)
    return createClaudeCodeProviderEnvironment(runtimeState, uniqueModelId, options)
  }
}

async function resolveProviderEnvironmentOptions(
  providerState: ProviderState,
  uniqueModelId: string,
  deps: ProviderEnvironmentResolverDependencies
): Promise<ClaudeCodeProviderEnvironmentOptions> {
  const reference = parseProviderModelReference(uniqueModelId)
  if (!reference || !deps.gatewayService || !deps.snapshotStore) {
    return {}
  }

  const provider = providerState.providers.find((entry) => entry.id === reference.providerId)
  const model = provider?.models.find((entry) => entry.id === reference.modelId)
  if (!provider || !model) {
    return {}
  }

  const gatewaySnapshot = deps.gatewayService.getSnapshot()
  const isGatewayStale = (candidate: ProviderRuntimeCheckReport): boolean =>
    isProviderRuntimeCheckReportStaleForGateway(candidate, gatewaySnapshot)
  let report = await deps.snapshotStore.getReport(reference.providerId, reference.modelId, 'claude-code')

  if (!report || isGatewayStale(report)) {
    // No evidence yet, or the gateway route changed: the route cannot be chosen without a fresh
    // answer, so this single turn pays for the probe.
    if (deps.refreshRuntimeCheck) {
      try {
        report = await deps.refreshRuntimeCheck(
          reference.providerId,
          reference.modelId,
          gatewaySnapshot.enabled === true
        )
      } catch {
        report = null
      }
    }
  } else if (isProviderRuntimeCheckReportStale(report)) {
    // Age alone must not gate the first token. Keep the last known-good route for this turn and
    // refresh in the background so the next turn can use the newer evidence.
    void deps.refreshRuntimeCheck?.(
      reference.providerId,
      reference.modelId,
      gatewaySnapshot.enabled === true
    ).catch(() => undefined)
  }
  if (!report || isGatewayStale(report)) {
    return {
      gatewayEnabled: gatewaySnapshot.enabled
    }
  }

  const options: ClaudeCodeProviderEnvironmentOptions = {
    gatewayEnabled: gatewaySnapshot.enabled
  }

  const directProbe = toProbeSnapshot(report, 'direct')
  const gatewayProbe = toProbeSnapshot(report, 'gateway')

  if (directProbe) {
    options.directProbe = directProbe
  }

  if (report.finalCompatibility.route !== 'gateway' || !report.finalCompatibility.selectable) {
    if (gatewayProbe) {
      options.gatewayProbe = gatewayProbe
    }
    return options
  }

  if (
    gatewaySnapshot.enabled !== true ||
    gatewaySnapshot.state !== 'running' ||
    !gatewaySnapshot.baseUrl
  ) {
    return options
  }

  if (!deps.gatewayService.isSyncedFor(reference.providerId, reference.modelId)) {
    deps.gatewayService.syncProviderConfig(provider, model)
  }

  return {
    ...options,
    ...(gatewayProbe ? { gatewayProbe } : {}),
    gateway: {
      baseUrl: gatewaySnapshot.baseUrl,
      authToken: deps.gatewayService.getAuthToken()
    }
  }
}

function parseProviderModelReference(
  uniqueModelId: string
): { providerId: string; modelId: string } | null {
  const separatorIndex = uniqueModelId.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === uniqueModelId.length - 1) {
    return null
  }
  return {
    providerId: uniqueModelId.slice(0, separatorIndex),
    modelId: uniqueModelId.slice(separatorIndex + 1)
  }
}

function toProbeSnapshot(
  report: ProviderRuntimeCheckReport,
  route: 'direct' | 'gateway'
): AgentRuntimeProbeSnapshot | undefined {
  const lane = route === 'direct' ? report.direct : report.gateway
  if (!lane || !lane.checkedAt) {
    return undefined
  }
  return {
    route,
    providerId: report.providerId,
    modelId: report.modelId,
    runtimeId: report.runtimeId,
    signature: `${report.signature}:${route}`,
    checkedAt: lane.checkedAt,
    status: mapLaneStatusToProbeStatus(lane.status),
    message: lane.summary
  }
}

function mapLaneStatusToProbeStatus(
  status: ProviderRuntimeCheckReport['ordinaryChat']['status']
): AgentRuntimeProbeSnapshot['status'] {
  switch (status) {
    case 'ready':
      return 'ready'
    case 'auth-failed':
      return 'auth-failed'
    case 'forbidden':
      return 'forbidden'
    case 'protocol-unsupported':
      return 'protocol-unsupported'
    case 'timeout':
      return 'timeout'
    case 'network-error':
      return 'network-error'
    default:
      return 'unknown'
  }
}
