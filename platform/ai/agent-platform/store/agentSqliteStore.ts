import { createHash, randomUUID } from 'node:crypto'

import type { AgentChannelEntity } from '../schemas/channelSchemas'
import type { McpRuntimeStatus, McpServerEntity } from '../schemas/mcpServerSchemas'
import type { AgentSessionMessageEntity } from '../schemas/sessionSchemas'
import type { InstalledSkill } from '../schemas/skillSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '../schemas/taskSchemas'
import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { createAgentPlatformRepositories } from '../repositories/createAgentPlatformRepositories'
import type { TaskMutationAuditEntity } from '../runtime/tasks/taskAutomationContracts'
import type { McpToolsByServerId } from '../tools/agentToolCatalog'
import type {
  AgentChannelTaskSubscription,
  AgentProductToolPackageBinding,
  AgentSkillBinding,
  AgentStoreSeed,
  AgentStoreState
} from './agentStore'
import {
  createDefaultAgentPersistentState,
  mergeAgentStoreSeeds,
  normalizeAgentStoreState,
  type AgentPersistentWriteOptions,
  type AgentPersistentStore
} from './agentPersistentStore'

type ActiveSelection = {
  activeAgentId: string | null
  activeSessionId: string | null
}

export function createAgentSqliteStore(database: AgentPlatformDatabase, seed: AgentStoreSeed = {}): AgentPersistentStore {
  return createAgentSqliteStoreWithOptions(database, seed, {})
}

