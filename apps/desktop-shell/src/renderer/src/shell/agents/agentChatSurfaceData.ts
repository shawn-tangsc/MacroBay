import { useCallback, useEffect, useState } from 'react'

import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { AgentSessionRuntimeSnapshot } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { AppSettings } from '@platform/settings/schema/appSettings'

import { PINNED_MODEL_IDS_STORAGE_KEY, parsePinnedModelIds } from '../modelPins'

/** Same empty shape the agent page starts from, so both surfaces read one contract. */
export const EMPTY_AGENT_RUNTIME_SNAPSHOT: AgentSessionRuntimeSnapshot = {
  sessions: {},
  toolApprovals: [],
  toolApprovalHistory: [],
  chunksBySessionId: {},
  updatedAt: ''
}

export type AgentChatSurfaceDataStatus = 'loading' | 'ready' | 'failed'

export type AgentChatSurfaceData = {
  status: AgentChatSurfaceDataStatus
  state: AgentStoreState | null
  runtime: AgentSessionRuntimeSnapshot
  settings: AppSettings | null
  providers: SafeModelProvider[]
  pinnedModelIds: string[]
  /** Applies an optimistic projection; the main process pushes the authoritative state after. */
  updateState: (updater: (state: AgentStoreState) => AgentStoreState) => void
  /** Lets a resolved tool approval show its result before the next runtime push arrives. */
  applyRuntime: (snapshot: AgentSessionRuntimeSnapshot) => void
}

/**
 * Everything an embedded conversation needs to render the same message list and composer the
 * agent page renders: the store snapshot, the live runtime snapshot, and the model settings the
 * composer's pickers read. It subscribes to the platform's pushes, so a surface mounted outside
 * the agent page still streams and still shows tool approvals.
 */
export function useAgentChatSurfaceData(): AgentChatSurfaceData {
  const [status, setStatus] = useState<AgentChatSurfaceDataStatus>('loading')
  const [state, setState] = useState<AgentStoreState | null>(null)
  const [runtime, setRuntime] = useState<AgentSessionRuntimeSnapshot>(EMPTY_AGENT_RUNTIME_SNAPSHOT)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providers, setProviders] = useState<SafeModelProvider[]>([])
  const [pinnedModelIds, setPinnedModelIds] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    const api = window.platform
    if (!api?.agents) {
      setStatus('failed')
      return
    }
    // Settings and the provider catalog feed the composer's pickers. They are optional here so a
    // surface still renders (and so a detached window that never loaded the model service does
    // not go blank) — the composer falls back to no model menu rather than no conversation.
    const optional = <T,>(read: () => Promise<T>, fallback: T): Promise<T> =>
      Promise.resolve()
        .then(read)
        .catch(() => fallback)

    void Promise.all([
      api.agents.getState(),
      optional(() => api.agents.getRuntimeSnapshot(), EMPTY_AGENT_RUNTIME_SNAPSHOT),
      optional(() => api.settings.get(), null),
      optional(() => api.modelProviders.list(), [])
    ])
      .then(([rawState, rawRuntime, rawSettings, rawProviders]) => {
        if (!alive) return
        if (!rawState || typeof rawState !== 'object') {
          setStatus('failed')
          return
        }
        setState(rawState as AgentStoreState)
        setRuntime((rawRuntime as AgentSessionRuntimeSnapshot | null) ?? EMPTY_AGENT_RUNTIME_SNAPSHOT)
        setSettings((rawSettings as AppSettings | null) ?? null)
        setProviders(Array.isArray(rawProviders) ? (rawProviders as SafeModelProvider[]) : [])
        setPinnedModelIds(parsePinnedModelIds(window.localStorage.getItem(PINNED_MODEL_IDS_STORAGE_KEY)))
        setStatus('ready')
      })
      .catch(() => {
        if (alive) setStatus('failed')
      })

    const unsubscribeState = api.agents.onStateChanged((next) => {
      if (alive) setState(next as AgentStoreState)
    })
    const unsubscribeRuntime = api.agents.onRuntimeStateChanged?.((next) => {
      if (alive) setRuntime(next as AgentSessionRuntimeSnapshot)
    })

    return () => {
      alive = false
      unsubscribeState?.()
      unsubscribeRuntime?.()
    }
  }, [])

  const updateState = useCallback((updater: (current: AgentStoreState) => AgentStoreState) => {
    setState((current) => (current ? updater(current) : current))
  }, [])

  const applyRuntime = useCallback((snapshot: AgentSessionRuntimeSnapshot) => {
    setRuntime(snapshot)
  }, [])

  return { status, state, runtime, settings, providers, pinnedModelIds, updateState, applyRuntime }
}
