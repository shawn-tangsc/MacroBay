import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../../schemas/agentSchemas'
import type { AgentChannelEntity } from '../../schemas/channelSchemas'
import type { AgentSessionEntity } from '../../schemas/sessionSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '../../schemas/taskSchemas'
import type { AgentWorkspaceEntity } from '../../schemas/workspaceSchemas'
import { createAgentStoreState } from '../../store/agentStore'
import { materializeTaskTriggerTimezone, previewNextTaskRun } from './taskScheduleValidation'
import { buildAgentTaskSchedulerSnapshot } from './taskSchedulerPlanner'

const createdAt = '2026-01-01T10:00:00.000Z'

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Autonomous Agent',
  model: 'provider:model-a',
  modelName: 'Model A',
  configuration: { permission_mode: 'bypassPermissions' },
  createdAt,
  updatedAt: createdAt,
  orderKey: 'agent-1'
}

const guardedAgent: AgentEntity = {
  ...agent,
  configuration: { permission_mode: 'default' }
}

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: 'workspace-1',
  createdAt,
  updatedAt: createdAt
}

function createTask(overrides: Partial<ScheduledTaskEntity> = {}): ScheduledTaskEntity {
  return {
    id: 'task-default',
    agentId: agent.id,
    name: 'Task',
    prompt: 'Run',
    trigger: { kind: 'once', at: Date.UTC(2026, 0, 1, 10, 5, 0, 0) },
    timeoutMinutes: 2,
    workspace: { type: 'system' },
    channelIds: [],
    enabled: true,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    ...overrides
  }
}

function createChannel(overrides: Partial<AgentChannelEntity> = {}): AgentChannelEntity {
  return {
    id: 'channel-default',
    type: 'telegram',
    name: 'Telegram',
    agentId: agent.id,
    workspace: { type: 'system' },
    config: { bot_token: 'token' },
    isActive: true,
    createdAt,
    updatedAt: createdAt,
    ...overrides
  } as AgentChannelEntity
}

function createRunLog(overrides: Partial<TaskRunLogEntity> = {}): TaskRunLogEntity {
  return {
    id: 'run-default',
    scheduleId: 'task-default',
    startedAt: '2026-01-01T10:06:00.000Z',
    durationMs: 1000,
    status: 'completed',
    result: 'ok',
    ...overrides
  }
}