export function createAgentSqliteStoreWithOptions(
  database: AgentPlatformDatabase,
  seed: AgentStoreSeed = {},
  options: {
    legacyStateLoader?: () => Promise<unknown>
    legacyStateArchiver?: (state: AgentStoreState) => Promise<void> | void
  } = {}
): AgentPersistentStore {
  const repositories = createAgentPlatformRepositories(database)
  // C03 has no runtime-ready Channel writer. A legacy seed must not bypass the
  // migration barrier and reintroduce a plaintext config during hydration.
  const safeSeed: AgentStoreSeed = { ...seed, channels: [] }
  let state: AgentStoreState | null = null
  let stateMutationQueue: Promise<void> = Promise.resolve()

  async function load(): Promise<AgentStoreState> {
    if (state) return state

    const hadPersistedState = hasPersistedStorage(database) && !hasPendingChannelFallbackScrub(database)
    migrateLegacyTaskChannelState(database, repositories)
    const persisted = readPersistedState(repositories)
    if ((hasAnyPersistedData(persisted) || hadPersistedState) && !hasPendingChannelFallbackScrub(database)) {
      state = mergeAgentStoreSeeds(persisted, safeSeed)
      return state
    }

    const loadedLegacy = options.legacyStateLoader
      ? normalizeAgentStoreState(await options.legacyStateLoader())
      : createDefaultAgentPersistentState()
    // The reconciler has already persisted or quarantined the legacy Channel records.
    // Never let a stale fallback object repopulate Channel state after that boundary.
    const legacy = { ...loadedLegacy, channels: [] }
    const hydrated = mergeAgentStoreSeeds(legacy, safeSeed)
    const hasLegacyData = hasAnyPersistedData(legacy)
    if (hasAnyPersistedData(hydrated)) {
      writePersistedState(repositories, hydrated, {}, {
        includeTaskDefinitions: true,
        includeTaskRunLogs: true
      })
      if (hasLegacyData) {
        await archiveLegacyState(options.legacyStateArchiver, legacy)
      }
    }
    state = hydrated
    return state
  }

  function save(nextState: AgentStoreState, options: AgentPersistentWriteOptions = {}): AgentStoreState {
    const previousState = state
    const persistedState = options.taskRowsOnly || options.taskRunLogRowsOnly || options.channelTaskSubscriptionRowsOnly || options.channelRowsOnly
      ? nextState
      : withAuthoritativeTaskAndChannelState(repositories, nextState)

    if (options.activeSelectionRowOnly) {
      writeActiveSelectionOnly(repositories, persistedState)
      state = withAuthoritativeTaskAndChannelState(repositories, persistedState)
      return state
    }

    if (options.sessionPinRowsOnly) {
      writeSessionPinsOnly(repositories, persistedState)
      state = withAuthoritativeTaskAndChannelState(repositories, persistedState)
      return state
    }

    if (options.taskRowsOnly) {
      writeTasksOnly(repositories, previousState, persistedState)
      state = withAuthoritativeTaskAndChannelState(repositories, persistedState)
      return state
    }

    if (options.taskRunLogRowsOnly) {
      writeTaskRunLogsOnly(repositories, previousState, persistedState)
      state = withAuthoritativeTaskAndChannelState(repositories, persistedState)
      return state
    }

    if (options.channelRowsOnly) {
      writeChannelsOnly(repositories, previousState, persistedState)
      state = withAuthoritativeTaskAndChannelState(repositories, persistedState)
      return state
    }

    if (options.channelTaskSubscriptionRowsOnly) {
      writeChannelTaskSubscriptionsOnly(repositories, persistedState)
      state = withAuthoritativeTaskAndChannelState(repositories, persistedState)
      return state
    }

    writePersistedState(repositories, persistedState, options)
    state = withAuthoritativeTaskAndChannelState(repositories, persistedState)
    return state
  }

  function transactTaskAutomationMutation<T>(input: {
    mutate: (state: AgentStoreState) => { state: AgentStoreState; result: T; audit: TaskMutationAuditEntity }
    rejectedAudit: (state: AgentStoreState, error: unknown) => TaskMutationAuditEntity
  }): Promise<T> {
    return enqueueStateMutation(async () => {
      const current = await load()
      let mutation: ReturnType<typeof input.mutate>
      try {
        mutation = input.mutate(current)
      } catch (error) {
        database.transact(() => repositories.taskMutationAudits.insert(input.rejectedAudit(current, error)))
        throw error
      }

      database.transact(() => {
        writeTaskAutomationMutation(repositories, current, mutation.state)
        repositories.taskMutationAudits.insert(mutation.audit)
      })
      state = withAuthoritativeTaskAndChannelState(repositories, mutation.state)
      return mutation.result
    })
  }

  function transactTaskRunAdmission<T>(input: {
    mutate: (state: AgentStoreState) => { state: AgentStoreState; result: T; audit: TaskMutationAuditEntity; runLog: TaskRunLogEntity }
    rejectedAudit: (state: AgentStoreState, error: unknown) => TaskMutationAuditEntity
  }): Promise<T> {
    return enqueueStateMutation(async () => {
      const current = await load()
      let mutation: ReturnType<typeof input.mutate>
      try {
        mutation = input.mutate(current)
      } catch (error) {
        database.transact(() => repositories.taskMutationAudits.insert(input.rejectedAudit(current, error)))
        throw error
      }
      database.transact(() => {
        repositories.taskRunLogs.upsert(mutation.runLog)
        repositories.taskMutationAudits.insert(mutation.audit)
      })
      state = withAuthoritativeTaskAndChannelState(repositories, mutation.state)
      return mutation.result
    })
  }

  function transactTaskRunLogMutation<T>(input: {
    mutate: (state: AgentStoreState) => { state: AgentStoreState; result: T; runLog: TaskRunLogEntity | null }
  }): Promise<T> {
    return enqueueStateMutation(async () => {
      const current = await load()
      const mutation = input.mutate(current)
      if (mutation.runLog) {
        database.transact(() => repositories.taskRunLogs.upsert(mutation.runLog!))
      }
      state = withAuthoritativeTaskAndChannelState(repositories, mutation.state)
      return mutation.result
    })
  }

  function recordTaskMutationAudit(audit: TaskMutationAuditEntity): Promise<void> {
    return enqueueStateMutation(async () => {
      await load()
      database.transact(() => repositories.taskMutationAudits.insert(audit))
    })
  }

  function transactChannelDeletionMutation<T>(input: {
    channelId: string
    mutate: (state: AgentStoreState) => { state: AgentStoreState; result: T; audits: TaskMutationAuditEntity[] }
  }): Promise<T> {
    return enqueueStateMutation(async () => {
      const current = await load()
      const mutation = input.mutate(current)
      database.transact(() => {
        writeTaskAutomationMutation(repositories, current, mutation.state)
        for (const audit of mutation.audits) repositories.taskMutationAudits.insert(audit)
        repositories.channels.delete(input.channelId)
      })
      state = withAuthoritativeTaskAndChannelState(repositories, mutation.state)
      return mutation.result
    })
  }

  function upsertTaskRunLog(log: TaskRunLogEntity): Promise<TaskRunLogEntity> {
    return enqueueStateMutation(async () => {
      const current = await load()
      database.transact(() => repositories.taskRunLogs.upsert(log))
      const persisted = repositories.taskRunLogs.get(log.id)
      if (!persisted) throw new Error(`Task run log "${log.id}" was not persisted.`)
      state = withAuthoritativeTaskAndChannelState(repositories, current)
      return persisted
    })
  }

  function patchTaskRunLog(runLogId: string, patch: Partial<TaskRunLogEntity>): Promise<TaskRunLogEntity | null> {
    return enqueueStateMutation(async () => {
      const current = await load()
      const persisted = database.transact(() => repositories.taskRunLogs.patch(runLogId, patch))
      state = withAuthoritativeTaskAndChannelState(repositories, current)
      return persisted
    })
  }

  function recordRuntimeTaskRun(
    taskId: string,
    input: { startedAt: string; updatedAt: string }
  ): Promise<ScheduledTaskEntity | null> {
    return enqueueStateMutation(async () => {
      const current = await load()
      const persisted = database.transact(() => {
        const task = repositories.tasks.get(taskId)
        if (!task) return null
        repositories.tasks.upsert({
          ...task,
          lastRun: input.startedAt,
          nextRun: task.trigger.kind === 'once' ? null : task.nextRun,
          status: task.trigger.kind === 'once' ? 'completed' : task.status,
          updatedAt: input.updatedAt
        })
        return repositories.tasks.get(taskId)
      })
      state = withAuthoritativeTaskAndChannelState(repositories, current)
      return persisted
    })
  }

  function pauseTaskForFailureCircuit(taskId: string, updatedAt: string): Promise<ScheduledTaskEntity | null> {
    return enqueueStateMutation(async () => {
      const current = await load()
      const persisted = database.transact(() => {
        const task = repositories.tasks.get(taskId)
        if (!task || !task.enabled || task.status !== 'active') return task
        const next: ScheduledTaskEntity = {
          ...task,
          enabled: false,
          status: 'paused',
          pauseReason: 'failure-circuit',
          revision: (task.revision ?? 1) + 1,
          updatedAt
        }
        repositories.tasks.upsert(next)
        repositories.taskMutationAudits.insert({
          id: randomUUID(),
          taskId: next.id,
          agentId: next.agentId,
          taskNameSnapshot: next.name,
          action: 'runtime-transition',
          actor: { kind: 'runtime', source: 'failure-circuit' },
          requestHash: createHash('sha256').update(`failure-circuit:${next.id}:${next.revision}:${updatedAt}`).digest('hex'),
          resultRevision: next.revision ?? null,
          createdAt: updatedAt,
          outcome: 'accepted',
          errorCode: null
        })
        return repositories.tasks.get(taskId)
      })
      state = withAuthoritativeTaskAndChannelState(repositories, current)
      return persisted
    })
  }

  function enqueueStateMutation<T>(operation: () => Promise<T>): Promise<T> {
    const queued = stateMutationQueue.then(operation)
    stateMutationQueue = queued.then(() => undefined, () => undefined)
    return queued
  }

  return {
    getState: load,
    update: (updater, options) => enqueueStateMutation(async () => save(updater(await load()), options)),
    replace: (nextState, options) => enqueueStateMutation(async () => {
      await load()
      return save(nextState, options)
    }),
    transactTaskAutomationMutation,
    recordTaskMutationAudit,
    transactTaskRunAdmission,
    transactTaskRunLogMutation,
    transactChannelDeletionMutation,
    upsertTaskRunLog,
    patchTaskRunLog,
    recordRuntimeTaskRun,
    pauseTaskForFailureCircuit
  }
}

