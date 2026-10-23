import type { AgentStoreState } from '../../store/agentStore'
import type { AgentTaskSchedulerRuntimeTask, AgentTaskSchedulerSnapshot } from '../runtimeTypes'
import { buildAgentTaskSchedulerSnapshot } from './taskSchedulerPlanner'

type AgentTaskSchedulerRuntimeServiceDependencies = {
  now?: () => string
  startupAt?: string
  getAgentState?: () => Promise<AgentStoreState>
  dispatchDueTask?: (task: AgentTaskSchedulerRuntimeTask) => Promise<void>
  enqueueDueTask?: (task: AgentTaskSchedulerRuntimeTask) => Promise<void>
  minimumDelayMs?: number
  maximumDelayMs?: number
}

const defaultNow = (): string => new Date().toISOString()
const DEFAULT_MINIMUM_DELAY_MS = 1_000
const DEFAULT_MAXIMUM_DELAY_MS = 60_000

export class AgentTaskSchedulerRuntimeService {
  private snapshot: AgentTaskSchedulerSnapshot = {
    tasksById: {},
    dueTaskIds: [],
    updatedAt: defaultNow()
  }

  private readonly listeners = new Set<(snapshot: AgentTaskSchedulerSnapshot) => void>()
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null
  private reconcileInFlight: Promise<void> | null = null
  private runningTaskIds = new Set<string>()
  private startupRecoveryActive: boolean
  private stopped = true

  constructor(private readonly deps: AgentTaskSchedulerRuntimeServiceDependencies = {}) {
    this.startupRecoveryActive = Boolean(deps.startupAt)
  }

  subscribe(listener: (snapshot: AgentTaskSchedulerSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): AgentTaskSchedulerSnapshot {
    return {
      tasksById: Object.fromEntries(
        Object.entries(this.snapshot.tasksById).map(([taskId, task]) => [taskId, cloneRuntimeTask(task)])
      ),
      dueTaskIds: [...this.snapshot.dueTaskIds],
      updatedAt: this.snapshot.updatedAt
    }
  }

  syncFromState(state: AgentStoreState): AgentTaskSchedulerSnapshot {
    this.snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: (this.deps.now ?? defaultNow)(),
      startupAt: this.startupRecoveryActive ? this.deps.startupAt : undefined
    })
    this.emitSnapshot()
    return this.getSnapshot()
  }

  listDueTasks(): AgentTaskSchedulerRuntimeTask[] {
    return this.snapshot.dueTaskIds
      .map((taskId) => this.snapshot.tasksById[taskId])
      .filter((task): task is AgentTaskSchedulerRuntimeTask => Boolean(task))
      .map((task) => cloneRuntimeTask(task))
  }

  start(): void {
    if (!this.deps.getAgentState || !this.dispatchDueTask) return
    this.stopped = false
    this.scheduleNextReconcile(0)
  }

  stop(): void {
    this.stopped = true
    if (this.reconcileTimer) {
      clearTimeout(this.reconcileTimer)
      this.reconcileTimer = null
    }
  }

  async reconcile(): Promise<void> {
    if (!this.deps.getAgentState || !this.dispatchDueTask) return
    if (this.reconcileInFlight) return this.reconcileInFlight

    this.reconcileInFlight = this.performReconcile().finally(() => {
      this.reconcileInFlight = null
    })
    return this.reconcileInFlight
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private async performReconcile(): Promise<void> {
    try {
      const state = await this.deps.getAgentState?.()
      if (!state || !this.dispatchDueTask) return

      this.syncFromState(state)
      const dueTasks = this.listDueTasks().filter((task) => !this.runningTaskIds.has(task.taskId))

      for (const task of dueTasks) {
        this.runningTaskIds.add(task.taskId)
        try {
          await this.dispatchDueTask(task)
        } catch {
          // Keep later due tasks and the next reconcile cycle alive even if one dispatch fails.
        } finally {
          this.runningTaskIds.delete(task.taskId)
        }
      }
    } finally {
      const refreshedState = await this.deps.getAgentState?.()
      if (refreshedState) {
        this.syncFromState(refreshedState)
      }
      this.startupRecoveryActive = false
      this.scheduleNextReconcile(this.computeNextDelayMs())
    }
  }

  private scheduleNextReconcile(delayMs: number): void {
    if (!this.deps.getAgentState || !this.dispatchDueTask) return
    if (this.stopped) return
    if (this.reconcileTimer) {
      clearTimeout(this.reconcileTimer)
    }
    this.reconcileTimer = setTimeout(() => {
      void this.reconcile()
    }, Math.max(0, delayMs))
  }

  private get dispatchDueTask(): ((task: AgentTaskSchedulerRuntimeTask) => Promise<void>) | undefined {
    return this.deps.enqueueDueTask ?? this.deps.dispatchDueTask
  }

  private computeNextDelayMs(): number {
    const nowMs = Date.parse((this.deps.now ?? defaultNow)())
    const minimumDelayMs = this.deps.minimumDelayMs ?? DEFAULT_MINIMUM_DELAY_MS
    const maximumDelayMs = this.deps.maximumDelayMs ?? DEFAULT_MAXIMUM_DELAY_MS
    const nextDueMs = this.listDueTasks()
      .map((task) => (task.nextRunAt ? Date.parse(task.nextRunAt) : Number.POSITIVE_INFINITY))
      .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY)

    if (!Number.isFinite(nextDueMs)) {
      return maximumDelayMs
    }

    return Math.max(minimumDelayMs, Math.min(maximumDelayMs, Math.max(0, nextDueMs - nowMs)))
  }
}

function cloneRuntimeTask(task: AgentTaskSchedulerRuntimeTask): AgentTaskSchedulerRuntimeTask {
  return {
    ...task,
    workspace: cloneWorkspace(task.workspace),
    trigger: cloneTrigger(task.trigger),
    subscribedChannelIds: [...task.subscribedChannelIds],
    activeChannelIds: [...task.activeChannelIds],
    inactiveChannelIds: [...task.inactiveChannelIds]
  }
}

function cloneTrigger(trigger: AgentTaskSchedulerRuntimeTask['trigger']): AgentTaskSchedulerRuntimeTask['trigger'] {
  switch (trigger.kind) {
    case 'cron':
      return { ...trigger }
    case 'interval':
      return { ...trigger }
    case 'once':
      return { ...trigger }
    default:
      return trigger
  }
}

function cloneWorkspace(workspace: AgentTaskSchedulerRuntimeTask['workspace']): AgentTaskSchedulerRuntimeTask['workspace'] {
  if (workspace.type === 'user') {
    return { ...workspace }
  }
  return { ...workspace }
}
