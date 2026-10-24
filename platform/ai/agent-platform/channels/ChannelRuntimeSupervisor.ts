import type {
  AgentChannelRuntimeSnapshot,
  AgentChannelRuntimeSnapshotEntry,
  AgentChannelRuntimeState
} from './ChannelRuntimeService'
import type { ChannelManagementQueryRepository } from './ChannelManagementQueryRepository'

type SupervisorDependencies = {
  query: Pick<ChannelManagementQueryRepository, 'runtimeRows'>
  restart: (channelId: string) => Promise<unknown>
  now?: () => number
}

type RuntimeStatus = {
  state: Exclude<AgentChannelRuntimeState, 'inactive'>
  errorCode?: string
}

/**
 * Read model and control seam for the channel runtime. The durable generation rows are the source
 * of truth; this class never consults legacy agent-store channel entities.
 */
export class ChannelRuntimeSupervisor {
  private readonly statusByChannelId = new Map<string, RuntimeStatus>()

  constructor(private readonly deps: SupervisorDependencies) {}

  snapshot(): AgentChannelRuntimeSnapshot {
    const now = (this.deps.now ?? Date.now)()
    const rows = this.deps.query.runtimeRows()
    const conversationCount = new Map<string, number>()
    for (const row of rows) {
      if (row.sessionId) conversationCount.set(row.channelId, (conversationCount.get(row.channelId) ?? 0) + 1)
    }

    const entries = rows.map((row): AgentChannelRuntimeSnapshotEntry => {
      const active = row.requestedEnabled && row.migrationState === 'runtime-ready' && row.lifecycleState === 'active'
      const status = this.statusByChannelId.get(row.channelId)
      const runtimeState: AgentChannelRuntimeState = active ? status?.state ?? 'connecting' : 'inactive'
      return {
        channelId: row.channelId,
        type: row.type,
        agentId: row.agentId,
        sessionId: row.sessionId,
        isActive: active,
        activeChatCount: conversationCount.get(row.channelId) ?? 0,
        runtimeState,
        ...(status?.errorCode ? { runtimeMessage: status.errorCode } : {}),
        ...(active ? { runtimeLifecycleState: runtimeState === 'connected' ? 'ready' : 'connecting' } : {}),
        updatedAt: now
      }
    })

    return { channels: entries }
  }

  async restart(channelId: string): Promise<AgentChannelRuntimeSnapshot> {
    await this.deps.restart(channelId)
    return this.snapshot()
  }

  /** Runtime managers call this after a lifecycle transition; only the current generation should. */
  setStatus(channelId: string, status: RuntimeStatus | null): void {
    if (status) this.statusByChannelId.set(channelId, status)
    else this.statusByChannelId.delete(channelId)
  }
}
