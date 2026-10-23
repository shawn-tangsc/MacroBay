import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../../schemas/agentSchemas'
import type { AgentChannelEntity } from '../../schemas/channelSchemas'
import type { AgentSessionEntity } from '../../schemas/sessionSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '../../schemas/taskSchemas'
import type { TaskMutationAuditEntity } from './taskAutomationContracts'
import type { AgentWorkspaceEntity } from '../../schemas/workspaceSchemas'
import { createAgentStoreState, type AgentStoreState } from '../../store/agentStore'
import type { AgentPlatformStateStore } from '../../services'
import { TaskAutomationCommandError, TaskAutomationCommandService } from './TaskAutomationCommandService'

const createdAt = '2026-01-01T00:00:00.000Z'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1', name: 'Workspace', path: '/tmp/workspace', type: 'user', orderKey: '1', createdAt, updatedAt: createdAt
}

const agent: AgentEntity = {
  id: 'agent-1', type: 'claude-code', name: 'Agent', model: 'provider:model', modelName: 'Model',
  configuration: { permission_mode: 'bypassPermissions' }, orderKey: '1', createdAt, updatedAt: createdAt
}

const otherAgent: AgentEntity = { ...agent, id: 'agent-2', name: 'Other agent', orderKey: '2' }

function createStore(initial: AgentStoreState): AgentPlatformStateStore {
  let state = initial
  return {
    getState: async () => state,
    update: async (updater) => (state = updater(state)),
    replace: async (next) => (state = next)
  }
}

function task(overrides: Partial<ScheduledTaskEntity> = {}): ScheduledTaskEntity {
  return {
    id: 'task-1', agentId: agent.id, name: 'Task', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60 * 1000 },
    timeoutMinutes: 2, workspace: { type: 'system' }, channelIds: [], enabled: true, status: 'active', revision: 3,
    pauseReason: null, failureResetAt: null, provenance: { createdBy: 'user' }, createdAt, updatedAt: createdAt, ...overrides
  }
}

function channel(overrides: Partial<AgentChannelEntity> = {}): AgentChannelEntity {
  return {
    id: 'channel-1', type: 'telegram', name: 'Channel', agentId: agent.id, workspace: { type: 'system' },
    config: { bot_token: 'token' }, isActive: true, createdAt, updatedAt: createdAt, ...overrides
  } as AgentChannelEntity
}

function createService(state: AgentStoreState) {
  return new TaskAutomationCommandService({
    store: createStore(state),
    now: () => new Date('2026-01-01T10:30:00.000Z'),
    defaultTimezone: 'Asia/Shanghai',
    getPolicyPreset: async () => 'balanced'
  })
}