function migrateLegacyTaskChannelState(
  database: AgentPlatformDatabase,
  repositories: ReturnType<typeof createAgentPlatformRepositories>
): void {
  const legacyTasks = repositories.stateEntries.get<ScheduledTaskEntity[]>('tasks')
  const legacySubscriptions = repositories.stateEntries.get<AgentChannelTaskSubscription[]>('channelTaskSubscriptions')
  if (!legacyTasks && !legacySubscriptions) return

  database.transact(() => {
    const rowTaskIds = new Set(repositories.tasks.listAll().map((task) => task.id))
    for (const task of legacyTasks ?? []) {
      if (!rowTaskIds.has(task.id)) repositories.tasks.upsert(task)
    }

    for (const subscription of legacySubscriptions ?? []) {
      const task = repositories.tasks.get(subscription.taskId)
      if (task?.channelIds?.includes(subscription.channelId)) {
        repositories.channelTaskSubscriptions.upsert(subscription)
      }
    }

    repositories.stateEntries.delete('tasks')
    repositories.stateEntries.delete('channelTaskSubscriptions')
  })
}

async function archiveLegacyState(
  legacyStateArchiver: ((state: AgentStoreState) => Promise<void> | void) | undefined,
  legacy: AgentStoreState
): Promise<void> {
  if (!legacyStateArchiver) return

  try {
    await legacyStateArchiver(legacy)
  } catch {
    // SQLite is now authoritative; a failed best-effort archive must not break startup.
  }
}

