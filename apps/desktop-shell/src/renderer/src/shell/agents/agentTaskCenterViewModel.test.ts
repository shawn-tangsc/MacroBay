import { describe, expect, it } from 'vitest'

import type { ScheduledTaskEntity, TaskRunLogEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { JobRunRecord } from '@platform/jobs'
import type { AgentText } from './agentText'

import {
  buildAgentTaskCenterState,
  buildAgentTaskDraftFromTask,
  buildTaskDeliveryAttemptRequest,
  buildTaskRunRefreshQuery,
  mergeTaskDeliveryRun,
  buildTaskTriggerFromDraft,
  buildCreateTaskDtoFromDraft,
  buildDefaultAgentTaskDraft,
  buildTaskJobQuery,
  buildUpdateTaskRequestFromDraft,
  buildUpdateTaskDtoFromDraft,
  formatTaskTrigger,
  resolveTaskWorkspaceSource,
  type AgentTaskDraft
} from './agentTaskCenterViewModel'

describe('agentTaskCenterViewModel', () => {
  it('sorts tasks and combines task logs with matching platform job runs', () => {
    const completed = taskFixture({
      id: 'task-completed',
      name: 'Completed task',
      nextRun: '2026-07-09T08:00:00.000Z',
      updatedAt: '2026-07-09T01:00:00.000Z'
    })
    const running = taskFixture({
      id: 'task-running',
      name: 'Running task',
      nextRun: '2026-07-09T07:00:00.000Z',
      updatedAt: '2026-07-09T02:00:00.000Z'
    })
    const logsByTaskId = {
      [completed.id]: [
        logFixture({
          id: 'run-completed',
          scheduleId: completed.id,
          startedAt: '2026-07-09T01:30:00.000Z',
          status: 'completed',
          resultPreview: 'Finished summary'
        })
      ],
      [running.id]: [
        logFixture({
          id: 'run-running',
          scheduleId: running.id,
          startedAt: '2026-07-09T02:30:00.000Z',
          status: 'running'
        })
      ]
    }
    const jobsByRunLogId = {
      'run-running': jobFixture({
        id: 'job-running',
        status: 'running',
        payload: { taskId: running.id, runLogId: 'run-running' },
        progress: { current: 1, total: 3, message: 'Dispatching task' },
        logs: [{ at: '2026-07-09T02:31:00.000Z', level: 'info', message: 'Queued runtime turn.' }]
      })
    }

    const state = buildAgentTaskCenterState({
      tasks: [completed, running],
      logsByTaskId,
      jobsByRunLogId,
      labels: taskCenterLabels,
      nowIso: '2026-07-09T03:00:00.000Z'
    })

    expect(state.items.map((item) => item.task.id)).toEqual(['task-running', 'task-completed'])
    expect(state.items[0]).toMatchObject({
      runtimeStatus: 'running',
      latestRunLogId: 'run-running',
      latestJobRunId: 'job-running',
      latestOutput: 'Dispatching task'
    })
    expect(state.items[1]).toMatchObject({
      runtimeStatus: 'completed',
      latestRunLogId: 'run-completed',
      latestJobRunId: null,
      latestOutput: 'Finished summary'
    })
  })

  it('treats queued runs as in-flight and reads preview-only task output', () => {
    const queued = taskFixture({
      id: 'task-queued',
      nextRun: '2026-07-09T01:00:00.000Z'
    })
    const state = buildAgentTaskCenterState({
      tasks: [queued],
      logsByTaskId: {
        [queued.id]: [logFixture({
          id: 'run-queued', scheduleId: queued.id, startedAt: '2026-07-09T01:01:00.000Z', status: 'queued', resultPreview: 'Waiting to run'
        })]
      },
      jobsByRunLogId: {},
      labels: taskCenterLabels,
      nowIso: '2026-07-09T02:00:00.000Z'
    })

    expect(state.items[0]).toMatchObject({
      runtimeStatus: 'queued',
      latestOutput: 'Waiting to run',
      isRunning: true,
      isOverdue: false
    })
  })

  it('builds safe task create and update DTOs from a form draft', () => {
    const draft: AgentTaskDraft = {
      expectedRevision: 4,
      name: '  Daily note  ',
      prompt: '  Summarize the workspace state.  ',
      triggerKind: 'interval',
      intervalMinutes: 15,
      onceAt: '',
      cronExpr: '',
      timezone: '',
      timeoutMinutes: 20,
      workspace: { type: 'user', workspaceId: 'workspace-1' },
      channelIds: ['channel-1', '', 'channel-1'],
      enabled: true
    }

    expect(buildCreateTaskDtoFromDraft(draft)).toEqual({
      ok: true,
      dto: {
        name: 'Daily note',
        prompt: 'Summarize the workspace state.',
        trigger: { kind: 'interval', ms: 900000, anchor: 'lastRun' },
        catchUpPolicy: { kind: 'skip-missed' },
        workspace: { type: 'user', workspaceId: 'workspace-1' },
        timeoutMinutes: 20,
        channelIds: ['channel-1']
      }
    })
    expect(buildUpdateTaskDtoFromDraft({ ...draft, enabled: false })).toEqual({
      ok: true,
      dto: {
        name: 'Daily note',
        prompt: 'Summarize the workspace state.',
        trigger: { kind: 'interval', ms: 900000, anchor: 'lastRun' },
        catchUpPolicy: { kind: 'skip-missed' },
        workspace: { type: 'user', workspaceId: 'workspace-1' },
        timeoutMinutes: 20,
        channelIds: ['channel-1'],
        enabled: false
      }
    })
  })

  it('keeps draft revision fixed across refresh and submits the captured revision', () => {
    const original = taskFixture({ revision: 4, name: 'Original' })
    const refreshed = { ...original, revision: 5, name: 'Background update' }
    const draft = buildAgentTaskDraftFromTask(original)

    expect(buildAgentTaskDraftFromTask(original).expectedRevision).toBe(4)
    expect(buildAgentTaskDraftFromTask(refreshed).expectedRevision).toBe(5)
    expect(buildUpdateTaskRequestFromDraft({ ...draft, name: 'Edited while stale' })).toEqual({
      ok: true,
      request: {
        expectedRevision: 4,
        patch: expect.objectContaining({ name: 'Edited while stale' })
      }
    })
    const savedDraft = buildAgentTaskDraftFromTask({ ...original, revision: 5 })
    expect(buildUpdateTaskRequestFromDraft({ ...savedDraft, name: 'Next edit' })).toMatchObject({
      ok: true,
      request: { expectedRevision: 5 }
    })
    expect(buildDefaultAgentTaskDraft({ type: 'system' }).expectedRevision).toBeNull()
  })

  it('keeps an explicit empty selection so the drawer can stay in create mode', () => {
    const task = taskFixture({ id: 'task-1', name: 'Existing task' })

    const state = buildAgentTaskCenterState({
      tasks: [task],
      logsByTaskId: {},
      jobsByRunLogId: {},
      labels: taskCenterLabels,
      selectedTaskId: null
    })

    expect(state.selectedTaskId).toBeNull()
    expect(state.selectedTask).toBeNull()
    expect(state.selectedLogs).toEqual([])
  })

  it('resolves the task workspace source from the active session workspace entity', () => {
    expect(
      resolveTaskWorkspaceSource({
        workspaceId: 'workspace-system',
        workspace: {
          id: 'workspace-system',
          name: 'System Workspace',
          path: '/tmp/system',
          type: 'system',
          orderKey: 'a',
          createdAt: '2026-07-09T00:00:00.000Z',
          updatedAt: '2026-07-09T00:00:00.000Z'
        }
      })
    ).toEqual({ type: 'system' })
    expect(
      resolveTaskWorkspaceSource({
        workspaceId: 'workspace-user',
        workspace: {
          id: 'workspace-user',
          name: 'Project',
          path: '/project',
          type: 'user',
          orderKey: 'b',
          createdAt: '2026-07-09T00:00:00.000Z',
          updatedAt: '2026-07-09T00:00:00.000Z'
        }
      })
    ).toEqual({ type: 'user', workspaceId: 'workspace-user' })
  })

  it('rejects invalid drafts before they reach task IPC', () => {
    expect(
      buildCreateTaskDtoFromDraft({
        ...buildDefaultAgentTaskDraft({ type: 'system' }),
        name: '',
        prompt: 'Run something'
      })
    ).toEqual({ ok: false, reason: 'name-required' })

    expect(
      buildCreateTaskDtoFromDraft({
        ...buildDefaultAgentTaskDraft({ type: 'system' }),
        name: 'One shot',
        prompt: 'Run something',
        triggerKind: 'once',
        onceAt: 'not-a-date'
      })
    ).toEqual({ ok: false, reason: 'once-at-invalid' })

    expect(
      buildCreateTaskDtoFromDraft({
        ...buildDefaultAgentTaskDraft({ type: 'system' }),
        name: 'Cron',
        prompt: 'Run something',
        triggerKind: 'cron',
        cronExpr: ''
      })
    ).toEqual({ ok: false, reason: 'cron-required' })
  })

  it('builds a schedule preview trigger without requiring a complete task form', () => {
    const draft = buildDefaultAgentTaskDraft({ type: 'system' })

    expect(buildTaskTriggerFromDraft({ ...draft, triggerKind: 'cron', cronExpr: '0 9 * * *', timezone: 'Asia/Shanghai' })).toEqual({
      ok: true,
      trigger: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' }
    })
    expect(buildTaskTriggerFromDraft({ ...draft, triggerKind: 'once', onceAt: 'not-a-date' })).toEqual({
      ok: false,
      reason: 'once-at-invalid'
    })
  })

  it('keeps delivery attempts and retries scoped to a user-selected historical run', () => {
    const latest = logFixture({ id: 'run-latest', startedAt: '2026-07-17T10:00:00.000Z', status: 'completed' })
    const older = logFixture({ id: 'run-older', startedAt: '2026-07-16T10:00:00.000Z', status: 'completed' })

    expect(buildTaskDeliveryAttemptRequest([latest, older], null, 0)).toEqual({ runLogId: 'run-latest', offset: 0 })
    expect(buildTaskDeliveryAttemptRequest([latest, older], 'run-older', 20)).toEqual({ runLogId: 'run-older', offset: 20 })
    expect(buildTaskDeliveryAttemptRequest([latest, older], 'missing-run', 0)).toEqual({ runLogId: 'run-latest', offset: 0 })
    expect(buildTaskDeliveryAttemptRequest([], 'run-older', 0)).toBeNull()
    expect(buildTaskRunRefreshQuery([latest, older], 'run-older')).toEqual({ limit: 1, offset: 1 })
    expect(buildTaskRunRefreshQuery([latest, older], 'missing-run')).toBeNull()
  })

  it('keeps a selected run beyond the first log page after its delivery retry refreshes the durable summary', () => {
    const latest = logFixture({
      id: 'run-latest',
      startedAt: '2026-07-17T10:00:00.000Z',
      status: 'completed',
      deliverySummary: { delivered: 1, failed: 0, skipped: 0, unknown: 0 }
    })
    const historical = Array.from({ length: 11 }, (_, index) =>
      logFixture({
        id: `run-history-${index + 1}`,
        startedAt: `2026-07-${String(16 - index).padStart(2, '0')}T10:00:00.000Z`,
        status: 'completed',
        deliverySummary: { delivered: 0, failed: 1, skipped: 0, unknown: 0 }
      })
    )
    const selectedRunLogId = 'run-history-11'

    expect(buildTaskDeliveryAttemptRequest([latest, ...historical], selectedRunLogId, 0)).toEqual({
      runLogId: selectedRunLogId,
      offset: 0
    })
    const retryResult = mergeTaskDeliveryRun([latest, ...historical], {
      ...historical[10],
      deliverySummary: { delivered: 1, failed: 1, skipped: 0, unknown: 0 }
    })

    expect(retryResult).toEqual({
      logs: expect.arrayContaining([
        expect.objectContaining({
          id: selectedRunLogId,
          deliverySummary: { delivered: 1, failed: 1, skipped: 0, unknown: 0 }
        }),
        expect.objectContaining({
          id: 'run-latest',
          deliverySummary: { delivered: 1, failed: 0, skipped: 0, unknown: 0 }
        })
      ]),
      selectedRunLogId
    })
    expect(
      buildTaskDeliveryAttemptRequest(retryResult.logs, retryResult.selectedRunLogId, 0)
    ).toEqual({ runLogId: selectedRunLogId, offset: 0 })
    expect(
      buildAgentTaskCenterState({
        tasks: [taskFixture({ id: 'task-1' })],
        logsByTaskId: { 'task-1': retryResult.logs },
        jobsByRunLogId: {},
        labels: taskCenterLabels,
        selectedTaskId: 'task-1'
      }).selectedLogs.find((log) => log.id === selectedRunLogId)?.deliverySummary
    ).toEqual({ delivered: 1, failed: 1, skipped: 0, unknown: 0 })
  })

  it('formats supported schedule triggers and builds the platform job query for a task run log', () => {
    expect(formatTaskTrigger({ kind: 'once', at: Date.parse('2026-07-09T05:00:00.000Z') }, taskCenterLabels)).toBe(
      'Once · 2026-07-09 05:00'
    )
    expect(formatTaskTrigger({ kind: 'interval', ms: 2 * 60 * 60 * 1000, anchor: 'lastRun' }, taskCenterLabels)).toBe(
      'Every 2h'
    )
    expect(formatTaskTrigger({ kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' }, taskCenterLabels)).toBe(
      'Cron · 0 9 * * * · Asia/Shanghai'
    )
    expect(buildTaskJobQuery('run-1')).toEqual({
      owner: 'platform',
      handlerId: 'platform.agent.task.run',
      payload: { runLogId: 'run-1' },
      limit: 1
    })
  })
})

const taskCenterLabels: AgentText['taskCenter'] = {
  title: 'Task center',
  refresh: 'Refresh',
  newTask: 'New task',
  taskList: 'Scheduled tasks',
  taskCount: (count) => `${count} task${count === 1 ? '' : 's'}`,
  loading: 'Loading tasks...',
  empty: 'No scheduled tasks yet.',
  overdue: 'Due',
  editTask: 'Edit task',
  createTask: 'Create task',
  formDescription: 'Uses the platform scheduler.',
  reset: 'Reset',
  saveTask: 'Save task',
  name: 'Name',
  namePlaceholder: 'Name',
  trigger: 'Trigger',
  triggerInterval: 'Interval',
  triggerOnce: 'Once',
  triggerCron: 'Cron',
  triggerOnceSummary: (value) => `Once · ${value}`,
  triggerCronSummary: (expr, timezone) => (timezone ? `Cron · ${expr} · ${timezone}` : `Cron · ${expr}`),
  triggerIntervalSummary: (value) => `Every ${value}`,
  intervalMinutes: 'Interval minutes',
  onceAt: 'Run at',
  onceAtPlaceholder: 'Example: 2026-07-09T09:00',
  cronExpr: 'Cron expression',
  cronExprPlaceholder: 'Example: 0 9 * * *',
  timezone: 'Timezone',
  timezonePlaceholder: 'Example: Asia/Shanghai',
  timeoutMinutes: 'Timeout minutes',
  workspace: 'Workspace',
  systemWorkspace: 'System workspace',
  enabled: 'Enable task',
  enabledDescription: 'Enable task.',
  channels: 'Channels',
  channelsPlaceholder: 'Select channels',
  channelReadiness: 'Channel readiness',
  channelReady: 'Ready',
  channelInactive: 'Inactive',
  channelNoActiveChat: 'No active chat',
  prompt: 'Task prompt',
  promptPlaceholder: 'Prompt',
  runLogs: 'Run logs',
  noRunOutput: 'No output yet',
  schedulePreview: 'Next run',
  scheduleInvalid: 'Schedule invalid',
  timezoneInvalid: 'Timezone invalid',
  paused: 'Paused',
  completedTask: 'Completed task',
  pauseReasonUser: 'Paused by user.',
  pauseReasonFailureCircuit: 'Paused after failure.',
  revisionConflict: 'Task changed elsewhere.',
  runNow: 'Run now',
  cancelRun: 'Stop run',
  deleteTask: 'Delete task',
  noLogs: 'No run logs yet.',
  loadMoreRuns: 'Load more runs',
  openSession: 'Open session',
  deliverySummary: (delivered, failed, skipped, unknown) => `${delivered}/${failed}/${skipped}/${unknown}`,
  deliveryAttempts: 'Delivery attempts',
  noDeliveryAttempts: 'No delivery attempts.',
  loadMoreDeliveryAttempts: 'Load more attempts',
  retryDelivery: 'Retry delivery',
  retryDeliveryFailed: 'Retry delivery failed.',
  deliveryAttempt: (channelId, attemptNumber) => `${channelId}/${attemptNumber}`,
  deliveryStatus: {
    pending: 'Pending',
    delivered: 'Delivered',
    failed: 'Failed',
    'skipped-no-active-target': 'No target',
    'skipped-channel-inactive': 'Inactive',
    'unknown-after-restart': 'Unknown',
    'unknown-after-send': 'Unknown after send'
  },
  loadFailed: 'Failed to load tasks.',
  saveFailed: 'Failed to save task.',
  deleteFailed: 'Failed to delete task.',
  runFailed: 'Failed to start task.',
  cancelFailed: 'Failed to stop task.',
  confirmDelete: (name) => `Delete task "${name}"?`,
  validation: {
    'name-required': 'Enter a task name.',
    'prompt-required': 'Enter a task prompt.',
    'interval-invalid': 'Interval minutes must be greater than 0.',
    'once-at-invalid': 'Run-at time is invalid.',
    'cron-required': 'Enter a cron expression.',
    'timeout-invalid': 'Timeout minutes must be greater than 0.'
  },
  status: {
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    skipped: 'Skipped'
  },
  jobStatus: {
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled'
  },
  jobLogLevel: {
    debug: 'Debug',
    info: 'Info',
    warn: 'Warn',
    error: 'Error'
  },
  jobLogEntry: (time, level, message) => `${time} · ${level} · ${message}`
}

function taskFixture(overrides: Partial<ScheduledTaskEntity> = {}): ScheduledTaskEntity {
  return {
    id: 'task-1',
    agentId: 'agent-1',
    name: 'Scheduled task',
    prompt: 'Run the scheduled task.',
    trigger: { kind: 'interval', ms: 60 * 60 * 1000, anchor: 'lastRun' },
    catchUpPolicy: { kind: 'skip-missed' },
    timeoutMinutes: 30,
    workspace: { type: 'system' },
    channelIds: [],
    nextRun: null,
    lastRun: null,
    enabled: true,
    status: 'active',
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
    ...overrides
  }
}

function logFixture(overrides: Partial<TaskRunLogEntity> = {}): TaskRunLogEntity {
  return {
    id: 'run-1',
    scheduleId: 'task-1',
    sessionId: null,
    startedAt: '2026-07-09T00:00:00.000Z',
    durationMs: 0,
    status: 'completed',
    result: null,
    error: null,
    ...overrides
  }
}

function jobFixture(overrides: Partial<JobRunRecord> = {}): JobRunRecord {
  return {
    id: 'job-1',
    definitionId: 'platform.agent.task.run-1',
    handlerId: 'platform.agent.task.run',
    owner: 'platform',
    title: 'Agent task',
    status: 'completed',
    trigger: { kind: 'manual' },
    payload: {},
    attempt: 1,
    maxAttempts: 1,
    createdAt: '2026-07-09T00:00:00.000Z',
    startedAt: '2026-07-09T00:00:00.000Z',
    completedAt: '2026-07-09T00:01:00.000Z',
    logs: [],
    ...overrides
  }
}