describe('TaskAutomationCommandService', () => {
  it('rejects manual run-now after the per-Agent hourly start budget without creating a queued run', async () => {
    const now = '2026-01-01T10:30:00.000Z'
    const taskEntity = task()
    const previousRuns: TaskRunLogEntity[] = Array.from({ length: 60 }, (_, index) => ({
      id: `prior-run-${index}`,
      scheduleId: `prior-task-${index}`,
      agentId: agent.id,
      startedAt: now,
      durationMs: 1,
      status: 'completed'
    }))
    const store = createStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [taskEntity], taskRunLogs: previousRuns }))
    const service = new TaskAutomationCommandService({
      store,
      now: () => new Date(now),
      defaultTimezone: 'UTC',
      getPolicyPreset: async () => 'balanced'
    })

    await expect(service.admitRunNow({
      agentId: agent.id,
      taskId: taskEntity.id,
      expectedRevision: taskEntity.revision ?? 1,
      now
    })).rejects.toMatchObject({ code: 'task-policy-limit' })
    expect((await store.getState()).taskRunLogs).toHaveLength(60)
  })

  it('creates an autonomous Agent task with default timezone materialized and user provenance', async () => {
    const service = createService(createAgentStoreState({ agents: [agent], workspaces: [workspace] }))

    const result = await service.execute({
      type: 'create', actor: { kind: 'user', source: 'renderer-agent-drawer' }, agentId: agent.id,
      task: { name: 'Daily report', prompt: 'Date: {date}', trigger: { kind: 'cron', expr: '0 9 * * *' }, workspace: { type: 'system' } }
    })

    expect(result.task).toMatchObject({
      trigger: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' },
      provenance: { createdBy: 'user' }, revision: 1
    })
    expect(result.nextRun).toBe('2026-01-02T01:00:00.000Z')
  })

  it('rejects non-autonomous Agents and foreign channels before mutation', async () => {
    const guarded = { ...agent, configuration: { permission_mode: 'default' as const } }
    const service = createService(createAgentStoreState({ agents: [guarded, otherAgent], workspaces: [workspace], channels: [channel({ agentId: agent.id })] }))

    await expect(service.execute({
      type: 'create', actor: { kind: 'user', source: 'renderer-settings' }, agentId: guarded.id,
      task: { name: 'Blocked', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60 * 1000 }, workspace: { type: 'system' } }
    })).rejects.toMatchObject({ code: 'task-autonomy-required' })

    await expect(service.execute({
      type: 'create', actor: { kind: 'user', source: 'renderer-settings' }, agentId: otherAgent.id,
      task: { name: 'Foreign channel', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60 * 1000 }, workspace: { type: 'system' }, channelIds: ['channel-1'] }
    })).rejects.toMatchObject({ code: 'task-channel-ineligible' })
  })

  it('enforces policy limits and revision ownership before task updates', async () => {
    const cappedTasks = Array.from({ length: 30 }, (_, index) => task({ id: `task-${index}` }))
    const service = createService(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: cappedTasks }))

    await expect(service.execute({
      type: 'create', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id,
      task: { name: 'Over cap', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60 * 1000 }, timeoutMinutes: 121, workspace: { type: 'system' } }
    })).rejects.toMatchObject({ code: 'task-policy-limit' })

    await expect(service.execute({
      type: 'update', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id, taskId: 'task-0', expectedRevision: 2,
      patch: { name: 'Stale' }
    })).rejects.toMatchObject({ code: 'task-revision-conflict' })
  })

  it('verifies Agent actor session ownership and writes Agent provenance', async () => {
    const session: AgentSessionEntity = {
      id: 'session-1', agentId: agent.id, name: 'Session', workspaceId: workspace.id, workspace, orderKey: '1', createdAt, updatedAt: createdAt
    }
    const service = createService(createAgentStoreState({ agents: [agent, otherAgent], sessions: [session], workspaces: [workspace] }))
    const result = await service.execute({
      type: 'create', actor: { kind: 'agent', agentId: agent.id, sessionId: session.id, toolCallId: 'tool-1' }, agentId: agent.id,
      task: { name: 'Agent created', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60 * 1000 }, workspace: { type: 'system' } }
    })

    expect(result.task?.provenance).toEqual({ createdBy: 'agent', createdAgentSessionId: session.id, createdToolCallId: 'tool-1' })
    await expect(service.execute({
      type: 'create', actor: { kind: 'agent', agentId: otherAgent.id, sessionId: session.id, toolCallId: 'tool-2' }, agentId: otherAgent.id,
      task: { name: 'Denied', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60 * 1000 }, workspace: { type: 'system' } }
    })).rejects.toMatchObject({ code: 'task-ownership-denied' })
  })

  it('rejects completed task updates without changing it', async () => {
    const completed = task({ enabled: false, status: 'completed' })
    const store = createStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [completed] }))
    const service = new TaskAutomationCommandService({ store, now: () => new Date('2026-01-01T10:30:00.000Z'), defaultTimezone: 'UTC', getPolicyPreset: async () => 'balanced' })

    await expect(service.execute({ type: 'resume', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id, taskId: completed.id, expectedRevision: 3 })).rejects.toMatchObject({ code: 'task-completed' })
    await expect(service.execute({ type: 'update', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id, taskId: completed.id, expectedRevision: 3, patch: { name: 'Cannot rename' } })).rejects.toMatchObject({ code: 'task-completed' })
    expect((await store.getState()).tasks[0]).toEqual(completed)
  })

  it('allows completed task deletion while retaining its immutable run history', async () => {
    const completed = task({ enabled: false, status: 'completed' })
    const store = createStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [completed],
        channelTaskSubscriptions: [{ channelId: 'channel-1', taskId: completed.id }],
        taskRunLogs: [{ id: 'run-completed', scheduleId: completed.id, startedAt: createdAt, durationMs: 1, status: 'completed' }]
      })
    )
    const service = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'balanced' })

    await expect(
      service.execute({
        type: 'delete', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id, taskId: completed.id, expectedRevision: 3
      })
    ).resolves.toMatchObject({ task: null })
    expect((await store.getState()).tasks).toEqual([])
    expect((await store.getState()).channelTaskSubscriptions).toEqual([])
    expect((await store.getState()).taskRunLogs).toHaveLength(1)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid timeout %p for create and update',
    async (timeoutMinutes) => {
      const createStoreState = createStore(createAgentStoreState({ agents: [agent], workspaces: [workspace] }))
      const createService = new TaskAutomationCommandService({ store: createStoreState, getPolicyPreset: async () => 'balanced' })
      await expect(
        createService.execute({
          type: 'create', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id,
          task: { name: 'Invalid create', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60 * 1000 }, timeoutMinutes, workspace: { type: 'system' } }
        })
      ).rejects.toMatchObject({ code: 'task-policy-limit' })

      const existing = task()
      const updateStoreState = createStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [existing] }))
      const updateService = new TaskAutomationCommandService({ store: updateStoreState, getPolicyPreset: async () => 'balanced' })
      await expect(
        updateService.execute({
          type: 'update', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id, taskId: existing.id, expectedRevision: 3,
          patch: { timeoutMinutes }
        })
      ).rejects.toMatchObject({ code: 'task-policy-limit' })
    }
  )

  it('rejects invalid once schedules on create and update without mutating state', async () => {
    const createStoreState = createStore(createAgentStoreState({ agents: [agent], workspaces: [workspace] }))
    const createService = new TaskAutomationCommandService({
      store: createStoreState,
      now: () => new Date('2026-01-02T00:00:00.000Z'),
      getPolicyPreset: async () => 'balanced'
    })
    await expect(
      createService.execute({
        type: 'create', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id,
        task: {
          name: 'Invalid once', prompt: 'Run', trigger: { kind: 'once', at: Date.parse('2026-01-01T00:00:00.000Z') },
          workspace: { type: 'system' }
        }
      })
    ).rejects.toMatchObject({ code: 'task-schedule-invalid' })
    expect((await createStoreState.getState()).tasks).toHaveLength(0)

    const existing = task()
    const updateStoreState = createStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [existing] }))
    const updateService = new TaskAutomationCommandService({
      store: updateStoreState,
      now: () => new Date('2026-01-02T00:00:00.000Z'),
      getPolicyPreset: async () => 'balanced'
    })
    await expect(
      updateService.execute({
        type: 'update', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id,
        taskId: existing.id, expectedRevision: existing.revision ?? 1,
        patch: { trigger: { kind: 'once', at: Date.parse('2026-01-01T00:00:00.000Z') } }
      })
    ).rejects.toMatchObject({ code: 'task-schedule-invalid' })
    expect((await updateStoreState.getState()).tasks).toEqual([existing])
  })

  it('admits a valid active task even when it is not due, but rejects malformed legacy schedules', async () => {
    const futureTask = task({ trigger: { kind: 'once', at: Date.parse('2026-01-01T11:30:00.000Z') } })
    const futureStore = createStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [futureTask] }))
    const futureService = new TaskAutomationCommandService({
      store: futureStore,
      now: () => new Date('2026-01-01T10:30:00.000Z'),
      getPolicyPreset: async () => 'balanced'
    })
    await expect(
      futureService.admitRunNow({
        agentId: agent.id, taskId: futureTask.id, expectedRevision: futureTask.revision ?? 1,
        now: '2026-01-01T10:30:00.000Z'
      })
    ).resolves.toMatchObject({ task: { taskId: futureTask.id }, runLog: { status: 'queued' } })

    const malformedTask = task({ trigger: { kind: 'once', at: Number.MAX_SAFE_INTEGER } })
    const malformedStore = createStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [malformedTask] }))
    const malformedService = new TaskAutomationCommandService({
      store: malformedStore,
      now: () => new Date('2026-01-01T10:30:00.000Z'),
      getPolicyPreset: async () => 'balanced'
    })
    await expect(
      malformedService.admitRunNow({
        agentId: agent.id, taskId: malformedTask.id, expectedRevision: malformedTask.revision ?? 1,
        now: '2026-01-01T10:30:00.000Z'
      })
    ).rejects.toMatchObject({ code: 'task-not-runnable' })
    expect((await malformedStore.getState()).taskRunLogs).toHaveLength(0)
  })

  it('records cancel-run outcomes only after host cancellation and isolates rejected callers', async () => {
    const session: AgentSessionEntity = {
      id: 'session-1', agentId: agent.id, name: 'Session', workspaceId: workspace.id, workspace,
      orderKey: '1', createdAt, updatedAt: createdAt
    }
    const activeRun: TaskRunLogEntity = {
      id: 'run-1', scheduleId: 'task-1', agentId: agent.id, startedAt: createdAt, durationMs: 0, status: 'running'
    }
    let state = createAgentStoreState({
      agents: [agent, otherAgent], sessions: [session], workspaces: [workspace], tasks: [task()], taskRunLogs: [activeRun]
    })
    const audits: TaskMutationAuditEntity[] = []
    const store: AgentPlatformStateStore = {
      getState: async () => state,
      update: async (updater) => (state = updater(state)),
      replace: async (next) => (state = next),
      transactTaskAutomationMutation: async ({ mutate, rejectedAudit }) => {
        try {
          const mutation = mutate(state)
          state = mutation.state
          audits.push(mutation.audit)
          return mutation.result
        } catch (error) {
          audits.push(rejectedAudit(state, error))
          throw error
        }
      },
      recordTaskMutationAudit: async (audit) => {
        audits.push(audit)
      }
    }
    const service = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'balanced' })
    const actor = { kind: 'agent' as const, agentId: agent.id, sessionId: session.id, toolCallId: 'tool-cancel-1' }

    const prepared = await service.prepareCancelRun({
      actor, agentId: agent.id, taskId: 'task-1', runLogId: 'run-1', expectedRevision: 3
    })
    expect(audits).toEqual([])

    await service.recordCancelRunOutcome(prepared, { outcome: 'accepted' })
    expect(audits[0]).toMatchObject({
      action: 'cancel-run', taskId: 'task-1', taskNameSnapshot: 'Task', resultRevision: 3,
      outcome: 'accepted', actor
    })

    await expect(service.prepareCancelRun({
      actor: { ...actor, agentId: otherAgent.id, toolCallId: 'tool-cancel-foreign' },
      agentId: otherAgent.id, taskId: 'task-1', runLogId: 'run-1', expectedRevision: 3
    })).rejects.toMatchObject({ code: 'task-ownership-denied' })
    expect(audits[1]).toMatchObject({
      action: 'cancel-run', agentId: otherAgent.id, taskId: null, taskNameSnapshot: null,
      outcome: 'rejected', errorCode: 'task-ownership-denied'
    })
  })

  it('allows an explicit pause without autonomy or current policy eligibility', async () => {
    const guardedAgent = { ...agent, configuration: { permission_mode: 'default' as const } }
    const legacyTask = task({
      timeoutMinutes: 121,
      trigger: { kind: 'interval', ms: 60_000 }
    })
    const store = createStore(createAgentStoreState({ agents: [guardedAgent], workspaces: [workspace], tasks: [legacyTask] }))
    const service = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'conservative' })

    await expect(
      service.execute({
        type: 'update', actor: { kind: 'user', source: 'renderer-settings' }, agentId: guardedAgent.id, taskId: legacyTask.id, expectedRevision: 3,
        patch: { enabled: false }
      })
    ).resolves.toMatchObject({ task: { enabled: false, status: 'paused', revision: 4 } })
    await expect(
      service.execute({
        type: 'resume', actor: { kind: 'user', source: 'renderer-settings' }, agentId: guardedAgent.id, taskId: legacyTask.id, expectedRevision: 4
      })
    ).rejects.toMatchObject({ code: 'task-autonomy-required' })
  })

  it('rejects resume when the current conservative active-task cap is already reached', async () => {
    const paused = task({ id: 'task-paused', enabled: false, status: 'paused', pauseReason: 'user', revision: 3 })
    const activeTasks = Array.from({ length: 10 }, (_, index) => task({ id: `task-active-${index}`, revision: 1 }))
    const store = createStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [paused, ...activeTasks] }))
    const service = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'conservative' })

    await expect(
      service.execute({
        type: 'resume', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id, taskId: paused.id, expectedRevision: 3
      })
    ).rejects.toMatchObject({ code: 'task-policy-limit' })
  })

  it('rejects missing user workspaces on create and workspace update without mutating', async () => {
    const store = createStore(createAgentStoreState({ agents: [agent], workspaces: [workspace] }))
    const service = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'balanced' })
    await expect(
      service.execute({
        type: 'create', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id,
        task: { name: 'Missing workspace', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60 * 1000 }, workspace: { type: 'user', workspaceId: 'missing' } }
      })
    ).rejects.toMatchObject({ code: 'task-not-found' })
    expect((await store.getState()).tasks).toEqual([])

    const existing = task()
    await store.replace(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [existing] }))
    await expect(
      service.execute({
        type: 'update', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id, taskId: existing.id, expectedRevision: 3,
        patch: { workspace: { type: 'user', workspaceId: 'missing' } }
      })
    ).rejects.toMatchObject({ code: 'task-not-found' })
    expect((await store.getState()).tasks[0]).toEqual(existing)
  })

  it('requires autonomy for run-now without mutating task state', async () => {
    const guardedAgent = { ...agent, configuration: { permission_mode: 'default' as const } }
    const activeTask = task()
    const guardedStore = createStore(createAgentStoreState({ agents: [guardedAgent], workspaces: [workspace], tasks: [activeTask] }))
    const guardedService = new TaskAutomationCommandService({ store: guardedStore, getPolicyPreset: async () => 'balanced' })

    await expect(
      guardedService.execute({
        type: 'run-now', actor: { kind: 'user', source: 'renderer-settings' }, agentId: guardedAgent.id, taskId: activeTask.id, expectedRevision: 3
      })
    ).rejects.toMatchObject({ code: 'task-autonomy-required' })
    expect(await guardedStore.getState()).toEqual(createAgentStoreState({ agents: [guardedAgent], workspaces: [workspace], tasks: [activeTask] }))

    const autonomousStore = createStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [activeTask] }))
    const autonomousService = new TaskAutomationCommandService({ store: autonomousStore, getPolicyPreset: async () => 'balanced' })
    await expect(
      autonomousService.execute({
        type: 'run-now', actor: { kind: 'user', source: 'renderer-settings' }, agentId: agent.id, taskId: activeTask.id, expectedRevision: 3
      })
    ).rejects.toMatchObject({ code: 'task-not-runnable' })
  })

  it('uses typed command errors', () => {
    expect(new TaskAutomationCommandError('task-not-found')).toMatchObject({ code: 'task-not-found' })
  })
})
