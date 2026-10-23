import { useEffect, useState } from 'react'

import type { AgentRuntimeCompatibilityResult } from '@platform/ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import {
  isProviderRuntimeCheckReport,
  isProviderRuntimeCheckReportStale,
  isProviderRuntimeCheckReportStaleForGateway,
  type ProviderRuntimeCheckReport
} from '@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import { hasClaudeCodeRuntimeCapability } from '@platform/ai/agent-platform/runtime/compatibility'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type { AgentModelGatewayUiSnapshot } from './agentModelGatewayStatus'
import { isAgentModelGatewaySnapshot } from './agentModelGatewayStatus'

const MAX_CONCURRENT_PROBES = 2

export function useAgentModelGatewaySnapshot(): {
  snapshot: AgentModelGatewayUiSnapshot | null
  busy: boolean
  refresh: () => Promise<void>
  enable: () => Promise<void>
  disable: () => Promise<void>
  start: (providerId?: string, modelId?: string) => Promise<void>
  stop: () => Promise<void>
} {
  const [snapshot, setSnapshot] = useState<AgentModelGatewayUiSnapshot | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    const next = await window.platform.agents.getModelGatewayStatus()
    if (isAgentModelGatewaySnapshot(next)) {
      setSnapshot(next)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await action()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return {
    snapshot,
    busy,
    refresh,
    enable: () => run(async () => window.platform.agents.setModelGatewayEnabled(true)),
    disable: () => run(async () => window.platform.agents.setModelGatewayEnabled(false)),
    start: (providerId, modelId) =>
      run(async () => window.platform.agents.startModelGateway(providerId, modelId)),
    stop: () => run(async () => window.platform.agents.stopModelGateway())
  }
}

export function useAgentModelCompatibilityMap(
  providers: readonly SafeModelProvider[],
  gatewaySnapshot: AgentModelGatewayUiSnapshot | null,
  selectedModelKey?: string | null
): ReadonlyMap<string, AgentRuntimeCompatibilityResult> {
  const [map, setMap] = useState<ReadonlyMap<string, AgentRuntimeCompatibilityResult>>(() => new Map())

  useEffect(() => {
    let cancelled = false

    async function loadCompatibility(): Promise<void> {
      const next = new Map<string, AgentRuntimeCompatibilityResult>()
      // PLAT-82：候选集与兼容性结论同一口径（都由 `AgentRuntimeCompatibilityService` 判定），
      // 不能只看 `agentRuntimes.claudeCode` —— 否则声明支持 messages 的模型永远没有证据。
      const candidates = providers.flatMap((provider) =>
        provider.models
          .filter((model) => hasClaudeCodeRuntimeCapability(model))
          .map((model) => ({ provider, model, key: `${provider.id}:${model.id}` }))
      )

      const reports = new Map<string, ProviderRuntimeCheckReport>()
      await mapPool(candidates, MAX_CONCURRENT_PROBES, async ({ provider, model, key }) => {
        try {
          const stored = await window.platform.modelProviders.getRuntimeCheckReport(
            provider.id,
            model.id,
            'claude-code'
          )
          if (
            isProviderRuntimeCheckReport(stored) &&
            !isProviderRuntimeCheckReportStale(stored) &&
            !isProviderRuntimeCheckReportStaleForGateway(stored, gatewaySnapshot)
          ) {
            reports.set(key, stored)
            next.set(key, stored.finalCompatibility)
            return
          }

          if (isProviderRuntimeCheckReport(stored)) {
            // Keep a temporary non-ready marker so the page does not fall back to optimistic static ready.
            next.set(key, {
              ...stored.finalCompatibility,
              selectable: false,
              route: 'none',
              status:
                stored.finalCompatibility.status === 'gateway-stopped' ||
                stored.finalCompatibility.status === 'gateway-required'
                  ? stored.finalCompatibility.status
                  : 'unknown',
              summary:
                stored.finalCompatibility.route === 'gateway'
                  ? 'Stored gateway readiness is stale after a gateway state change. Re-checking runtime route…'
                  : 'Stored runtime evidence is stale. Re-checking Claude Code route…'
            })
          }

          const cached = await window.platform.agents.getRuntimeCompatibility(
            provider.id,
            model.id,
            'claude-code'
          )
          if (cached && typeof cached === 'object' && 'selectable' in cached) {
            next.set(key, cached as AgentRuntimeCompatibilityResult)
          }
        } catch {
          // Keep local safe-subset fallback when IPC fails.
        }
      })

      if (!cancelled) {
        setMap(new Map(next))
      }

      const probeTarget = selectCompatibilityProbeTarget(candidates, selectedModelKey)
      const probeTargetReport = probeTarget ? reports.get(probeTarget.key) : undefined
      const shouldProbeTarget =
        probeTarget !== null &&
        (!probeTargetReport ||
          isProviderRuntimeCheckReportStale(probeTargetReport) ||
          isProviderRuntimeCheckReportStaleForGateway(probeTargetReport, gatewaySnapshot))

      /**
       * Only the model that can actually be sent right now is revalidated. Probing every candidate
       * (a provider can expose hundreds) turns one page open into a multi-minute network and
       * report-write storm, and competes with the real chat request.
       */
      const probeTargets =
        shouldProbeTarget && probeTarget !== null ? [probeTarget] : []
      await mapPool(probeTargets, MAX_CONCURRENT_PROBES, async ({ provider, model, key }) => {
        try {
          const report = await window.platform.modelProviders.runRuntimeChecks(provider.id, {
            modelId: model.id,
            runtimeId: 'claude-code',
            checkGateway: gatewaySnapshot?.enabled === true
          })
          if (!isProviderRuntimeCheckReport(report)) return
          next.set(key, report.finalCompatibility)
          if (!cancelled) {
            setMap(new Map(next))
          }
        } catch {
          // Keep previous map entry when background probe fails.
        }
      })
    }

    void loadCompatibility()
    return () => {
      cancelled = true
    }
  }, [
    providers,
    gatewaySnapshot?.enabled,
    gatewaySnapshot?.state,
    gatewaySnapshot?.updatedAt,
    selectedModelKey
  ])

  return map
}

/**
 * The compatibility map only needs fresh evidence for the one model the composer would send.
 * Other candidates keep their stored report (or stay "unverified" and selectable), so opening
 * the page never fans out into a probe per model.
 */
export function selectCompatibilityProbeTarget<T extends { key: string }>(
  candidates: readonly T[],
  selectedModelKey?: string | null
): T | null {
  if (!selectedModelKey) return null
  return candidates.find((candidate) => candidate.key === selectedModelKey) ?? null
}

async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  let index = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++]
      if (!current) return
      await worker(current)
    }
  })
  await Promise.all(runners)
}