function createSession(overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity {
  return {
    id: 'session-default',
    agentId: agent.id,
    name: 'Session',
    workspaceId: workspace.id,
    workspace,
    orderKey: 'session-default',
    createdAt,
    updatedAt: createdAt,
    ...overrides
  }
}

describe('taskSchedulerPlanner', () => {
  it('treats a queued task run as non-due until the coordinator dispatches it', () => {
    const task = createTask({ id: 'task-queued', trigger: { kind: 'interval', ms: 300_000 } })
    const snapshot = buildAgentTaskSchedulerSnapshot(createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [task],
      taskRunLogs: [createRunLog({
        id: 'run-queued', scheduleId: task.id, agentId: agent.id, taskNameSnapshot: task.name,
        startedAt: '2026-01-01T10:30:00.000Z', durationMs: 0, status: 'queued'
      })]
    }), { now: '2026-01-01T10:30:00.000Z' })

    expect(snapshot.dueTaskIds).not.toContain(task.id)
    expect(snapshot.tasksById[task.id]).toMatchObject({ runtimeStatus: 'queued', isDue: false })
  })

  it('blocks malformed legacy trigger and persisted schedule fields without misclassifying exhausted once tasks', () => {
    const now = '2026-01-02T00:00:00.000Z'
    const invalid = [
      createTask({ trigger: { kind: 'once', at: 8_640_000_000_000_001 }, nextRun: '2026-01-03T00:00:00.000Z' }),
      createTask({ id: 'interval', trigger: { kind: 'interval', ms: Number.MAX_SAFE_INTEGER }, nextRun: '2026-01-03T00:00:00.000Z' }),
      createTask({ id: 'cron', trigger: { kind: 'cron', expr: '0 9 * * *', timezone: 'Bad/Zone' }, nextRun: '2026-01-03T00:00:00.000Z' }),
      createTask({ id: 'next-run', nextRun: 'not-a-date' }),
      createTask({ id: 'last-run', lastRun: 'not-a-date' })
    ]
    const snapshot = buildAgentTaskSchedulerSnapshot(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: invalid }), { now })
    for (const task of Object.values(snapshot.tasksById)) {
      if (task.executionKind !== 'scheduled') continue
      expect(task).toMatchObject({ isRunnable: false, isDue: false, runtimeStatus: 'paused', runtimeBlockReason: 'schedule-invalid', nextRunAt: null })
    }
    const exhausted = buildAgentTaskSchedulerSnapshot(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [createTask({ trigger: { kind: 'once', at: Date.UTC(2026, 0, 1, 9) }, catchUpPolicy: { kind: 'skip-missed' } })] }), { now, startupAt: now }).tasksById['task-default']
    expect(exhausted).toMatchObject({ exhausted: true, runtimeStatus: 'completed', runtimeBlockReason: null })
  })
  it('computes due tasks and next runs for once and interval triggers', () => {
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-once',
          name: 'Once task',
          trigger: { kind: 'once', at: Date.UTC(2026, 0, 1, 10, 5, 0, 0) }
        }),
        createTask({
          id: 'task-interval-created',
          name: 'Interval createdAt',
          trigger: { kind: 'interval', ms: 10 * 60 * 1000 }
        }),
        createTask({
          id: 'task-interval-last-run',
          name: 'Interval lastRun',
          trigger: { kind: 'interval', ms: 10 * 60 * 1000, anchor: 'lastRun' },
          lastRun: '2026-01-01T10:20:00.000Z'
        })
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:30:00.000Z'
    })

    expect(snapshot.dueTaskIds).toEqual([
      'task-once',
      'task-interval-created',
      'task-interval-last-run'
    ])
    expect(snapshot.tasksById['task-once']).toMatchObject({
      nextRunAt: '2026-01-01T10:05:00.000Z',
      isDue: true,
      exhausted: false
    })
    expect(snapshot.tasksById['task-interval-created']).toMatchObject({
      nextRunAt: '2026-01-01T10:10:00.000Z',
      isDue: true
    })
    expect(snapshot.tasksById['task-interval-last-run']).toMatchObject({
      lastRunAt: '2026-01-01T10:20:00.000Z',
      nextRunAt: '2026-01-01T10:30:00.000Z',
      isDue: true
    })
  })

  it('derives last-run state from run logs and excludes exhausted, paused, and disabled tasks', () => {
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-once-completed',
          trigger: { kind: 'once', at: Date.UTC(2026, 0, 1, 10, 5, 0, 0) }
        }),
        createTask({
          id: 'task-disabled',
          enabled: false,
          trigger: { kind: 'interval', ms: 60_000 }
        }),
        createTask({
          id: 'task-paused',
          status: 'paused',
          trigger: { kind: 'interval', ms: 60_000 }
        }),
        createTask({
          id: 'task-completed',
          status: 'completed',
          trigger: { kind: 'once', at: Date.UTC(2026, 0, 1, 10, 5, 0, 0) }
        })
      ],
      taskRunLogs: [
        createRunLog({
          id: 'run-once-completed',
          scheduleId: 'task-once-completed',
          startedAt: '2026-01-01T10:06:00.000Z'
        })
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:30:00.000Z'
    })

    expect(snapshot.dueTaskIds).toEqual([])
    expect(snapshot.tasksById['task-once-completed']).toMatchObject({
      lastRunAt: '2026-01-01T10:06:00.000Z',
      nextRunAt: null,
      isDue: false,
      exhausted: true
    })
    expect(snapshot.tasksById['task-disabled'].isRunnable).toBe(false)
    expect(snapshot.tasksById['task-paused'].isRunnable).toBe(false)
    expect(snapshot.tasksById['task-completed'].isRunnable).toBe(false)
  })

  it('computes cron next runs and channel linkage state for active subscriptions', () => {
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-cron',
          name: 'Cron task',
          trigger: { kind: 'cron', expr: '15 * * * *' },
          channelIds: ['channel-active', 'channel-inactive']
        })
      ],
      channels: [
        createChannel({ id: 'channel-active', isActive: true }),
        createChannel({ id: 'channel-inactive', isActive: false })
      ],
      channelTaskSubscriptions: [
        { channelId: 'channel-active', taskId: 'task-cron' },
        { channelId: 'channel-inactive', taskId: 'task-cron' }
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:20:00.000Z'
    })

    expect(snapshot.dueTaskIds).toEqual(['task-cron'])
    expect(snapshot.tasksById['task-cron']).toMatchObject({
      executionKind: 'scheduled',
      nextRunAt: '2026-01-01T10:15:00.000Z',
      isDue: true,
      subscribedChannelIds: ['channel-active', 'channel-inactive'],
      activeChannelIds: ['channel-active'],
      inactiveChannelIds: ['channel-inactive']
    })
  })

  it('computes cron next runs using the configured timezone', () => {
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-cron-timezone',
          name: 'Cron timezone task',
          trigger: { kind: 'cron', expr: '15 5 * * *', timezone: 'America/New_York' }
        })
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:20:00.000Z'
    })

    expect(snapshot.dueTaskIds).toEqual(['task-cron-timezone'])
    expect(snapshot.tasksById['task-cron-timezone']).toMatchObject({
      nextRunAt: '2026-01-01T10:15:00.000Z',
      isDue: true
    })
  })

  it('matches the shared preview after a default timezone is materialized into a Cron task', () => {
    const trigger = { kind: 'cron' as const, expr: '0 9 * * *' }
    const options = { now: new Date('2026-01-01T10:20:00.000Z'), defaultTimezone: 'Asia/Shanghai' }
    const materialized = materializeTaskTriggerTimezone(trigger, options)
    if (!materialized.ok) throw new Error('expected valid timezone')
    const preview = previewNextTaskRun({ trigger }, options)
    if (!preview.ok) throw new Error('expected valid schedule preview')
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [createTask({ id: 'task-default-timezone', trigger: materialized.trigger })]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, { now: options.now.toISOString() })

    expect(preview).toEqual({ ok: true, nextRunAt: '2026-01-02T01:00:00.000Z' })
    expect(snapshot.tasksById['task-default-timezone']?.nextRunAt).toBe(preview.nextRunAt)
  })

  it('skips missed cron startup recovery by advancing to the next future slot', () => {
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-cron-skip-missed',
          trigger: { kind: 'cron', expr: '*/5 * * * *' },
          catchUpPolicy: { kind: 'skip-missed' },
          createdAt: '2026-01-01T10:00:00.000Z',
          updatedAt: '2026-01-01T10:00:00.000Z'
        })
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:30:00.000Z',
      startupAt: '2026-01-01T10:30:00.000Z'
    })

    expect(snapshot.dueTaskIds).toEqual([])
    expect(snapshot.tasksById['task-cron-skip-missed']).toMatchObject({
      nextRunAt: '2026-01-01T10:35:00.000Z',
      isDue: false,
      runtimeStatus: 'idle'
    })
  })

  it('skips missed startup recovery for skip-missed interval tasks and advances to the next future slot', () => {
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-skip-missed',
          trigger: { kind: 'interval', ms: 10 * 60 * 1000 },
          catchUpPolicy: { kind: 'skip-missed' }
        })
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:30:00.000Z',
      startupAt: '2026-01-01T10:30:00.000Z'
    })

    expect(snapshot.dueTaskIds).toEqual([])
    expect(snapshot.tasksById['task-skip-missed']).toMatchObject({
      nextRunAt: '2026-01-01T10:40:00.000Z',
      isDue: false,
      exhausted: false,
      runtimeStatus: 'idle'
    })
  })

  it('recovers missed startup work once when after-startup is within the configured window', () => {
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-after-startup',
          trigger: { kind: 'once', at: Date.UTC(2026, 0, 1, 10, 25, 0, 0) },
          catchUpPolicy: { kind: 'after-startup', minutes: 10 }
        })
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:30:00.000Z',
      startupAt: '2026-01-01T10:30:00.000Z'
    })

    expect(snapshot.dueTaskIds).toEqual(['task-after-startup'])
    expect(snapshot.tasksById['task-after-startup']).toMatchObject({
      nextRunAt: '2026-01-01T10:25:00.000Z',
      isDue: true,
      exhausted: false,
      runtimeStatus: 'due'
    })
  })

  it('skips startup recovery beyond the after-startup window and exhausts missed once tasks', () => {
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-startup-window-expired',
          trigger: { kind: 'once', at: Date.UTC(2026, 0, 1, 10, 5, 0, 0) },
          catchUpPolicy: { kind: 'after-startup', minutes: 10 }
        })
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:30:00.000Z',
      startupAt: '2026-01-01T10:30:00.000Z'
    })

    expect(snapshot.dueTaskIds).toEqual([])
    expect(snapshot.tasksById['task-startup-window-expired']).toMatchObject({
      nextRunAt: null,
      isDue: false,
      exhausted: true,
      runtimeStatus: 'completed'
    })
  })

  it('does not mark tasks due while the latest persisted run is still running', () => {
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-running',
          trigger: { kind: 'interval', ms: 10 * 60 * 1000, anchor: 'lastRun' }
        })
      ],
      taskRunLogs: [
        createRunLog({
          id: 'run-running',
          scheduleId: 'task-running',
          startedAt: '2026-01-01T10:20:00.000Z',
          status: 'running',
          durationMs: 0
        })
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:30:00.000Z',
      startupAt: '2026-01-01T10:30:00.000Z'
    })

    expect(snapshot.dueTaskIds).toEqual([])
    expect(snapshot.tasksById['task-running']).toMatchObject({
      lastRunAt: '2026-01-01T10:20:00.000Z',
      nextRunAt: '2026-01-01T10:30:00.000Z',
      isDue: false,
      runtimeStatus: 'running'
    })
  })

  it('materializes one implicit heartbeat task from the preferred user workspace session', () => {
    const state = createAgentStoreState({
      agents: [
        {
          ...agent,
          updatedAt: '2026-01-01T10:01:00.000Z',
          configuration: {
            permission_mode: 'default',
            heartbeat_enabled: true,
            heartbeat_interval: 15
          }
        }
      ],
      workspaces: [workspace],
      sessions: [
        createSession({
          id: 'session-old',
          updatedAt: '2026-01-01T10:02:00.000Z'
        }),
        createSession({
          id: 'session-preferred',
          updatedAt: '2026-01-01T10:05:00.000Z'
        })
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:20:00.000Z'
    })

    expect(snapshot.dueTaskIds).toEqual(['heartbeat:agent-1:workspace-1'])
    expect(snapshot.tasksById['heartbeat:agent-1:workspace-1']).toMatchObject({
      executionKind: 'heartbeat',
      sourceTaskId: null,
      sourceSessionId: 'session-preferred',
      prompt: '__heartbeat__',
      workspace: { type: 'user', workspaceId: 'workspace-1' },
      nextRunAt: '2026-01-01T10:15:00.000Z',
      isDue: true,
      failureStreak: 0,
      circuitBroken: false
    })
  })

  it('pauses an implicit heartbeat task after three consecutive terminal failures', () => {
    const state = createAgentStoreState({
      agents: [
        {
          ...agent,
          updatedAt: '2026-01-01T10:01:00.000Z',
          configuration: {
            permission_mode: 'default',
            heartbeat_enabled: true,
            heartbeat_interval: 15
          }
        }
      ],
      workspaces: [workspace],
      sessions: [
        createSession({
          id: 'session-preferred',
          updatedAt: '2026-01-01T10:05:00.000Z'
        })
      ],
      taskRunLogs: [
        createRunLog({
          id: 'run-3',
          scheduleId: 'heartbeat:agent-1:workspace-1',
          startedAt: '2026-01-01T10:18:00.000Z',
          status: 'failed',
          error: 'third'
        }),
        createRunLog({
          id: 'run-2',
          scheduleId: 'heartbeat:agent-1:workspace-1',
          startedAt: '2026-01-01T10:12:00.000Z',
          status: 'failed',
          error: 'second'
        }),
        createRunLog({
          id: 'run-1',
          scheduleId: 'heartbeat:agent-1:workspace-1',
          startedAt: '2026-01-01T10:06:00.000Z',
          status: 'failed',
          error: 'first'
        })
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:20:00.000Z'
    })

    expect(snapshot.dueTaskIds).toEqual([])
    expect(snapshot.tasksById['heartbeat:agent-1:workspace-1']).toMatchObject({
      executionKind: 'heartbeat',
      isRunnable: false,
      isDue: false,
      runtimeStatus: 'paused',
      failureStreak: 3,
      circuitBroken: true
    })
  })

  it('ignores terminal failures before failureResetAt when deriving circuit breaker state', () => {
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-reset-circuit',
          trigger: { kind: 'interval', ms: 10 * 60 * 1000 },
          lastRun: '2026-01-01T10:00:00.000Z',
          failureResetAt: '2026-01-01T10:19:00.000Z'
        })
      ],
      taskRunLogs: [
        createRunLog({
          id: 'run-after-reset',
          scheduleId: 'task-reset-circuit',
          startedAt: '2026-01-01T10:20:00.000Z',
          status: 'failed'
        }),
        createRunLog({
          id: 'run-before-reset-2',
          scheduleId: 'task-reset-circuit',
          startedAt: '2026-01-01T10:10:00.000Z',
          status: 'failed'
        }),
        createRunLog({
          id: 'run-before-reset-1',
          scheduleId: 'task-reset-circuit',
          startedAt: '2026-01-01T10:05:00.000Z',
          status: 'failed'
        })
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:30:00.000Z'
    })

    expect(snapshot.tasksById['task-reset-circuit']).toMatchObject({
      failureStreak: 1,
      circuitBroken: false,
      isRunnable: true,
      isDue: true
    })
  })

  it('blocks explicit task dispatch when agent autonomy is disabled without mutating task status', () => {
    const state = createAgentStoreState({
      agents: [guardedAgent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-autonomy-disabled',
          trigger: { kind: 'once', at: Date.UTC(2026, 0, 1, 10, 5, 0, 0) },
          enabled: true,
          status: 'active'
        })
      ]
    })

    const snapshot = buildAgentTaskSchedulerSnapshot(state, {
      now: '2026-01-01T10:30:00.000Z'
    })

    expect(snapshot.dueTaskIds).toEqual([])
    expect(snapshot.tasksById['task-autonomy-disabled']).toMatchObject({
      status: 'active',
      enabled: true,
      isRunnable: false,
      isDue: false,
      runtimeStatus: 'paused',
      runtimeBlockReason: 'autonomy-disabled'
    })
  })
})