function readPersistedState(repositories: ReturnType<typeof createAgentPlatformRepositories>): AgentStoreState {
  const workspaces = repositories.workspaces.listAll()
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  const activeSelection = repositories.activeSelection.get() ?? repositories.stateEntries.get<ActiveSelection>('activeSelection')

  return mergeAgentStoreSeeds(createDefaultAgentPersistentState(), {
    agents: repositories.agents.listAll(),
    sessions: repositories.sessions.listAll(workspacesById),
    workspaces,
    sessionPins: repositories.sessionPins.list(),
    messagesBySessionId: groupMessagesBySessionId(repositories.messages.listAll()),
    mcpServers: readRowLevelMcpServers(repositories),
    mcpToolsByServerId: readRowLevelMcpTools(repositories),
    mcpRuntimeStatusByServerId: readRowLevelMcpRuntimeStatus(repositories),
    channels: readRowLevelChannels(repositories),
    ...readRowLevelSkillsState(repositories),
    tasks: readRowLevelTasks(repositories),
    taskRunLogs: readRowLevelTaskRunLogs(repositories),
    channelTaskSubscriptions: readRowLevelChannelTaskSubscriptions(repositories),
    agentProductToolPackages: repositories.productToolPackageBindings.listAll(),
    activeAgentId: activeSelection?.activeAgentId ?? null,
    activeSessionId: activeSelection?.activeSessionId ?? null
  })
}

function writePersistedState(
  repositories: ReturnType<typeof createAgentPlatformRepositories>,
  state: AgentStoreState,
  options: AgentPersistentWriteOptions = {},
  historyOptions: { includeTaskDefinitions?: boolean; includeTaskRunLogs?: boolean; includeChannels?: boolean } = {}
): void {
  repositories.replaceAllState(
    {
      agents: state.agents,
      workspaces: state.workspaces,
      sessions: state.sessions,
      sessionPins: state.sessionPins,
      messages: flattenMessages(state.messagesBySessionId),
      platformStateCollections: {
        mcpServers: state.mcpServers,
        mcpToolsByServerId: state.mcpToolsByServerId,
        mcpRuntimeStatusByServerId: state.mcpRuntimeStatusByServerId,
        channels: state.channels,
        skills: state.skills,
        agentSkills: state.agentSkills,
        tasks: state.tasks,
        taskRunLogs: state.taskRunLogs,
        channelTaskSubscriptions: state.channelTaskSubscriptions,
        agentProductToolPackages: state.agentProductToolPackages ?? [],
        activeAgentId: state.activeAgentId,
        activeSessionId: state.activeSessionId
      }
    },
    {
      skipSkillRows: options.skipSkillRowMirror,
      writeTaskDefinitions: historyOptions.includeTaskDefinitions === true,
      writeTaskRunLogs: historyOptions.includeTaskRunLogs === true,
      writeChannels: historyOptions.includeChannels === true
    }
  )
}

function writeActiveSelectionOnly(
  repositories: ReturnType<typeof createAgentPlatformRepositories>,
  state: AgentStoreState
): void {
  repositories.activeSelection.set({
    activeAgentId: state.activeAgentId,
    activeSessionId: state.activeSessionId
  })
  repositories.stateEntries.set('activeSelection', {
    activeAgentId: state.activeAgentId,
    activeSessionId: state.activeSessionId
  })
}

function writeSessionPinsOnly(
  repositories: ReturnType<typeof createAgentPlatformRepositories>,
  state: AgentStoreState
): void {
  repositories.sessionPins.replaceAll(state.sessionPins)
}

function writeTasksOnly(
  repositories: ReturnType<typeof createAgentPlatformRepositories>,
  previousState: AgentStoreState | null,
  state: AgentStoreState
): void {
  const nextTaskIds = new Set(state.tasks.map((task) => task.id))
  for (const previousTask of previousState?.tasks ?? []) {
    if (!nextTaskIds.has(previousTask.id)) repositories.tasks.delete(previousTask.id)
  }
  for (const task of state.tasks) {
    repositories.tasks.upsert(task)
  }
  repositories.channelTaskSubscriptions.replaceAll(
    state.channelTaskSubscriptions.filter((subscription) => nextTaskIds.has(subscription.taskId))
  )
}

function writeTaskAutomationMutation(
  repositories: ReturnType<typeof createAgentPlatformRepositories>,
  previousState: AgentStoreState,
  nextState: AgentStoreState
): void {
  const previousTasksById = new Map(previousState.tasks.map((task) => [task.id, task]))
  const nextTasksById = new Map(nextState.tasks.map((task) => [task.id, task]))
  const taskIds = new Set([...previousTasksById.keys(), ...nextTasksById.keys()])

  for (const taskId of taskIds) {
    const previousTask = previousTasksById.get(taskId)
    const nextTask = nextTasksById.get(taskId)
    if (!nextTask) {
      if (previousTask) repositories.tasks.delete(taskId)
      continue
    }
    if (!previousTask || !sameJson(previousTask, nextTask)) {
      repositories.tasks.upsert(nextTask)
    }

    const previousSubscriptions = subscriptionsForTask(previousState, taskId)
    const nextSubscriptions = subscriptionsForTask(nextState, taskId)
    if (!sameJson(previousSubscriptions, nextSubscriptions)) {
      repositories.channelTaskSubscriptions.replaceForTask(taskId, nextSubscriptions.map((item) => item.channelId))
    }
  }
}

function subscriptionsForTask(state: AgentStoreState, taskId: string): AgentChannelTaskSubscription[] {
  return state.channelTaskSubscriptions
    .filter((subscription) => subscription.taskId === taskId)
    .sort((left, right) => left.channelId.localeCompare(right.channelId))
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function writeTaskRunLogsOnly(
  repositories: ReturnType<typeof createAgentPlatformRepositories>,
  previousState: AgentStoreState | null,
  state: AgentStoreState
): void {
  // Compatibility no-op: SQLite focused run writes use upsertTaskRunLog/patchTaskRunLog.
}

function withAuthoritativeTaskAndChannelState(
  repositories: ReturnType<typeof createAgentPlatformRepositories>,
  state: AgentStoreState
): AgentStoreState {
  return {
    ...state,
    channels: readRowLevelChannels(repositories),
    tasks: readRowLevelTasks(repositories),
    channelTaskSubscriptions: readRowLevelChannelTaskSubscriptions(repositories),
    taskRunLogs: readRowLevelTaskRunLogs(repositories)
  }
}

function writeChannelsOnly(
  repositories: ReturnType<typeof createAgentPlatformRepositories>,
  previousState: AgentStoreState | null,
  state: AgentStoreState
): void {
  void repositories
  void previousState
  void state
  throw new Error('channel-legacy-write-rejected')
}

function writeChannelTaskSubscriptionsOnly(
  repositories: ReturnType<typeof createAgentPlatformRepositories>,
  state: AgentStoreState
): void {
  // Task subscriptions are definition mutations. SQLite accepts them only through
  // TaskAutomationCommandService so revision and mutation audit remain atomic.
  void repositories
  void state
}

function flattenMessages(messagesBySessionId: Record<string, AgentSessionMessageEntity[]>): AgentSessionMessageEntity[] {
  return Object.values(messagesBySessionId).flat()
}

function groupMessagesBySessionId(
  messages: readonly AgentSessionMessageEntity[]
): Record<string, AgentSessionMessageEntity[]> {
  const grouped: Record<string, AgentSessionMessageEntity[]> = {}
  for (const message of messages) {
    grouped[message.sessionId] = [...(grouped[message.sessionId] ?? []), message]
  }
  return grouped
}

function readRowLevelTasks(repositories: ReturnType<typeof createAgentPlatformRepositories>): ScheduledTaskEntity[] {
  const tasks = repositories.tasks.listAll()
  return tasks.length > 0 ? tasks : repositories.stateEntries.get<ScheduledTaskEntity[]>('tasks') ?? []
}

function readRowLevelMcpServers(repositories: ReturnType<typeof createAgentPlatformRepositories>): McpServerEntity[] {
  const servers = repositories.mcpServers.listAll()
  return servers.length > 0 ? servers : repositories.stateEntries.get<McpServerEntity[]>('mcpServers') ?? []
}

function readRowLevelMcpTools(repositories: ReturnType<typeof createAgentPlatformRepositories>): McpToolsByServerId {
  const tools = repositories.mcpTools.listAll()
  return Object.keys(tools).length > 0 ? tools : repositories.stateEntries.get<McpToolsByServerId>('mcpToolsByServerId') ?? {}
}

function readRowLevelMcpRuntimeStatus(
  repositories: ReturnType<typeof createAgentPlatformRepositories>
): Record<string, McpRuntimeStatus> {
  const statuses = repositories.mcpRuntimeStatus.listAll()
  return Object.keys(statuses).length > 0
    ? statuses
    : repositories.stateEntries.get<Record<string, McpRuntimeStatus>>('mcpRuntimeStatusByServerId') ?? {}
}

function readRowLevelTaskRunLogs(repositories: ReturnType<typeof createAgentPlatformRepositories>): TaskRunLogEntity[] {
  const logs = repositories.taskRunLogs.listAll()
  return logs.length > 0 ? logs : repositories.stateEntries.get<TaskRunLogEntity[]>('taskRunLogs') ?? []
}

function readRowLevelChannels(repositories: ReturnType<typeof createAgentPlatformRepositories>): AgentChannelEntity[] {
  // C03 removes legacy channel rows before hydration. No state-entry fallback may reintroduce secrets.
  return repositories.channels.listAll()
}

function readRowLevelSkillsState(
  repositories: ReturnType<typeof createAgentPlatformRepositories>
): Pick<AgentStoreState, 'skills' | 'agentSkills'> {
  const skills = repositories.skills.listAll()
  const agentSkills = repositories.agentSkills.listAll()
  const hasRowLevelSkillState = skills.length > 0 || agentSkills.length > 0
  return {
    skills: hasRowLevelSkillState ? skills : repositories.stateEntries.get<InstalledSkill[]>('skills') ?? [],
    agentSkills: hasRowLevelSkillState
      ? agentSkills
      : repositories.stateEntries.get<AgentSkillBinding[]>('agentSkills') ?? []
  }
}

function readRowLevelChannelTaskSubscriptions(
  repositories: ReturnType<typeof createAgentPlatformRepositories>
): AgentChannelTaskSubscription[] {
  const subscriptions = repositories.channelTaskSubscriptions.listAll()
  return subscriptions.length > 0
    ? subscriptions
    : repositories.stateEntries.get<AgentChannelTaskSubscription[]>('channelTaskSubscriptions') ?? []
}

function hasAnyPersistedData(state: AgentStoreState): boolean {
  return (
    state.agents.length > 0 ||
    state.sessions.length > 0 ||
    state.workspaces.length > 0 ||
    state.sessionPins.length > 0 ||
    Object.values(state.messagesBySessionId).some((messages) => messages.length > 0) ||
    state.mcpServers.length > 0 ||
    Object.keys(state.mcpToolsByServerId).length > 0 ||
    Object.keys(state.mcpRuntimeStatusByServerId).length > 0 ||
    state.channels.length > 0 ||
    state.skills.length > 0 ||
    state.agentSkills.length > 0 ||
    (state.agentProductToolPackages ?? []).length > 0 ||
    state.tasks.length > 0 ||
    state.taskRunLogs.length > 0 ||
    state.channelTaskSubscriptions.length > 0 ||
    state.activeAgentId !== null ||
    state.activeSessionId !== null
  )
}

function hasPersistedStorage(database: AgentPlatformDatabase): boolean {
  for (const table of ['agent_entities', 'agent_sessions', 'agent_workspaces', 'agent_channels']) {
    if (database.connection.prepare(`select 1 from ${table} limit 1`).get()) return true
  }
  return Boolean(database.connection.prepare('select 1 from agent_platform_state_entries limit 1').get())
}

function hasPendingChannelFallbackScrub(database: AgentPlatformDatabase): boolean {
  const row = database.connection.prepare(
    "select value_json from agent_platform_state_entries where key = 'channel-fallback-scrub'"
  ).get() as { value_json?: string } | undefined
  if (!row?.value_json) return false
  try {
    return (JSON.parse(row.value_json) as { state?: string }).state === 'pending'
  } catch {
    return false
  }
}
