import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import type { AgentStoreSeed } from './agentStore'
import type { McpRuntimeStatus, McpServerEntity } from '../schemas/mcpServerSchemas'
import type { InstalledSkill } from '../schemas/skillSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '../schemas/taskSchemas'
import type { McpToolsByServerId } from '../tools/agentToolCatalog'
import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { createAgentPlatformRepositories } from '../repositories/createAgentPlatformRepositories'
import { createDefaultAgentPersistentState } from './agentPersistentStore'
import { createAgentSqliteStore, createAgentSqliteStoreWithOptions } from './agentSqliteStore'
import { TaskAutomationCommandService } from '../runtime/tasks/TaskAutomationCommandService'
import { createAgentPlatformServices } from '../services'
import { AgentTaskDispatchService } from '../runtime/tasks/AgentTaskDispatchService'
import { AgentTaskExecutionCoordinator } from '../runtime/tasks/AgentTaskExecutionCoordinator'
import { createTaskAutomationMaintenance } from '../../../desktop/main/taskAutomationMaintenance'

const createdAt = '2026-01-01T00:00:00.000Z'

function createDefaultSeedlessState() {
  return createDefaultAgentPersistentState()
}

function seed(): AgentStoreSeed {
  return {
    agents: [
      {
        id: 'agent-1',
        type: 'claude-code',
        name: 'SQLite Agent',
        model: 'provider:model-a',
        modelName: 'Model A',
        orderKey: '0001',
        createdAt,
        updatedAt: createdAt,
        configuration: { avatar: 'A' }
      }
    ],
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/tmp/workspace',
        type: 'user',
        orderKey: '0001',
        createdAt,
        updatedAt: createdAt
      }
    ],
    sessions: [
      {
        id: 'session-1',
        agentId: 'agent-1',
        name: 'Seed Session',
        workspaceId: 'workspace-1',
        workspace: {
          id: 'workspace-1',
          name: 'Workspace',
          path: '/tmp/workspace',
          type: 'user',
          orderKey: '0001',
          createdAt,
          updatedAt: createdAt
        },
        orderKey: '0001',
        createdAt,
        updatedAt: createdAt
      }
    ],
    sessionPins: [{ id: 'pin-1', sessionId: 'session-1', createdAt }],
    messagesBySessionId: {
      'session-1': [
        {
          id: 'message-1',
          sessionId: 'session-1',
          role: 'assistant',
          data: { parts: [{ type: 'text', text: 'Persist me' }] },
          searchableText: 'Persist me',
          status: 'success',
          modelId: null,
          modelSnapshot: null,
          stats: null,
          runtimeResumeToken: null,
          createdAt,
          updatedAt: createdAt
        }
      ]
    },
    channels: [
      {
        id: 'channel-1',
        type: 'telegram',
        name: 'Telegram',
        agentId: 'agent-1',
        workspace: { type: 'user', workspaceId: 'workspace-1' },
        config: { bot_token: 'token' },
        isActive: true,
        createdAt,
        updatedAt: createdAt
      }
    ],
    activeAgentId: 'agent-1',
    activeSessionId: 'session-1'
  }
}

describe('agent sqlite store', () => {
  it('persists due queued admission across reopen and deduplicates concurrent coordinators', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-due-queue-'))
    const path = join(directory, 'agents.sqlite')
    const dueTask: ScheduledTaskEntity = {
      id: 'due-task', agentId: 'agent-1', name: 'Due task', prompt: 'Run',
      trigger: { kind: 'interval', ms: 300_000 }, timeoutMinutes: 30, workspace: { type: 'system' },
      enabled: true, status: 'active', revision: 1, createdAt: '2026-07-16T10:00:00.000Z', updatedAt: '2026-07-16T10:00:00.000Z'
    }
    const occupiedRuns: TaskRunLogEntity[] = ['one', 'two', 'three'].map((id, index) => ({
      id: `running-${id}`, scheduleId: `occupied-${id}`, agentId: `agent-${index + 2}`,
      taskNameSnapshot: 'Occupied', startedAt: createdAt, durationMs: 0, status: 'running'
    }))
    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, {
        ...seed(),
        agents: [
          { ...seed().agents![0]!, configuration: { permission_mode: 'bypassPermissions' } },
          ...[2, 3, 4].map((index) => ({ ...seed().agents![0]!, id: `agent-${index}`, name: `Agent ${index}`, orderKey: `agent-${index}` }))
        ],
        tasks: [dueTask],
        taskRunLogs: occupiedRuns
      })
      const services = createAgentPlatformServices(store)
      const first = new AgentTaskExecutionCoordinator({ services, now: () => '2026-07-16T12:00:00.000Z', dispatchQueuedRun: vi.fn() })
      const second = new AgentTaskExecutionCoordinator({ services, now: () => '2026-07-16T12:00:00.000Z', dispatchQueuedRun: vi.fn() })

      await Promise.all([first.enqueueDueTask(dueTask.id), second.enqueueDueTask(dueTask.id)])
      expect(createAgentPlatformRepositories(database).taskRunLogs.list(dueTask.id).logs).toEqual([
        expect.objectContaining({ scheduleId: dueTask.id, status: 'queued' })
      ])
      database.connection.close()

      const reopened = createAgentPlatformDatabase(path)
      expect(createAgentPlatformRepositories(reopened).taskRunLogs.list(dueTask.id).logs).toEqual([
        expect.objectContaining({ scheduleId: dueTask.id, status: 'queued' })
      ])
      reopened.connection.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('claims one durable queued run across concurrent coordinators and preserves terminal rows through recovery', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-queue-claim-'))
    const path = join(directory, 'agents.sqlite')
    const task: ScheduledTaskEntity = {
      id: 'queue-task', agentId: 'agent-1', name: 'Queue task', prompt: 'Run',
      trigger: { kind: 'interval', ms: 300_000 }, timeoutMinutes: 30, workspace: { type: 'system' },
      enabled: true, status: 'active', revision: 1, createdAt: '2026-07-16T10:00:00.000Z', updatedAt: '2026-07-16T10:00:00.000Z'
    }
    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, {
        ...seed(),
        agents: [{ ...seed().agents![0]!, configuration: { permission_mode: 'bypassPermissions' } }],
        tasks: [task],
        taskRunLogs: [{
          id: 'queued-run', scheduleId: task.id, agentId: task.agentId, taskNameSnapshot: task.name,
          startedAt: '2026-07-16T10:00:00.000Z', durationMs: 0, status: 'queued'
        }]
      })
      const services = createAgentPlatformServices(store)
      const firstDispatch = vi.fn(async () => undefined)
      const secondDispatch = vi.fn(async () => undefined)
      const first = new AgentTaskExecutionCoordinator({ services, now: () => '2026-07-16T12:00:00.000Z', dispatchQueuedRun: firstDispatch })
      const second = new AgentTaskExecutionCoordinator({ services, now: () => '2026-07-16T12:00:00.000Z', dispatchQueuedRun: secondDispatch })

      await Promise.all([first.drain(), second.drain()])
      expect(firstDispatch.mock.calls.length + secondDispatch.mock.calls.length).toBe(1)
      expect(createAgentPlatformRepositories(database).taskRunLogs.get('queued-run')).toMatchObject({
        status: 'running',
        startedAt: '2026-07-16T12:00:00.000Z'
      })
      await services.tasks.patchRunLog('queued-run', { status: 'completed', resultPreview: 'Done' })
      database.connection.close()

      const reopened = createAgentPlatformDatabase(path)
      const reopenedStore = createAgentSqliteStore(reopened, seed())
      const reopenedServices = createAgentPlatformServices(reopenedStore)
      await new AgentTaskExecutionCoordinator({ services: reopenedServices, dispatchQueuedRun: vi.fn() }).recoverAfterRestart()
      expect(createAgentPlatformRepositories(reopened).taskRunLogs.get('queued-run')).toMatchObject({ status: 'completed', resultPreview: 'Done' })
      reopened.connection.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('durably policy-blocks a queued run when eligibility changes between the drain snapshot and claim', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-queue-policy-race-'))
    const path = join(directory, 'agents.sqlite')
    const task: ScheduledTaskEntity = {
      id: 'race-task', agentId: 'agent-1', name: 'Race task', prompt: 'Run',
      trigger: { kind: 'interval', ms: 300_000 }, timeoutMinutes: 30, workspace: { type: 'system' },
      enabled: true, status: 'active', revision: 1, createdAt: '2026-07-16T10:00:00.000Z', updatedAt: '2026-07-16T10:00:00.000Z'
    }
    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, {
        ...seed(),
        agents: [{ ...seed().agents![0]!, configuration: { permission_mode: 'bypassPermissions' } }],
        tasks: [task],
        taskRunLogs: [{
          id: 'race-queued-run', scheduleId: task.id, agentId: task.agentId, taskNameSnapshot: task.name,
          startedAt: '2026-07-16T12:00:00.000Z', durationMs: 0, status: 'queued'
        }]
      })
      const services = createAgentPlatformServices(store)
      const getState = services.state.getState.bind(services.state)
      let injectedPause = false
      services.state.getState = async () => {
        const snapshot = await getState()
        if (!injectedPause) {
          injectedPause = true
          await store.update((state) => ({
            ...state,
            tasks: state.tasks.map((item) => item.id === task.id ? { ...item, enabled: false, status: 'paused' } : item)
          }), { taskRowsOnly: true })
        }
        return snapshot
      }
      const dispatchQueuedRun = vi.fn()
      const coordinator = new AgentTaskExecutionCoordinator({
        services,
        now: () => '2026-07-16T12:00:00.000Z',
        dispatchQueuedRun
      })

      await coordinator.drain()
      expect(dispatchQueuedRun).not.toHaveBeenCalled()
      expect(createAgentPlatformRepositories(database).taskRunLogs.get('race-queued-run')).toMatchObject({
        status: 'cancelled', terminalReason: 'policy-blocked'
      })
      database.connection.close()

      const reopened = createAgentPlatformDatabase(path)
      expect(createAgentPlatformRepositories(reopened).taskRunLogs.get('race-queued-run')).toMatchObject({
        status: 'cancelled', terminalReason: 'policy-blocked'
      })
      reopened.connection.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('claims a queued run when eligibility resumes after the drain snapshot but before the claim', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-queue-resume-race-'))
    const path = join(directory, 'agents.sqlite')
    const task: ScheduledTaskEntity = {
      id: 'resume-task', agentId: 'agent-1', name: 'Resume task', prompt: 'Run',
      trigger: { kind: 'interval', ms: 300_000 }, timeoutMinutes: 30, workspace: { type: 'system' },
      enabled: false, status: 'paused', revision: 1, createdAt: '2026-07-16T10:00:00.000Z', updatedAt: '2026-07-16T10:00:00.000Z'
    }
    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, {
        ...seed(),
        agents: [{ ...seed().agents![0]!, configuration: { permission_mode: 'bypassPermissions' } }],
        tasks: [task],
        taskRunLogs: [{
          id: 'resume-queued-run', scheduleId: task.id, agentId: task.agentId, taskNameSnapshot: task.name,
          startedAt: '2026-07-16T10:00:00.000Z', durationMs: 0, status: 'queued'
        }]
      })
      const services = createAgentPlatformServices(store)
      const getState = services.state.getState.bind(services.state)
      let injectedResume = false
      services.state.getState = async () => {
        const snapshot = await getState()
        if (!injectedResume) {
          injectedResume = true
          await store.update((state) => ({
            ...state,
            tasks: state.tasks.map((item) => item.id === task.id ? { ...item, enabled: true, status: 'active' } : item)
          }), { taskRowsOnly: true })
        }
        return snapshot
      }
      const dispatchQueuedRun = vi.fn(async () => undefined)
      const coordinator = new AgentTaskExecutionCoordinator({
        services,
        now: () => '2026-07-16T12:00:00.000Z',
        dispatchQueuedRun
      })

      await coordinator.drain()
      expect(dispatchQueuedRun).toHaveBeenCalledOnce()
      expect(createAgentPlatformRepositories(database).taskRunLogs.get('resume-queued-run')).toMatchObject({
        status: 'running',
        startedAt: '2026-07-16T12:00:00.000Z'
      })
      database.connection.close()

      const reopened = createAgentPlatformDatabase(path)
      expect(createAgentPlatformRepositories(reopened).taskRunLogs.get('resume-queued-run')).toMatchObject({ status: 'running' })
      reopened.connection.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('durably recovers stale queued and running task runs before scheduler reconciliation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-restart-recovery-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, seed())
      await store.update((state) => ({
        ...state,
        agents: state.agents.map((item) => item.id === 'agent-1'
          ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } }
          : item)
      }))
      const services = createAgentPlatformServices(store)
      const task = await services.tasks.create('agent-1', {
        name: 'Recoverable', prompt: 'Run', trigger: { kind: 'interval', ms: 300_000 }, workspace: { type: 'system' }
      })
      await services.tasks.addRunLog({
        id: 'queued-restart', scheduleId: task.id, agentId: 'agent-1', taskNameSnapshot: task.name,
        startedAt: createdAt, durationMs: 0, status: 'queued'
      })
      await services.tasks.addRunLog({
        id: 'running-restart', scheduleId: task.id, agentId: 'agent-1', taskNameSnapshot: task.name,
        startedAt: createdAt, durationMs: 0, status: 'running'
      })
      const coordinator = new AgentTaskExecutionCoordinator({ services, dispatchQueuedRun: vi.fn() })

      await coordinator.recoverAfterRestart()
      database.connection.close()

      const reopened = createAgentPlatformDatabase(path)
      const runs = createAgentPlatformRepositories(reopened).taskRunLogs.list(task.id).logs
      expect(runs).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'queued-restart', status: 'cancelled', terminalReason: 'runtime-restarted' }),
        expect.objectContaining({ id: 'running-restart', status: 'cancelled', terminalReason: 'runtime-restarted' })
      ]))
      expect(runs.some((run) => run.status === 'completed')).toBe(false)
      reopened.connection.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('persists cancel-run audits only after the host cancellation outcome across reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-cancel-audit-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, seed())
      await store.getState()
      await store.update((state) => ({
        ...state,
        agents: state.agents.map((item) => item.id === 'agent-1'
          ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } }
          : item)
      }))
      const services = createAgentPlatformServices(store)
      const task = await services.tasks.create('agent-1', {
        name: 'Cancelable', prompt: 'Run', trigger: { kind: 'interval', ms: 300_000 }, workspace: { type: 'system' }
      })
      const run: TaskRunLogEntity = {
        id: 'cancel-run-1', scheduleId: task.id, agentId: 'agent-1', startedAt: createdAt, durationMs: 0, status: 'running'
      }
      await services.tasks.addRunLog(run)
      const actor = { kind: 'agent' as const, agentId: 'agent-1', sessionId: 'session-1', toolCallId: 'tool-cancel-1' }
      const prepared = await services.taskCommands.prepareCancelRun({
        actor, agentId: 'agent-1', taskId: task.id, runLogId: run.id, expectedRevision: task.revision ?? 1
      })
      const repositories = createAgentPlatformRepositories(database)
      expect(repositories.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits
        .filter((audit) => audit.action === 'cancel-run')).toEqual([])

      await services.taskCommands.recordCancelRunOutcome(prepared, { outcome: 'accepted' })
      await services.taskCommands.recordCancelRunOutcome(prepared, {
        outcome: 'rejected', errorCode: 'task-not-runnable'
      })
      const outcomes = repositories.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits
        .filter((audit) => audit.action === 'cancel-run')
      expect(outcomes).toHaveLength(2)
      expect(outcomes.find((audit) => audit.outcome === 'accepted')).toMatchObject({
        actor, resultRevision: task.revision ?? 1
      })
      expect(outcomes.find((audit) => audit.outcome === 'rejected')).toMatchObject({
        errorCode: 'task-not-runnable', actor, resultRevision: null
      })

      database.connection.close()
      const reopened = createAgentPlatformDatabase(path)
      const reopenedAudits = createAgentPlatformRepositories(reopened).taskMutationAudits
        .listByTask(task.id, { limit: 20, offset: 0 }).audits
        .filter((audit) => audit.action === 'cancel-run')
      expect(reopenedAudits).toHaveLength(2)
      expect(reopenedAudits.find((audit) => audit.outcome === 'accepted')).toMatchObject({
        taskId: task.id, taskNameSnapshot: task.name, actor
      })
      expect(reopenedAudits.find((audit) => audit.outcome === 'rejected')).toMatchObject({
        errorCode: 'task-not-runnable', taskId: task.id, taskNameSnapshot: task.name, actor
      })
      reopened.connection.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps file-backed manual run admission and its accepted audit atomic across reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-admission-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, seed())
      await store.getState()
      await store.update((state) => ({
        ...state,
        agents: state.agents.map((item) => item.id === 'agent-1'
          ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } }
          : item)
      }))
      const services = createAgentPlatformServices(store)
      const task = await services.tasks.create('agent-1', {
        name: 'Admission', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 }, workspace: { type: 'system' }
      })
      const admission = await services.tasks.admitRunNow('agent-1', task.id, { expectedRevision: task.revision ?? 1 }, '2026-01-02T00:00:00.000Z')
      const repos = createAgentPlatformRepositories(database)
      expect(repos.taskRunLogs.get(admission.runLog.id)).toMatchObject({ status: 'queued', scheduleId: task.id })
      expect(repos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now' && audit.outcome === 'accepted')).toHaveLength(1)
      database.connection.close()
      const reopened = createAgentPlatformDatabase(path)
      const reopenedRepos = createAgentPlatformRepositories(reopened)
      expect(reopenedRepos.taskRunLogs.get(admission.runLog.id)).toMatchObject({ status: 'queued', scheduleId: task.id })
      expect(reopenedRepos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now' && audit.outcome === 'accepted')).toHaveLength(1)
      reopened.connection.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ['stale revision', { expectedRevision: 99 }, 'task-revision-conflict'],
    ['paused task', { enabled: false }, 'task-not-runnable'],
    ['completed task', { status: 'completed' as const, enabled: false }, 'task-completed'],
    ['autonomy disabled', { autonomy: false }, 'task-autonomy-required'],
    ['existing running run', { running: true }, 'task-not-runnable']
  ])('rejects file-backed run-now admission for %s without creating execution', async (_name, rawSetup, code) => {
    const setup = rawSetup as { expectedRevision?: number; enabled?: boolean; status?: 'completed'; autonomy?: boolean; running?: boolean }
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-admission-reject-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, seed())
      await store.getState()
      await store.update((state) => ({
        ...state,
        agents: state.agents.map((item) => item.id === 'agent-1'
          ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } }
          : item)
      }))
      const services = createAgentPlatformServices(store)
      const task = await services.tasks.create('agent-1', { name: 'Reject', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 }, workspace: { type: 'system' } })
      if (setup.autonomy === false) await store.update((state) => ({ ...state, agents: state.agents.map((item) => item.id === 'agent-1' ? { ...item, configuration: { ...item.configuration, permission_mode: undefined } } : item) }))
      if (setup.enabled === false || setup.status === 'completed') {
        await store.update((state) => ({ ...state, tasks: state.tasks.map((item) => item.id === task.id ? { ...item, enabled: setup.enabled ?? item.enabled, status: setup.status ?? item.status } : item) }), { taskRowsOnly: true })
      }
      if (setup.running) await services.tasks.addRunLog({ id: 'existing', scheduleId: task.id, agentId: 'agent-1', taskNameSnapshot: task.name, startedAt: createdAt, durationMs: 0, status: 'running' })
      const sessionCreate = vi.fn()
      services.sessions.create = sessionCreate as typeof services.sessions.create
      const jobStart = vi.fn()
      const runtimeSend = vi.fn()
      const dispatcher = new AgentTaskDispatchService({ services, runtime: { sendMessage: runtimeSend }, jobBridge: { startTaskRun: jobStart, completeTaskRun: vi.fn(), failTaskRun: vi.fn(), cancelTaskRun: vi.fn() } })
      await expect(dispatcher.runTask('agent-1', task.id, setup.expectedRevision ?? (task.revision ?? 1))).rejects.toMatchObject({ code })
      const repos = createAgentPlatformRepositories(database)
      const audits = repos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now')
      expect(audits).toEqual([expect.objectContaining({ outcome: 'rejected', errorCode: code })])
      expect(repos.taskRunLogs.list(task.id).logs).toHaveLength(setup.running ? 1 : 0)
      expect(sessionCreate).not.toHaveBeenCalled(); expect(jobStart).not.toHaveBeenCalled(); expect(runtimeSend).not.toHaveBeenCalled()
      database.connection.close()
      const reopened = createAgentPlatformDatabase(path)
      expect(createAgentPlatformRepositories(reopened).taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now')).toHaveLength(1)
      reopened.connection.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('marks a file-backed admitted run failed when session creation fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-session-failure-')); const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path); const store = createAgentSqliteStore(database, seed()); await store.getState()
      await store.update((state) => ({ ...state, agents: state.agents.map((item) => item.id === 'agent-1' ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } } : item) }))
      const services = createAgentPlatformServices(store); const task = await services.tasks.create('agent-1', { name: 'Session failure', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 }, workspace: { type: 'system' } })
      const sessionCreate = vi.spyOn(services.sessions, 'create').mockRejectedValue(new Error('session-create-failed'))
      const jobStart = vi.fn(); const runtimeSend = vi.fn()
      const dispatcher = new AgentTaskDispatchService({ services, runtime: { sendMessage: runtimeSend }, jobBridge: { startTaskRun: jobStart, completeTaskRun: vi.fn(), failTaskRun: vi.fn(), cancelTaskRun: vi.fn() } })
      await expect(dispatcher.runTask('agent-1', task.id, task.revision ?? 1)).rejects.toThrow('session-create-failed')
      const repos = createAgentPlatformRepositories(database); const runs = repos.taskRunLogs.list(task.id).logs
      expect(runs).toEqual([expect.objectContaining({ status: 'failed', durationMs: 0, sessionId: null, error: 'session-create-failed' })])
      expect(repos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now')).toEqual([expect.objectContaining({ outcome: 'accepted' })])
      expect(jobStart).not.toHaveBeenCalled(); expect(runtimeSend).not.toHaveBeenCalled()
      await expect(dispatcher.runTask('agent-1', task.id, task.revision ?? 1)).rejects.toThrow('session-create-failed'); expect(sessionCreate).toHaveBeenCalledTimes(2)
      database.connection.close(); const reopened = createAgentPlatformDatabase(path); const reopenedRepos = createAgentPlatformRepositories(reopened)
      expect(reopenedRepos.taskRunLogs.list(task.id).logs).toHaveLength(2); expect(reopenedRepos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now' && audit.outcome === 'accepted')).toHaveLength(2)
      reopened.connection.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('keeps a file-backed admitted run failed when runtime execution fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-runtime-failure-')); const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path); const store = createAgentSqliteStore(database, seed()); await store.getState(); await store.update((state) => ({ ...state, agents: state.agents.map((item) => item.id === 'agent-1' ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } } : item) }))
      const services = createAgentPlatformServices(store); const task = await services.tasks.create('agent-1', { name: 'Runtime failure', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 }, workspace: { type: 'system' } })
      const failJob = vi.fn(); const dispatcher = new AgentTaskDispatchService({ services, runtime: { sendMessage: vi.fn(async () => { throw new Error('runtime-failed') }) }, jobBridge: { startTaskRun: vi.fn(async () => ({ jobRunId: 'job-1' })), completeTaskRun: vi.fn(), failTaskRun: failJob, cancelTaskRun: vi.fn() } })
      await expect(dispatcher.runTask('agent-1', task.id, task.revision ?? 1)).rejects.toThrow('runtime-failed')
      const repos = createAgentPlatformRepositories(database); expect(repos.taskRunLogs.list(task.id).logs).toEqual([expect.objectContaining({ status: 'failed', error: 'runtime-failed', sessionId: expect.any(String) })]); expect(failJob).toHaveBeenCalledTimes(1)
      expect(repos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now')).toEqual([expect.objectContaining({ outcome: 'accepted' })]); database.connection.close(); const reopened = createAgentPlatformDatabase(path); expect(createAgentPlatformRepositories(reopened).taskRunLogs.list(task.id).logs[0]).toMatchObject({ status: 'failed', error: 'runtime-failed' }); reopened.connection.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.each(['start failure', 'complete failure'])('keeps file-backed task runs completed when job bridge has %s', async (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-job-best-effort-')); const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path); const store = createAgentSqliteStore(database, seed()); await store.getState(); await store.update((state) => ({ ...state, agents: state.agents.map((item) => item.id === 'agent-1' ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } } : item) }))
      const services = createAgentPlatformServices(store); const task = await services.tasks.create('agent-1', { name: 'Job best effort', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 }, workspace: { type: 'system' } })
      const runtimeSend = vi.fn(async (request: { sessionId: string }) => ({ state: await services.state.getState(), userMessage: { id: 'u', sessionId: request.sessionId, role: 'user', data: { parts: [{ type: 'text', text: 'Run' }] } }, assistantMessage: { id: 'a', sessionId: request.sessionId, role: 'assistant', data: { parts: [{ type: 'text', text: 'completed text' }] } } } as any))
      const start = vi.fn(async () => { if (mode === 'start failure') throw new Error('job-start-failed'); return { jobRunId: 'job-1' } }); const complete = vi.fn(async () => { if (mode === 'complete failure') throw new Error('job-complete-failed') }); const fail = vi.fn()
      const dispatcher = new AgentTaskDispatchService({ services, runtime: { sendMessage: runtimeSend }, jobBridge: { startTaskRun: start, completeTaskRun: complete, failTaskRun: fail, cancelTaskRun: vi.fn() } })
      await expect(dispatcher.runTask('agent-1', task.id, task.revision ?? 1)).resolves.toMatchObject({ taskId: task.id }); const repos = createAgentPlatformRepositories(database); expect(repos.taskRunLogs.list(task.id).logs).toEqual([expect.objectContaining({ status: 'completed', sessionId: expect.any(String), resultPreview: 'completed text', error: null })]); expect(runtimeSend).toHaveBeenCalledTimes(1); expect(start).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(mode === 'complete failure' ? 1 : 0); expect(fail).not.toHaveBeenCalled(); expect(repos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now')).toEqual([expect.objectContaining({ outcome: 'accepted' })]); database.connection.close(); const reopened = createAgentPlatformDatabase(path); expect(createAgentPlatformRepositories(reopened).taskRunLogs.list(task.id).logs[0]).toMatchObject({ status: 'completed', resultPreview: 'completed text' }); reopened.connection.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.each([1, 2, 3])('keeps a file-backed run completed when notification %s throws', async (throwAt) => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-notify-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path); const store = createAgentSqliteStore(database, seed()); await store.getState(); await store.update((state) => ({ ...state, agents: state.agents.map((item) => item.id === 'agent-1' ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } } : item) }))
      const services = createAgentPlatformServices(store); const task = await services.tasks.create('agent-1', { name: 'Notify', prompt: 'Run', trigger: { kind: 'interval', ms: 300_000 }, workspace: { type: 'system' } }); let calls = 0
      const dispatcher = new AgentTaskDispatchService({ services, runtime: { sendMessage: async (request) => ({ state: await services.state.getState(), userMessage: { id: 'u', sessionId: request.sessionId, role: 'user', data: { parts: [] } }, assistantMessage: { id: 'a', sessionId: request.sessionId, role: 'assistant', data: { parts: [{ type: 'text', text: 'ok' }] } } } as any) }, onStateChanged: async () => { if (++calls === throwAt) throw new Error('notify-failed') } })
      await dispatcher.runTask('agent-1', task.id, task.revision ?? 1)
      const repos = createAgentPlatformRepositories(database)
      const beforeCloseRuns = repos.taskRunLogs.list(task.id)
      expect(beforeCloseRuns.total).toBe(1)
      expect(beforeCloseRuns.logs).toEqual([expect.objectContaining({ status: 'completed' })])
      expect(beforeCloseRuns.logs.filter((run) => run.status === 'running')).toHaveLength(0)
      database.connection.close()
      const reopened = createAgentPlatformDatabase(path)
      const reopenedRepos = createAgentPlatformRepositories(reopened)
      const reopenedRuns = reopenedRepos.taskRunLogs.list(task.id)
      expect(reopenedRuns.total).toBe(1)
      expect(reopenedRuns.logs).toEqual([expect.objectContaining({ status: 'completed' })])
      expect(reopenedRuns.logs.filter((run) => run.status === 'running')).toHaveLength(0)
      const runNowAudits = reopenedRepos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now' && audit.outcome === 'accepted')
      expect(runNowAudits).toEqual([expect.objectContaining({ taskId: task.id, agentId: 'agent-1', resultRevision: task.revision ?? 1 })])
      reopened.connection.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('compensates a single terminal completed patch failure with a failed durable run', async () => {
    const database = createAgentPlatformDatabase(':memory:'); const store = createAgentSqliteStore(database, seed()); await store.getState(); await store.update((state) => ({ ...state, agents: state.agents.map((item) => item.id === 'agent-1' ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } } : item) }))
    const services = createAgentPlatformServices(store); const task = await services.tasks.create('agent-1', { name: 'Patch failure', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 }, workspace: { type: 'system' } }); const originalPatch = services.tasks.patchRunLog.bind(services.tasks); let failedOnce = false
    vi.spyOn(services.tasks, 'patchRunLog').mockImplementation(async (id, patch) => { if (!failedOnce && patch.status === 'completed') { failedOnce = true; throw new Error('terminal-persist-failed') }; return originalPatch(id, patch) })
    const failJob = vi.fn(); const dispatcher = new AgentTaskDispatchService({ services, runtime: { sendMessage: async (request) => ({ state: await services.state.getState(), userMessage: { id: 'u', sessionId: request.sessionId, role: 'user', data: { parts: [] } }, assistantMessage: { id: 'a', sessionId: request.sessionId, role: 'assistant', data: { parts: [{ type: 'text', text: 'ok' }] } } } as any) }, jobBridge: { startTaskRun: async () => ({ jobRunId: 'job-1' }), completeTaskRun: vi.fn(), failTaskRun: failJob, cancelTaskRun: vi.fn() } })
    await expect(dispatcher.runTask('agent-1', task.id, task.revision ?? 1)).rejects.toThrow('terminal-persist-failed'); const repos = createAgentPlatformRepositories(database); expect(repos.taskRunLogs.list(task.id).logs).toEqual([expect.objectContaining({ status: 'failed' })]); expect(failJob).toHaveBeenCalledTimes(1); expect(repos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now')).toEqual([expect.objectContaining({ outcome: 'accepted' })])
  })

  it('admits exactly one file-backed run-now request when two dispatcher calls overlap', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-admission-concurrent-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, seed())
      await store.getState()
      await store.update((state) => ({ ...state, agents: state.agents.map((item) => item.id === 'agent-1' ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } } : item) }))
      const services = createAgentPlatformServices(store)
      const task = await services.tasks.create('agent-1', { name: 'Concurrent', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 }, workspace: { type: 'system' } })
      let release: (() => void) | undefined
      let started: (() => void) | undefined
      const runtimeGate = new Promise<void>((resolve) => { release = resolve })
      const runtimeStarted = new Promise<void>((resolve) => { started = resolve })
      const runtimeSend = vi.fn(async (request: { sessionId: string }) => {
        started?.(); await runtimeGate
        const userMessage = { id: 'user-1', sessionId: request.sessionId, role: 'user', data: { parts: [{ type: 'text', text: 'Run' }] }, searchableText: 'Run', status: 'success', modelId: null, modelSnapshot: null, stats: null, runtimeResumeToken: null, createdAt, updatedAt: createdAt }
        const assistantMessage = { id: 'assistant-1', sessionId: request.sessionId, role: 'assistant', data: { parts: [{ type: 'text', text: 'ok' }] }, searchableText: 'ok', status: 'success', modelId: null, modelSnapshot: null, stats: null, runtimeResumeToken: null, createdAt, updatedAt: createdAt }
        return { state: await services.state.getState(), userMessage, assistantMessage } as any
      })
      const sessionCreate = vi.spyOn(services.sessions, 'create')
      const jobStart = vi.fn(async () => ({ jobRunId: 'job-1' }))
      const dispatcher = new AgentTaskDispatchService({ services, runtime: { sendMessage: runtimeSend }, jobBridge: { startTaskRun: jobStart, completeTaskRun: vi.fn(), failTaskRun: vi.fn(), cancelTaskRun: vi.fn() } })
      const first = dispatcher.runTask('agent-1', task.id, task.revision ?? 1)
      await runtimeStarted
      const second = await Promise.allSettled([dispatcher.runTask('agent-1', task.id, task.revision ?? 1)])
      expect(second[0]).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ code: 'task-not-runnable' }) })
      release?.()
      const outcomes = await Promise.allSettled([first])
      expect(outcomes[0]).toMatchObject({ status: 'fulfilled' })
      const repos = createAgentPlatformRepositories(database)
      const audits = repos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now')
      expect(audits.filter((audit) => audit.outcome === 'accepted')).toHaveLength(1)
      expect(audits.filter((audit) => audit.outcome === 'rejected')).toHaveLength(1)
      expect(repos.taskRunLogs.list(task.id).logs).toHaveLength(1)
      expect(sessionCreate).toHaveBeenCalledTimes(1); expect(jobStart).toHaveBeenCalledTimes(1); expect(runtimeSend).toHaveBeenCalledTimes(1)
      database.connection.close()
      const reopened = createAgentPlatformDatabase(path)
      const reopenedRepos = createAgentPlatformRepositories(reopened)
      expect(reopenedRepos.taskRunLogs.list(task.id).logs).toHaveLength(1)
      expect(reopenedRepos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now')).toHaveLength(2)
      reopened.connection.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('isolates foreign run-now rejection audits from the owner task snapshot', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-foreign-audit-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, seed())
      await store.getState()
      await store.update((state) => ({
        ...state,
        agents: [
          ...state.agents.map((item) => item.id === 'agent-1'
            ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' as const } }
            : item),
          {
            ...state.agents[0]!,
            id: 'agent-2',
            name: 'Foreign agent',
            orderKey: '0002',
            configuration: { ...state.agents[0]!.configuration, permission_mode: 'bypassPermissions' as const }
          }
        ]
      }))
      const services = createAgentPlatformServices(store)
      const task = await services.tasks.create('agent-1', {
        name: 'Owned task', prompt: 'Run', trigger: { kind: 'interval', ms: 300_000 }, workspace: { type: 'system' }
      })
      const foreignSend = vi.fn()
      const sessionCreate = vi.spyOn(services.sessions, 'create')
      const jobStart = vi.fn()
      const foreignDispatcher = new AgentTaskDispatchService({
        services,
        runtime: { sendMessage: foreignSend },
        jobBridge: {
          startTaskRun: jobStart,
          completeTaskRun: vi.fn(),
          failTaskRun: vi.fn(),
          cancelTaskRun: vi.fn()
        }
      })
      await expect(foreignDispatcher.runTask('agent-2', task.id, task.revision ?? 1)).rejects.toMatchObject({
        code: 'task-ownership-denied'
      })
      const ownerDispatcher = new AgentTaskDispatchService({ services, runtime: { sendMessage: vi.fn() } })
      await expect(ownerDispatcher.runTask('agent-1', task.id, 99)).rejects.toMatchObject({
        code: 'task-revision-conflict'
      })
      const repositories = createAgentPlatformRepositories(database)
      expect(repositories.taskRunLogs.list(task.id).total).toBe(0)
      expect(repositories.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now')).toEqual([
        expect.objectContaining({
          agentId: 'agent-1', taskId: task.id, taskNameSnapshot: task.name,
          outcome: 'rejected', errorCode: 'task-revision-conflict'
        })
      ])
      expect(repositories.taskMutationAudits.listByAgent('agent-2', { limit: 20, offset: 0 }).audits).toEqual([
        expect.objectContaining({
          agentId: 'agent-2', taskId: null, taskNameSnapshot: null,
          outcome: 'rejected', errorCode: 'task-ownership-denied'
        })
      ])
      expect(foreignSend).not.toHaveBeenCalled()
      expect(sessionCreate).not.toHaveBeenCalled()
      expect(jobStart).not.toHaveBeenCalled()
      database.connection.close()

      const reopened = createAgentPlatformDatabase(path)
      const reopenedRepositories = createAgentPlatformRepositories(reopened)
      const reopenedStore = createAgentSqliteStore(reopened, seed())
      expect(reopenedRepositories.taskRunLogs.list(task.id).total).toBe(0)
      expect((await reopenedStore.getState()).sessions).toHaveLength(1)
      expect(reopenedRepositories.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now')).toEqual([
        expect.objectContaining({ taskId: task.id, taskNameSnapshot: task.name, errorCode: 'task-revision-conflict' })
      ])
      expect(reopenedRepositories.taskMutationAudits.listByAgent('agent-2', { limit: 20, offset: 0 }).audits).toEqual([
        expect.objectContaining({ taskId: null, taskNameSnapshot: null, errorCode: 'task-ownership-denied' })
      ])
      reopened.connection.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('preserves rejected create names and clears snapshots for missing non-create tasks', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    await store.update((state) => ({
      ...state,
      agents: state.agents.map((item) => item.id === 'agent-1'
        ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' as const } }
        : item)
    }))
    const service = new TaskAutomationCommandService({
      store,
      now: () => new Date('2026-01-02T00:00:00.000Z'),
      getPolicyPreset: async () => 'balanced'
    })
    await expect(service.execute({
      type: 'create', actor: { kind: 'user', source: 'renderer-agent-drawer' }, agentId: 'agent-1',
      task: {
        name: 'Rejected create', prompt: 'Run', trigger: { kind: 'once', at: Date.parse('2026-01-01T00:00:00.000Z') },
        workspace: { type: 'system' }
      }
    })).rejects.toMatchObject({ code: 'task-schedule-invalid' })
    await expect(service.execute({
      type: 'update', actor: { kind: 'user', source: 'renderer-agent-drawer' }, agentId: 'agent-1',
      taskId: 'missing-task', expectedRevision: 1, patch: { name: 'Missing' }
    })).rejects.toMatchObject({ code: 'task-not-found' })

    const audits = createAgentPlatformRepositories(database).taskMutationAudits.listByAgent('agent-1', { limit: 20, offset: 0 }).audits
    expect(audits.filter((audit) => audit.action === 'create')).toEqual([
      expect.objectContaining({ taskId: null, taskNameSnapshot: 'Rejected create', outcome: 'rejected', errorCode: 'task-schedule-invalid' })
    ])
    expect(audits.filter((audit) => audit.action === 'update')).toEqual([
      expect.objectContaining({ taskId: null, taskNameSnapshot: null, outcome: 'rejected', errorCode: 'task-not-found' })
    ])
    database.connection.close()
  })

  it('rejects a file-backed run-now admission when its revision changes after claim', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-admission-revision-race-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, seed())
      await store.getState()
      await store.update((state) => ({ ...state, agents: state.agents.map((item) => item.id === 'agent-1' ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } } : item) }))
      const services = createAgentPlatformServices(store)
      const task = await services.tasks.create('agent-1', { name: 'Revision race', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 }, workspace: { type: 'system' } })
      const originalAdmit = services.tasks.admitRunNow.bind(services.tasks)
      vi.spyOn(services.tasks, 'admitRunNow').mockImplementationOnce(async (agentId, taskId, request, now) => {
        await services.tasks.update(agentId, taskId, { expectedRevision: request.expectedRevision, patch: { name: 'Revision changed' } })
        return originalAdmit(agentId, taskId, request, now)
      })
      const sessionCreate = vi.spyOn(services.sessions, 'create')
      const jobStart = vi.fn(async () => ({ jobRunId: 'job-1' }))
      const runtimeSend = vi.fn()
      const dispatcher = new AgentTaskDispatchService({ services, runtime: { sendMessage: runtimeSend }, jobBridge: { startTaskRun: jobStart, completeTaskRun: vi.fn(), failTaskRun: vi.fn(), cancelTaskRun: vi.fn() } })
      await expect(dispatcher.runTask('agent-1', task.id, task.revision ?? 1)).rejects.toMatchObject({ code: 'task-revision-conflict' })
      const repos = createAgentPlatformRepositories(database)
      const runNowAudits = repos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now')
      expect(runNowAudits).toEqual([expect.objectContaining({ outcome: 'rejected', errorCode: 'task-revision-conflict' })])
      expect(repos.taskRunLogs.list(task.id).logs).toHaveLength(0)
      expect(sessionCreate).not.toHaveBeenCalled(); expect(jobStart).not.toHaveBeenCalled(); expect(runtimeSend).not.toHaveBeenCalled()
      database.connection.close()
      const reopened = createAgentPlatformDatabase(path)
      const reopenedRepos = createAgentPlatformRepositories(reopened)
      expect(reopenedRepos.taskRunLogs.list(task.id).logs).toHaveLength(0)
      expect(reopenedRepos.taskMutationAudits.listByTask(task.id, { limit: 20, offset: 0 }).audits.filter((audit) => audit.action === 'run-now')).toEqual([expect.objectContaining({ outcome: 'rejected', errorCode: 'task-revision-conflict' })])
      reopened.connection.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('reads trusted single-owner run history after deleting a file-backed task definition', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-history-owner-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, seed())
      await store.getState()
      await store.update((state) => ({ ...state, agents: state.agents.map((item) => item.id === 'agent-1' ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } } : item) }))
      const services = createAgentPlatformServices(store)
      const task = await services.tasks.create('agent-1', { name: 'History', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 }, workspace: { type: 'system' } })
      for (const [id, startedAt] of [['run-1', '2026-01-01T00:00:00.000Z'], ['run-2', '2026-01-02T00:00:00.000Z'], ['run-3', '2026-01-03T00:00:00.000Z']] as const) await services.tasks.addRunLog({ id, scheduleId: task.id, agentId: 'agent-1', taskNameSnapshot: task.name, startedAt, durationMs: 1, status: 'completed' })
      await services.tasks.delete('agent-1', task.id, { expectedRevision: task.revision ?? 1 })
      expect(createAgentPlatformRepositories(database).taskRunLogs.list(task.id).total).toBe(3)
      database.connection.close()
      const reopened = createAgentPlatformDatabase(path)
      const reopenedRepos = createAgentPlatformRepositories(reopened)
      const reopenedServices = createAgentPlatformServices(createAgentSqliteStore(reopened, seed()), { queries: { tasks: { get: reopenedRepos.tasks.get, list: reopenedRepos.tasks.list, listLogs: reopenedRepos.taskRunLogs.list }, taskRunLogs: { get: reopenedRepos.taskRunLogs.get, getOwnerForTask: reopenedRepos.taskRunLogs.getOwnerForTask } } as any })
      expect(reopenedRepos.tasks.get(task.id)).toBeNull(); expect(reopenedRepos.taskRunLogs.list(task.id).total).toBe(3)
      await expect(reopenedServices.tasks.getLogs('agent-1', task.id, { limit: 1, offset: 1 })).resolves.toMatchObject({ total: 3, logs: [expect.objectContaining({ id: 'run-2' })] })
      await expect(reopenedServices.tasks.getLogs('agent-foreign', task.id, { limit: 1, offset: 0 })).rejects.toMatchObject({ code: 'task-not-found' })
      reopened.connection.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.each([
    ['legacy null owner', ['null']],
    ['owner plus null', ['agent-1', 'null']],
    ['multiple owners', ['agent-1', 'agent-2']],
    ['no runs', []]
  ])('fails closed for deleted file-backed task history with %s', async (_name, owners) => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-history-closed-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path); const store = createAgentSqliteStore(database, seed()); await store.getState()
      await store.update((state) => ({ ...state, agents: state.agents.map((item) => item.id === 'agent-1' ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } } : item) }))
      const services = createAgentPlatformServices(store); const task = await services.tasks.create('agent-1', { name: 'Closed', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 }, workspace: { type: 'system' } })
      for (const [index, owner] of owners.entries()) await services.tasks.addRunLog({ id: `closed-${index}`, scheduleId: task.id, agentId: owner === 'null' ? null : owner, taskNameSnapshot: task.name, startedAt: `2026-01-0${index + 1}T00:00:00.000Z`, durationMs: 1, status: 'completed' })
      await services.tasks.delete('agent-1', task.id, { expectedRevision: task.revision ?? 1 }); database.connection.close()
      const reopened = createAgentPlatformDatabase(path); const repos = createAgentPlatformRepositories(reopened)
      const reopenedServices = createAgentPlatformServices(createAgentSqliteStore(reopened, seed()), { queries: { tasks: { get: repos.tasks.get, list: repos.tasks.list, listLogs: repos.taskRunLogs.list }, taskRunLogs: { get: repos.taskRunLogs.get, getOwnerForTask: repos.taskRunLogs.getOwnerForTask } } as any })
      expect(repos.taskRunLogs.getOwnerForTask(task.id)).toBeNull(); expect(repos.taskRunLogs.list(task.id).total).toBe(owners.length)
      await expect(reopenedServices.tasks.getLogs('agent-1', task.id)).rejects.toMatchObject({ code: 'task-not-found' })
      await expect(reopenedServices.tasks.getLogs('agent-foreign', task.id)).rejects.toMatchObject({ code: 'task-not-found' })
      reopened.connection.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('commits task definition mutations with accepted and rejected audits without hydrating audit rows', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    await store.update((state) => ({
      ...state,
      agents: state.agents.map((item) =>
        item.id === 'agent-1'
          ? { ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } }
          : item
      )
    }))
    const commands = new TaskAutomationCommandService({
      store,
      now: () => new Date('2026-01-02T00:00:00.000Z'),
      getPolicyPreset: async () => 'balanced'
    })

    const accepted = await commands.execute({
      type: 'create',
      actor: { kind: 'user', source: 'renderer-settings' },
      agentId: 'agent-1',
      task: {
        name: 'Audited task',
        prompt: 'Run',
        trigger: { kind: 'interval', ms: 5 * 60_000 },
        workspace: { type: 'system' }
      }
    })
    await expect(
      commands.execute({
        type: 'update',
        actor: { kind: 'user', source: 'renderer-settings' },
        agentId: 'agent-1',
        taskId: accepted.task?.id ?? 'missing',
        expectedRevision: 999,
        patch: { name: 'Stale write' }
      })
    ).rejects.toMatchObject({ code: 'task-revision-conflict' })
    await commands.execute({
      type: 'delete',
      actor: { kind: 'user', source: 'renderer-settings' },
      agentId: 'agent-1',
      taskId: accepted.task?.id ?? 'missing',
      expectedRevision: accepted.task?.revision
    })

    const repositories = createAgentPlatformRepositories(database)
    const audits = repositories.taskMutationAudits.listByAgent('agent-1', { limit: 10, offset: 0 })
    expect(accepted.auditId).toEqual(expect.any(String))
    expect(audits.audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'update', outcome: 'rejected', errorCode: 'task-revision-conflict' }),
      expect.objectContaining({ action: 'delete', outcome: 'accepted', taskNameSnapshot: 'Audited task', resultRevision: 1 }),
      expect.objectContaining({ id: accepted.auditId, action: 'create', outcome: 'accepted', resultRevision: 1 })
    ]))
    expect((await store.getState()).tasks).toEqual([])
    expect((await createAgentSqliteStore(database).getState() as Record<string, unknown>).taskMutationAudits).toBeUndefined()
  })

  it('rolls back an accepted task mutation when its SQLite audit insert fails', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    await store.update((state) => ({
      ...state,
      agents: state.agents.map((item) => ({
        ...item,
        configuration: { ...item.configuration, permission_mode: 'bypassPermissions' }
      }))
    }))
    database.connection.exec(`
      create trigger reject_task_audit_insert
      before insert on agent_task_mutation_audits
      when new.outcome = 'accepted'
      begin
        select raise(abort, 'audit-write-failed');
      end;
    `)
    const commands = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'balanced' })

    await expect(commands.execute({
      type: 'create',
      actor: { kind: 'user', source: 'renderer-settings' },
      agentId: 'agent-1',
      task: {
        name: 'Must roll back',
        prompt: 'Run',
        trigger: { kind: 'interval', ms: 5 * 60_000 },
        workspace: { type: 'system' }
      }
    })).rejects.toThrow('audit-write-failed')

    expect(createAgentPlatformRepositories(database).tasks.listAll()).toEqual([])
    expect((await store.getState()).tasks).toEqual([])
  })

  it('serializes concurrent task commands so only one stale revision update is accepted', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    await store.update((state) => ({
      ...state,
      agents: state.agents.map((item) => ({
        ...item,
        configuration: { ...item.configuration, permission_mode: 'bypassPermissions' }
      }))
    }))
    const commands = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'balanced' })
    const created = await commands.execute({
      type: 'create', actor: { kind: 'user', source: 'renderer-settings' }, agentId: 'agent-1',
      task: { name: 'Concurrent task', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 }, workspace: { type: 'system' } }
    })
    const taskId = created.task?.id ?? 'missing'

    const results = await Promise.allSettled([
      commands.execute({
        type: 'update', actor: { kind: 'user', source: 'renderer-settings' }, agentId: 'agent-1',
        taskId, expectedRevision: 1, patch: { name: 'First update' }
      }),
      commands.execute({
        type: 'update', actor: { kind: 'user', source: 'renderer-settings' }, agentId: 'agent-1',
        taskId, expectedRevision: 1, patch: { name: 'Second update' }
      })
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'task-revision-conflict' }) })
    ])
    expect(createAgentPlatformRepositories(database).taskMutationAudits.listByTask(taskId).audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'update', outcome: 'accepted', resultRevision: 2 }),
        expect.objectContaining({ action: 'update', outcome: 'rejected', errorCode: 'task-revision-conflict' })
      ])
    )
  })

  it('does not rewrite uncached run history or unrelated task subscriptions during a task command', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const store = createAgentSqliteStore(database, seed())
    const initial = await store.getState()
    seedRuntimeReadyChannel(database, 'channel-1')
    await store.update((state) => ({
      ...state,
      agents: state.agents.map((item) => ({
        ...item,
        configuration: { ...item.configuration, permission_mode: 'bypassPermissions' }
      })),
      tasks: [
        {
          id: 'task-update', agentId: 'agent-1', name: 'Update', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
          timeoutMinutes: 2, workspace: { type: 'system' }, channelIds: ['channel-1'], enabled: true, status: 'active', revision: 1,
          createdAt, updatedAt: createdAt
        },
        {
          id: 'task-unrelated', agentId: 'agent-1', name: 'Unrelated', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
          timeoutMinutes: 2, workspace: { type: 'system' }, channelIds: ['channel-1'], enabled: true, status: 'active', revision: 1,
          createdAt, updatedAt: createdAt
        }
      ],
      channelTaskSubscriptions: [
        { channelId: 'channel-1', taskId: 'task-update' },
        { channelId: 'channel-1', taskId: 'task-unrelated' }
      ]
    }), { taskRowsOnly: true })
    const repositories = createAgentPlatformRepositories(database)
    repositories.taskRunLogs.upsert({
      id: 'run-not-yet-cached', scheduleId: 'task-update', agentId: 'agent-1', taskNameSnapshot: 'Update',
      startedAt: '2026-01-02T00:00:00.000Z', durationMs: 0, status: 'running'
    })
    expect((await store.getState()).taskRunLogs).toEqual(initial.taskRunLogs)

    const commands = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'balanced' })
    await commands.execute({
      type: 'update', actor: { kind: 'user', source: 'renderer-settings' }, agentId: 'agent-1',
      taskId: 'task-update', expectedRevision: 1, patch: { name: 'Updated' }
    })

    expect(repositories.taskRunLogs.list('task-update').logs).toEqual([
      expect.objectContaining({ id: 'run-not-yet-cached', status: 'running' })
    ])
    expect(repositories.channelTaskSubscriptions.listByTaskId('task-unrelated')).toEqual([
      { channelId: 'channel-1', taskId: 'task-unrelated' }
    ])
  })

  it('migrates lifecycle fields from a file-backed legacy task database and preserves them across restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-lifecycle-migration-'))
    const path = join(directory, 'agents.sqlite')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      create table agent_platform_migrations (id text primary key, applied_at text not null);
      create table agent_tasks (
        id text primary key,
        agent_id text not null,
        name text not null,
        prompt text not null,
        trigger_json text not null,
        catch_up_policy_json text,
        timeout_minutes integer not null,
        workspace_json text not null,
        channel_ids_json text,
        next_run text,
        last_run text,
        enabled integer not null,
        status text not null,
        created_at text not null,
        updated_at text not null
      );
    `)
    legacy.prepare(
      `insert into agent_tasks (
        id, agent_id, name, prompt, trigger_json, catch_up_policy_json, timeout_minutes, workspace_json,
        channel_ids_json, next_run, last_run, enabled, status, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'task-legacy', 'agent-1', 'Legacy task', 'Run', JSON.stringify({ kind: 'interval', ms: 5 * 60_000 }), null,
      2, JSON.stringify({ type: 'system' }), '[]', null, null, 1, 'active', createdAt, createdAt
    )
    legacy.close()

    try {
      const database = createAgentPlatformDatabase(path)
      const store = createAgentSqliteStore(database, seed())
      const loaded = await store.getState()
      expect(loaded.tasks.find((task) => task.id === 'task-legacy')).toMatchObject({
        revision: 1,
        pauseReason: null,
        failureResetAt: null,
        provenance: { createdBy: 'legacy' }
      })

      await store.update((state) => ({
        ...state,
        agents: state.agents.map((item) => ({
          ...item,
          configuration: { ...item.configuration, permission_mode: 'bypassPermissions' }
        }))
      }))
      const services = createAgentPlatformServices(store)
      const paused = await services.tasks.update('agent-1', 'task-legacy', {
        expectedRevision: 1,
        patch: { enabled: false }
      })
      expect(paused).toMatchObject({ revision: 2, status: 'paused', pauseReason: 'user' })
      await expect(services.tasks.delete('agent-1', 'task-legacy', { expectedRevision: 2 })).resolves.toBe(true)

      const commands = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'balanced' })
      const created = await commands.execute({
        type: 'create',
        actor: { kind: 'agent', agentId: 'agent-1', sessionId: 'session-1', toolCallId: 'tool-1' },
        agentId: 'agent-1',
        task: { name: 'Agent task', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 }, workspace: { type: 'system' } }
      })
      const createdTask = created.task
      if (!createdTask) throw new Error('Expected Agent task creation.')
      await store.update((state) => ({
        ...state,
        tasks: state.tasks.map((item) => item.id === createdTask.id
          ? { ...item, enabled: false, status: 'paused', pauseReason: 'failure-circuit', revision: 2 }
          : item)
      }), { taskRowsOnly: true })
      await commands.execute({
        type: 'resume', actor: { kind: 'user', source: 'renderer-settings' }, agentId: 'agent-1', taskId: createdTask.id, expectedRevision: 2
      })

      const reloaded = await createAgentSqliteStore(createAgentPlatformDatabase(path), seed()).getState()
      expect(reloaded.tasks).toEqual([
        expect.objectContaining({
          id: createdTask.id,
          revision: 3,
          status: 'active',
          pauseReason: null,
          failureResetAt: expect.any(String),
          provenance: { createdBy: 'agent', createdAgentSessionId: 'session-1', createdToolCallId: 'tool-1' }
        })
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('migrates legacy task run rows to preview metadata in a file-backed database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-history-migration-'))
    const path = join(directory, 'agents.sqlite')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      create table agent_platform_migrations (id text primary key, applied_at text not null);
      create table agent_task_run_logs (
        id text primary key,
        schedule_id text not null,
        session_id text,
        started_at text not null,
        duration_ms integer not null,
        status text not null,
        result text,
        error text
      );
    `)
    legacy.prepare(
      `insert into agent_task_run_logs (id, schedule_id, session_id, started_at, duration_ms, status, result, error)
       values (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('legacy-run', 'legacy-task', null, createdAt, 25, 'completed', 'Legacy output', null)
    legacy.close()

    try {
      const database = createAgentPlatformDatabase(path)
      const repositories = createAgentPlatformRepositories(database)
      expect(repositories.taskRunLogs.list('legacy-task')).toEqual({
        logs: [expect.objectContaining({
          id: 'legacy-run',
          result: 'Legacy output',
          resultPreview: 'Legacy output'
        })],
        total: 1
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('does not hydrate legacy state-entry channels without the C03 migration reconciler', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-legacy-channel-migration-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path)
      const repos = createAgentPlatformRepositories(database)
      const legacyChannel = {
        id: 'legacy-channel', type: 'telegram' as const, name: 'Legacy Channel', agentId: 'agent-1',
        workspace: { type: 'system' as const }, config: { bot_token: 'legacy' }, isActive: true, createdAt, updatedAt: createdAt
      }
      repos.stateEntries.set('channels', [
        legacyChannel,
        { ...legacyChannel, id: 'row-shadow', name: 'Stale Legacy Shadow', config: { bot_token: 'stale' } }
      ])
      repos.stateEntries.set('tasks', [{
        id: 'legacy-channel-task', agentId: 'agent-1', name: 'Completed legacy task', prompt: 'Run',
        trigger: { kind: 'once' as const, at: Date.parse('2026-01-01T00:00:00.000Z') }, timeoutMinutes: 2,
        workspace: { type: 'system' as const }, channelIds: ['legacy-channel'], enabled: false, status: 'completed' as const,
        revision: 1, provenance: { createdBy: 'legacy' as const }, createdAt, updatedAt: createdAt
      }])
      repos.stateEntries.set('channelTaskSubscriptions', [{ channelId: 'legacy-channel', taskId: 'legacy-channel-task' }])

      const store = createAgentSqliteStore(database, seed())
      const loaded = await store.getState()
      expect(loaded.channels).toEqual([])
      expect(repos.stateEntries.get('channels')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'legacy-channel' })]))
      expect(repos.stateEntries.get('tasks')).toBeNull()
      expect(repos.stateEntries.get('channelTaskSubscriptions')).toBeNull()
      expect(repos.channels.listAll()).toEqual([])
      expect(repos.tasks.get('legacy-channel-task')).toMatchObject({ status: 'completed', enabled: false, channelIds: ['legacy-channel'], revision: 1 })
      expect(repos.channelTaskSubscriptions.listByTaskId('legacy-channel-task')).toEqual([
        { channelId: 'legacy-channel', taskId: 'legacy-channel-task' }
      ])

      const reloaded = await createAgentSqliteStore(createAgentPlatformDatabase(path), seed()).getState()
      expect(reloaded.channels).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('leaves state-entry Channel migration to the C03 reconciler', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-legacy-channel-migration-failure-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path)
      const repos = createAgentPlatformRepositories(database)
      const legacyChannel = {
        id: 'legacy-channel-failure', type: 'telegram' as const, name: 'Legacy Channel', agentId: 'agent-1',
        workspace: { type: 'system' as const }, config: { bot_token: 'legacy' }, isActive: true, createdAt, updatedAt: createdAt
      }
      repos.stateEntries.set('channels', [legacyChannel])
      const state = await createAgentSqliteStore(database, seed()).getState()
      expect(state.channels).toEqual([])
      expect(repos.channels.listAll()).toEqual([])
      expect(repos.stateEntries.get('channels')).toEqual([legacyChannel])
      expect(createAgentPlatformRepositories(createAgentPlatformDatabase(path)).stateEntries.get('channels')).toEqual([legacyChannel])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('does not make legacy state-entry channels available to generic Channel deletion', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-legacy-channel-cleanup-failure-'))
    const path = join(directory, 'agents.sqlite')
    try {
      const database = createAgentPlatformDatabase(path)
      const repos = createAgentPlatformRepositories(database)
      const legacyChannel = {
        id: 'legacy-channel-cleanup', type: 'telegram' as const, name: 'Legacy Channel', agentId: 'agent-1',
        workspace: { type: 'system' as const }, config: { bot_token: 'legacy' }, isActive: true, createdAt, updatedAt: createdAt
      }
      repos.stateEntries.set('channels', [legacyChannel])
      repos.stateEntries.set('tasks', [{
        id: 'legacy-cleanup-task', agentId: 'agent-1', name: 'Legacy task', prompt: 'Run',
        trigger: { kind: 'interval' as const, ms: 5 * 60_000 }, timeoutMinutes: 2, workspace: { type: 'system' as const },
        channelIds: ['legacy-channel-cleanup'], enabled: false, status: 'paused' as const, revision: 1,
        provenance: { createdBy: 'legacy' as const }, createdAt, updatedAt: createdAt
      }])
      repos.stateEntries.set('channelTaskSubscriptions', [{ channelId: 'legacy-channel-cleanup', taskId: 'legacy-cleanup-task' }])

      const store = createAgentSqliteStore(database, seed())
      expect((await store.getState()).channels).toEqual([])
      await expect(createAgentPlatformServices(store).channels.delete('legacy-channel-cleanup')).resolves.toBe(false)
      expect(repos.tasks.get('legacy-cleanup-task')).toMatchObject({ channelIds: ['legacy-channel-cleanup'], revision: 1, status: 'paused' })
      expect(repos.channelTaskSubscriptions.listByTaskId('legacy-cleanup-task')).toEqual([
        { channelId: 'legacy-channel-cleanup', taskId: 'legacy-cleanup-task' }
      ])
      expect(repos.taskMutationAudits.listByTask('legacy-cleanup-task', { limit: 10, offset: 0 }).total).toBe(0)

      const reloaded = await createAgentSqliteStore(createAgentPlatformDatabase(path), seed()).getState()
      expect(reloaded.channels).toEqual([])
      expect(reloaded.tasks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'legacy-cleanup-task', channelIds: ['legacy-channel-cleanup'], revision: 1 })
      ]))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('archives non-empty legacy state after one-time sqlite migration', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const archiveLegacyState = vi.fn(async () => undefined)
    const store = createAgentSqliteStoreWithOptions(database, createDefaultSeedlessState(), {
      legacyStateLoader: async () => seed(),
      legacyStateArchiver: archiveLegacyState
    })

    const migrated = await store.getState()
    const reloaded = await createAgentSqliteStore(database).getState()

    expect(migrated.agents.map((agent) => agent.id)).toEqual(['agent-1'])
    expect(reloaded.agents.map((agent) => agent.id)).toEqual(['agent-1'])
    expect(archiveLegacyState).toHaveBeenCalledTimes(1)
    expect(archiveLegacyState).toHaveBeenCalledWith(expect.objectContaining({ agents: expect.arrayContaining([expect.objectContaining({ id: 'agent-1' })]) }))
  })

  it('does not archive empty legacy state or legacy state ignored because sqlite already has rows', async () => {
    const emptyArchive = vi.fn(async () => undefined)
    await createAgentSqliteStoreWithOptions(createAgentPlatformDatabase(':memory:'), createDefaultSeedlessState(), {
      legacyStateLoader: async () => createDefaultSeedlessState(),
      legacyStateArchiver: emptyArchive
    }).getState()
    expect(emptyArchive).not.toHaveBeenCalled()

    const database = createAgentPlatformDatabase(':memory:')
    const existingStore = createAgentSqliteStore(database, seed())
    await existingStore.getState()
    const ignoredArchive = vi.fn(async () => undefined)
    await createAgentSqliteStoreWithOptions(database, createDefaultSeedlessState(), {
      legacyStateLoader: async () => ({
        ...seed(),
        agents: [{ ...seed().agents![0]!, id: 'legacy-agent' }]
      }),
      legacyStateArchiver: ignoredArchive
    }).getState()

    expect(ignoredArchive).not.toHaveBeenCalled()
  })

  it('hydrates seed into an empty sqlite database and reloads persisted updates from entity tables', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const store = createAgentSqliteStore(database, seed())

    const initial = await store.getState()
    expect(initial.agents.map((agent) => agent.id)).toEqual(['agent-1'])
    expect(initial.sessions.map((session) => session.id)).toEqual(['session-1'])
    expect(initial.messagesBySessionId['session-1']?.map((message) => message.id)).toEqual(['message-1'])
    expect(initial.sessionPins.map((pin) => pin.sessionId)).toEqual(['session-1'])

    await store.update((current) => ({
      ...current,
      agents: current.agents.map((agent) => (agent.id === 'agent-1' ? { ...agent, name: 'Renamed Agent' } : agent)),
      messagesBySessionId: {
        ...current.messagesBySessionId,
        'session-1': [
          ...(current.messagesBySessionId['session-1'] ?? []),
          {
            id: 'message-2',
            sessionId: 'session-1',
            role: 'user',
            data: { parts: [{ type: 'text', text: 'Second message' }] },
            searchableText: 'Second message',
            status: 'success',
            modelId: null,
            modelSnapshot: null,
            stats: null,
            runtimeResumeToken: null,
            createdAt: '2026-01-01T00:00:01.000Z',
            updatedAt: '2026-01-01T00:00:01.000Z'
          }
        ]
      }
    }))

    const reloaded = createAgentSqliteStore(database)
    const next = await reloaded.getState()

    expect(next.agents.find((agent) => agent.id === 'agent-1')?.name).toBe('Renamed Agent')
    expect(next.sessions.find((session) => session.id === 'session-1')?.workspace.name).toBe('Workspace')
    expect(next.messagesBySessionId['session-1']?.map((message) => message.id)).toEqual(['message-1', 'message-2'])
    expect(next.channels).toEqual([])
    expect(next.activeAgentId).toBe('agent-1')
    expect(next.activeSessionId).toBe('session-1')
  })

  it('prefers the row-level active selection table while keeping legacy state entry fallback', async () => {
    const legacyDatabase = createAgentPlatformDatabase(':memory:')
    const legacyRepos = createAgentPlatformRepositories(legacyDatabase)
    legacyRepos.agents.upsert({
      id: 'legacy-agent',
      type: 'claude-code',
      name: 'Legacy Agent',
      model: 'provider:model-a',
      modelName: 'Model A',
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt
    })
    legacyRepos.workspaces.upsert({
      id: 'legacy-workspace',
      name: 'Legacy Workspace',
      path: '/tmp/legacy-workspace',
      type: 'user',
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt
    })
    legacyRepos.sessions.upsert({
      id: 'legacy-session',
      agentId: 'legacy-agent',
      name: 'Legacy Session',
      workspaceId: 'legacy-workspace',
      workspace: {
        id: 'legacy-workspace',
        name: 'Legacy Workspace',
        path: '/tmp/legacy-workspace',
        type: 'user',
        orderKey: '0001',
        createdAt,
        updatedAt: createdAt
      },
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt
    })
    legacyRepos.stateEntries.set('activeSelection', {
      activeAgentId: 'legacy-agent',
      activeSessionId: 'legacy-session'
    })

    const legacyStore = createAgentSqliteStore(legacyDatabase)
    const legacyState = await legacyStore.getState()

    expect(legacyState.activeAgentId).toBe('legacy-agent')
    expect(legacyState.activeSessionId).toBe('legacy-session')

    const database = createAgentPlatformDatabase(':memory:')
    const store = createAgentSqliteStore(database, seed())
    await store.update((current) => ({
      ...current,
      activeAgentId: null,
      activeSessionId: null
    }))

    const repos = createAgentPlatformRepositories(database)

    expect(repos.activeSelection.get()).toEqual({
      activeAgentId: null,
      activeSessionId: null
    })
  })

  it('loads MCP runtime state from row-level sqlite tables while keeping legacy state entry fallback', async () => {
    const legacyDatabase = createAgentPlatformDatabase(':memory:')
    const legacyRepos = createAgentPlatformRepositories(legacyDatabase)
    const legacyServers: McpServerEntity[] = [
      {
        id: 'mcp-legacy',
        name: 'Legacy MCP',
        isActive: true,
        createdAt,
        updatedAt: createdAt
      }
    ]
    const legacyTools: McpToolsByServerId = {
      'mcp-legacy': [{ id: 'legacy-read', name: 'legacy-read', description: 'Legacy read' }]
    }
    const legacyStatuses: Record<string, McpRuntimeStatus> = {
      'mcp-legacy': { state: 'connected', lastCheckedAt: 1 }
    }
    legacyRepos.stateEntries.set('mcpServers', legacyServers)
    legacyRepos.stateEntries.set('mcpToolsByServerId', legacyTools)
    legacyRepos.stateEntries.set('mcpRuntimeStatusByServerId', legacyStatuses)

    const legacyState = await createAgentSqliteStore(legacyDatabase).getState()

    expect(legacyState.mcpServers).toEqual(legacyServers)
    expect(legacyState.mcpToolsByServerId).toEqual(legacyTools)
    expect(legacyState.mcpRuntimeStatusByServerId).toEqual(legacyStatuses)

    const database = createAgentPlatformDatabase(':memory:')
    const rowRepos = createAgentPlatformRepositories(database)
    rowRepos.stateEntries.set('mcpServers', legacyServers)
    rowRepos.stateEntries.set('mcpToolsByServerId', legacyTools)
    rowRepos.stateEntries.set('mcpRuntimeStatusByServerId', legacyStatuses)
    rowRepos.mcpServers.upsert({
      id: 'mcp-row',
      name: 'Row MCP',
      isActive: true,
      sortOrder: 1,
      createdAt,
      updatedAt: createdAt
    })
    rowRepos.mcpTools.replaceForServer('mcp-row', [{ id: 'row-search', name: 'row-search' }])
    rowRepos.mcpRuntimeStatus.set('mcp-row', { state: 'error', message: 'row error', lastCheckedAt: 2 })

    const rowState = await createAgentSqliteStore(database).getState()

    expect(rowState.mcpServers.map((server) => server.id)).toEqual(['mcp-row'])
    expect(rowState.mcpToolsByServerId).toEqual({ 'mcp-row': [{ id: 'row-search', name: 'row-search' }] })
    expect(rowState.mcpRuntimeStatusByServerId).toEqual({
      'mcp-row': { state: 'error', message: 'row error', lastCheckedAt: 2 }
    })
  })

  it('loads skills from row-level sqlite tables while keeping legacy fallback grouped by migrated skill state', async () => {
    const legacyDatabase = createAgentPlatformDatabase(':memory:')
    const legacyRepos = createAgentPlatformRepositories(legacyDatabase)
    const legacySkills: InstalledSkill[] = [
      {
        id: 'skill-legacy',
        name: 'Legacy Skill',
        description: null,
        folderName: 'legacy-skill',
        source: 'builtin',
        sourceUrl: null,
        namespace: null,
        author: null,
        sourceTags: ['legacy'],
        contentHash: 'hash-legacy',
        isEnabled: true,
        createdAt,
        updatedAt: createdAt
      }
    ]
    const legacyBindings = [{ agentId: 'agent-legacy', skillId: 'skill-legacy', isEnabled: true }]
    legacyRepos.stateEntries.set('skills', legacySkills)
    legacyRepos.stateEntries.set('agentSkills', legacyBindings)

    const legacyState = await createAgentSqliteStore(legacyDatabase).getState()

    expect(legacyState.skills).toEqual(legacySkills)
    expect(legacyState.agentSkills).toEqual(legacyBindings)

    const database = createAgentPlatformDatabase(':memory:')
    const rowRepos = createAgentPlatformRepositories(database)
    rowRepos.stateEntries.set('skills', legacySkills)
    rowRepos.stateEntries.set('agentSkills', legacyBindings)
    rowRepos.skills.replaceAll([
      {
        id: 'skill-row',
        name: 'Row Skill',
        description: 'Row-level skill',
        folderName: 'row-skill',
        source: 'local',
        sourceUrl: 'file:///tmp/row-skill',
        namespace: 'platform',
        author: 'OpenAI',
        sourceTags: ['row'],
        contentHash: 'hash-row',
        isEnabled: false,
        createdAt,
        updatedAt: createdAt
      }
    ])

    const rowState = await createAgentSqliteStore(database).getState()

    expect(rowState.skills.map((skill) => skill.id)).toEqual(['skill-row'])
    expect(rowState.agentSkills).toEqual([])
  })

  it('can skip skill row mirroring during replace when focused writers already persisted skill rows', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    const initial = await store.getState()
    const focusedSkill: InstalledSkill = {
      id: 'skill-focused',
      name: 'Focused Skill',
      description: null,
      folderName: 'focused-skill',
      source: 'local',
      sourceUrl: null,
      namespace: null,
      author: null,
      sourceTags: ['focused'],
      contentHash: 'hash-focused',
      isEnabled: true,
      createdAt,
      updatedAt: createdAt
    }
    const snapshotSkill: InstalledSkill = {
      ...focusedSkill,
      name: 'Snapshot Skill',
      sourceTags: ['snapshot'],
      contentHash: 'hash-snapshot'
    }
    repos.skills.replaceAll([focusedSkill])
    repos.agentSkills.replaceAll([{ agentId: 'agent-1', skillId: focusedSkill.id, isEnabled: true }])

    await store.replace(
      {
        ...initial,
        skills: [snapshotSkill],
        agentSkills: [{ agentId: 'agent-1', skillId: snapshotSkill.id, isEnabled: false }]
      },
      { skipSkillRowMirror: true }
    )

    expect(repos.skills.listAll()).toEqual([focusedSkill])
    expect(repos.agentSkills.listAll()).toEqual([{ agentId: 'agent-1', skillId: focusedSkill.id, isEnabled: true }])
    expect(repos.stateEntries.get('skills')).toBeNull()
    expect(repos.stateEntries.get('agentSkills')).toBeNull()
    expect(repos.stateEntries.get('activeSelection')).toEqual({
      activeAgentId: initial.activeAgentId,
      activeSessionId: initial.activeSessionId
    })
  })

  it('can persist active selection as a focused row-only update without rebuilding other row tables', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()

    await store.update(
      (current) => ({
        ...current,
        activeAgentId: null,
        activeSessionId: null
      }),
      { activeSelectionRowOnly: true }
    )

    expect(repos.activeSelection.get()).toEqual({ activeAgentId: null, activeSessionId: null })
    expect(repos.stateEntries.get('activeSelection')).toEqual({ activeAgentId: null, activeSessionId: null })
    expect(listPersistedSessionIds(repos)).toContain('session-1')
  })

  it('can persist session pins as a focused row-only update without rebuilding parent session rows', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()

    await store.update(
      (current) => ({
        ...current,
        sessionPins: [{ id: 'pin-focused', sessionId: 'session-1', createdAt: '2026-01-02T00:00:00.000Z' }]
      }),
      { sessionPinRowsOnly: true }
    )

    expect(repos.sessionPins.list()).toEqual([
      { id: 'pin-focused', sessionId: 'session-1', createdAt: '2026-01-02T00:00:00.000Z' }
    ])
    expect(listPersistedSessionIds(repos)).toContain('session-1')
  })

  it('can persist task rows as a focused row-only update without rebuilding session rows', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    const initial = await store.getState()

    await store.update(
      (current) => ({
        ...current,
        tasks: [
          {
            id: 'task-focused',
            agentId: 'agent-1',
            name: 'Focused Task',
            prompt: 'Run focused task',
            trigger: { kind: 'interval', ms: 60_000 },
            catchUpPolicy: { kind: 'skip-missed' },
            timeoutMinutes: 2,
            workspace: { type: 'system' },
            channelIds: ['channel-1'],
            enabled: true,
            status: 'active',
            createdAt,
            updatedAt: createdAt
          }
        ],
        channelTaskSubscriptions: [{ channelId: 'channel-1', taskId: 'task-focused' }]
      }),
      { taskRowsOnly: true }
    )

    expect(repos.tasks.listAll().map((task) => task.id)).toEqual(['task-focused'])
    expect(repos.channelTaskSubscriptions.listByTaskId('task-focused')).toEqual([
      { channelId: 'channel-1', taskId: 'task-focused' }
    ])
    expect(listPersistedSessionIds(repos)).toContain('session-1')
    expect(initial.tasks).toEqual([])
  })

  it('preserves completed task run logs after command deletion and SQLite store reload', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    const initial = await store.getState()
    const task = {
      id: 'task-delete',
      agentId: 'agent-1',
      name: 'Completed Task',
      prompt: 'Run before delete',
      trigger: { kind: 'interval', ms: 60_000 },
      catchUpPolicy: { kind: 'skip-missed' },
      timeoutMinutes: 2,
      workspace: { type: 'system' },
      channelIds: ['channel-1'],
      enabled: false,
      status: 'completed',
      revision: 1,
      pauseReason: null,
      failureResetAt: null,
      provenance: { createdBy: 'user' },
      createdAt,
      updatedAt: createdAt
    } satisfies ScheduledTaskEntity
    await store.update(
      (current) => ({
        ...current,
        agents: current.agents.map((agent) => ({
          ...agent,
          configuration: { ...agent.configuration, permission_mode: 'bypassPermissions' }
        })),
        tasks: [task],
        channelTaskSubscriptions: [{ channelId: 'channel-1', taskId: task.id }]
      }),
      { taskRowsOnly: true }
    )
    if (!store.upsertTaskRunLog) throw new Error('Expected SQLite run-log writer.')
    await store.upsertTaskRunLog({
      id: 'run-delete', scheduleId: task.id, startedAt: '2026-01-02T00:00:00.000Z', durationMs: 5,
      status: 'completed', resultPreview: 'ok'
    })

    const commands = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'balanced' })
    await commands.execute({
      type: 'delete',
      actor: { kind: 'user', source: 'renderer-settings' },
      agentId: task.agentId,
      taskId: task.id,
      expectedRevision: 1
    })
    const reloaded = await createAgentSqliteStore(database).getState()

    expect(repos.tasks.listAll()).toEqual([])
    expect(repos.taskRunLogs.list(task.id).logs).toEqual([expect.objectContaining({ id: 'run-delete', scheduleId: task.id })])
    expect(repos.channelTaskSubscriptions.listByTaskId(task.id)).toEqual([])
    expect(reloaded.taskRunLogs).toEqual([expect.objectContaining({ id: 'run-delete', scheduleId: task.id })])
    expect(listPersistedSessionIds(repos)).toContain('session-1')
    expect(initial.tasks).toEqual([])
  })

  it('keeps run logs when task row-only persistence removes a task definition', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    const task = {
      id: 'task-orphan',
      agentId: 'agent-1',
      name: 'Orphan Guard',
      prompt: 'Run before delete',
      trigger: { kind: 'interval', ms: 60_000 },
      catchUpPolicy: { kind: 'skip-missed' },
      timeoutMinutes: 2,
      workspace: { type: 'system' },
      channelIds: [],
      enabled: true,
      status: 'active',
      createdAt,
      updatedAt: createdAt
    } satisfies ScheduledTaskEntity
    const runLog = {
      id: 'run-orphan',
      scheduleId: task.id,
      startedAt: '2026-01-02T00:00:00.000Z',
      durationMs: 5,
      status: 'completed',
      result: 'ok'
    } as const

    await store.update(
      (current) => ({
        ...current,
        tasks: [task]
      }),
      { taskRowsOnly: true }
    )
    if (!store.upsertTaskRunLog) throw new Error('Expected SQLite run-log writer.')
    await store.upsertTaskRunLog(runLog)

    await store.update(
      (current) => ({
        ...current,
        tasks: []
      }),
      { taskRowsOnly: true }
    )

    expect(repos.tasks.listAll()).toEqual([])
    expect(repos.taskRunLogs.list(task.id).logs).toEqual([expect.objectContaining({ id: runLog.id })])
  })

  it('can persist task run logs as a focused row-only update without rebuilding task rows', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    repos.tasks.upsert({
      id: 'task-1',
      agentId: 'agent-1',
      name: 'Existing Task',
      prompt: 'Run existing task',
      trigger: { kind: 'interval', ms: 60_000 },
      catchUpPolicy: { kind: 'skip-missed' },
      timeoutMinutes: 2,
      workspace: { type: 'system' },
      channelIds: [],
      enabled: true,
      status: 'active',
      createdAt,
      updatedAt: createdAt
    })

    if (!store.upsertTaskRunLog) throw new Error('Expected SQLite run-log writer.')
    await store.upsertTaskRunLog({
      id: 'run-focused', scheduleId: 'task-1', startedAt: '2026-01-02T00:00:00.000Z', durationMs: 5,
      status: 'completed', resultPreview: 'ok'
    })

    expect(repos.taskRunLogs.list('task-1').logs.map((log) => log.id)).toEqual(['run-focused'])
    expect(repos.tasks.listAll().map((task) => task.id)).toContain('task-1')
    expect(listPersistedSessionIds(repos)).toContain('session-1')
  })

  it('does not clear durable task run logs when focused state omits them', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    repos.tasks.upsert({
      id: 'task-clear-logs',
      agentId: 'agent-1',
      name: 'Clear Logs Task',
      prompt: 'Run before clearing logs',
      trigger: { kind: 'interval', ms: 60_000 },
      catchUpPolicy: { kind: 'skip-missed' },
      timeoutMinutes: 2,
      workspace: { type: 'system' },
      channelIds: [],
      enabled: true,
      status: 'active',
      createdAt,
      updatedAt: createdAt
    })

    if (!store.upsertTaskRunLog) throw new Error('Expected SQLite run-log writer.')
    await store.upsertTaskRunLog({
      id: 'run-clear', scheduleId: 'task-clear-logs', startedAt: '2026-01-02T00:00:00.000Z', durationMs: 5,
      status: 'completed', resultPreview: 'ok'
    })

    await store.update(
      (current) => ({
        ...current,
        taskRunLogs: []
      }),
      { taskRunLogRowsOnly: true }
    )

    expect(repos.taskRunLogs.list('task-clear-logs').logs).toEqual([expect.objectContaining({ id: 'run-clear' })])
    expect((await store.getState()).taskRunLogs).toEqual([expect.objectContaining({ id: 'run-clear' })])
    expect(repos.tasks.listAll().map((task) => task.id)).toContain('task-clear-logs')
    expect(listPersistedSessionIds(repos)).toContain('session-1')
  })

  it('preserves durable run history and delivery attempts across stale or tampered ordinary state replacements', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    const loaded = await store.getState()
    repos.taskRunLogs.upsert({
      id: 'run-authoritative', scheduleId: 'task-authoritative', agentId: 'agent-1', taskNameSnapshot: 'Authoritative task',
      startedAt: '2026-01-02T00:00:00.000Z', durationMs: 0, status: 'running'
    })
    repos.taskDeliveryAttempts.insertPending({
      id: 'attempt-authoritative', runLogId: 'run-authoritative', taskId: 'task-authoritative', agentId: 'agent-1',
      taskNameSnapshot: 'Authoritative task', channelId: 'channel-1', targetHash: 'hash', status: 'pending', attemptNumber: 1,
      startedAt: '2026-01-02T00:00:00.000Z'
    })

    await store.replace({ ...loaded, taskRunLogs: [] })
    await store.update((state) => ({
      ...state,
      messagesBySessionId: { ...state.messagesBySessionId },
      taskRunLogs: [{
        id: 'run-authoritative', scheduleId: 'task-tampered', agentId: 'agent-tampered', taskNameSnapshot: 'Tampered task',
        startedAt: '2026-01-02T00:00:00.000Z', durationMs: 10, status: 'completed', resultPreview: 'tampered'
      }]
    }))

    expect(repos.taskRunLogs.list('task-authoritative').logs).toEqual([
      expect.objectContaining({
        id: 'run-authoritative', scheduleId: 'task-authoritative', agentId: 'agent-1', taskNameSnapshot: 'Authoritative task', status: 'running'
      })
    ])
    expect(repos.taskDeliveryAttempts.listByRun('run-authoritative', { limit: 10, offset: 0 }).total).toBe(1)
    expect((await store.getState()).taskRunLogs).toEqual([
      expect.objectContaining({ id: 'run-authoritative', scheduleId: 'task-authoritative', agentId: 'agent-1', taskNameSnapshot: 'Authoritative task' })
    ])
    expect((await createAgentSqliteStore(database).getState()).taskRunLogs).toEqual([
      expect.objectContaining({ id: 'run-authoritative', scheduleId: 'task-authoritative', agentId: 'agent-1', taskNameSnapshot: 'Authoritative task' })
    ])
  })

  it('applies focused terminal run patches without changing immutable ownership snapshots', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    repos.taskRunLogs.upsert({
      id: 'run-terminal', scheduleId: 'task-original', agentId: 'agent-original', taskNameSnapshot: 'Original task',
      startedAt: '2026-01-02T00:00:00.000Z', durationMs: 0, status: 'running'
    })

    if (!store.patchTaskRunLog) throw new Error('Expected SQLite run-log writer.')
    await store.patchTaskRunLog('run-terminal', {
      scheduleId: 'task-tampered', agentId: 'agent-tampered', taskNameSnapshot: 'Tampered task',
      durationMs: 20, status: 'completed', resultPreview: 'Done'
    })

    expect(repos.taskRunLogs.list('task-original').logs).toEqual([
      expect.objectContaining({
        id: 'run-terminal', scheduleId: 'task-original', agentId: 'agent-original', taskNameSnapshot: 'Original task',
        status: 'completed', durationMs: 20, resultPreview: 'Done'
      })
    ])
  })

  it('persists concurrent focused run terminal patches without rolling another task back to running', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    if (!store.upsertTaskRunLog || !store.patchTaskRunLog) throw new Error('Expected SQLite run-log writer.')
    await Promise.all([
      store.upsertTaskRunLog({ id: 'run-a', scheduleId: 'task-a', agentId: 'agent-1', taskNameSnapshot: 'Task A', startedAt: createdAt, durationMs: 0, status: 'running' }),
      store.upsertTaskRunLog({ id: 'run-b', scheduleId: 'task-b', agentId: 'agent-1', taskNameSnapshot: 'Task B', startedAt: createdAt, durationMs: 0, status: 'running' })
    ])

    await Promise.all([
      store.patchTaskRunLog('run-a', { status: 'completed', durationMs: 11, resultPreview: 'A complete' }),
      store.patchTaskRunLog('run-b', { status: 'completed', durationMs: 12, resultPreview: 'B complete' })
    ])
    await Promise.all([
      store.patchTaskRunLog('run-a', { status: 'failed', durationMs: 13, error: 'A failure' }),
      store.patchTaskRunLog('run-b', { status: 'completed', durationMs: 14, resultPreview: 'B final' })
    ])

    expect(repos.taskRunLogs.list('task-a').logs).toEqual([
      expect.objectContaining({ id: 'run-a', status: 'failed', durationMs: 13, error: 'A failure', taskNameSnapshot: 'Task A' })
    ])
    expect(repos.taskRunLogs.list('task-b').logs).toEqual([
      expect.objectContaining({ id: 'run-b', status: 'completed', durationMs: 14, resultPreview: 'B final', taskNameSnapshot: 'Task B' })
    ])
    expect((await store.getState()).taskRunLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'run-a', status: 'failed' }),
      expect.objectContaining({ id: 'run-b', status: 'completed' })
    ]))
    expect((await createAgentSqliteStore(database).getState()).taskRunLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'run-a', status: 'failed' }),
      expect.objectContaining({ id: 'run-b', status: 'completed' })
    ]))
  })

  it.each(['run-first', 'state-first'] as const)('serializes %s run and ordinary state writes without losing non-task state', async (order) => {
    const database = createAgentPlatformDatabase(':memory:')
    const store = createAgentSqliteStore(database, seed())
    const initial = await store.getState()
    if (!store.upsertTaskRunLog || !store.patchTaskRunLog) throw new Error('Expected SQLite run-log writer.')
    await store.upsertTaskRunLog({
      id: 'run-selection', scheduleId: 'task-selection', agentId: 'agent-1', taskNameSnapshot: 'Selection task',
      startedAt: createdAt, durationMs: 0, status: 'running'
    })

    const patchRun = () => store.patchTaskRunLog!('run-selection', { status: 'completed', durationMs: 8, resultPreview: 'Done' })
    const updateState = () => store.update((state) => ({
      ...state,
      activeAgentId: 'agent-new'
    }), { activeSelectionRowOnly: true })
    await Promise.all(order === 'run-first' ? [patchRun(), updateState()] : [updateState(), patchRun()])

    expect((await store.getState())).toMatchObject({
      activeAgentId: 'agent-new',
      taskRunLogs: [expect.objectContaining({ id: 'run-selection', status: 'completed', resultPreview: 'Done' })]
    })
    expect(createAgentPlatformRepositories(database).activeSelection.get()).toEqual({ activeAgentId: 'agent-new', activeSessionId: 'session-1' })
    expect((await createAgentSqliteStore(database).getState())).toMatchObject({
      taskRunLogs: [expect.objectContaining({ id: 'run-selection', status: 'completed', resultPreview: 'Done' })]
    })
    expect(initial.activeAgentId).toBe('agent-1')
  })

  it('serializes a focused run patch with an ordinary message write in either order', async () => {
    for (const order of ['run-first', 'message-first'] as const) {
      const database = createAgentPlatformDatabase(':memory:')
      const store = createAgentSqliteStore(database, seed())
      await store.getState()
      if (!store.upsertTaskRunLog || !store.patchTaskRunLog) throw new Error('Expected SQLite run-log writer.')
      await store.upsertTaskRunLog({
        id: `run-message-${order}`, scheduleId: 'task-message', agentId: 'agent-1', taskNameSnapshot: 'Message task',
        startedAt: createdAt, durationMs: 0, status: 'running'
      })
      const patchRun = () => store.patchTaskRunLog!(`run-message-${order}`, { status: 'completed', resultPreview: order })
      const writeMessage = () => store.update((state) => ({
        ...state,
        messagesBySessionId: {
          ...state.messagesBySessionId,
          'session-1': [
            ...(state.messagesBySessionId['session-1'] ?? []),
            {
              id: `message-${order}`,
              sessionId: 'session-1', role: 'assistant', data: { parts: [{ type: 'text', text: order }] },
              searchableText: order, status: 'success', modelId: null, modelSnapshot: null, stats: null,
              runtimeResumeToken: null, createdAt, updatedAt: createdAt
            }
          ]
        }
      }))
      await Promise.all(order === 'run-first' ? [patchRun(), writeMessage()] : [writeMessage(), patchRun()])
      const reloaded = await createAgentSqliteStore(database).getState()
      expect(reloaded.taskRunLogs).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: `run-message-${order}`, status: 'completed', resultPreview: order })
      ]))
      expect(reloaded.messagesBySessionId['session-1']).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: `message-${order}` })
      ]))
    }
  })

  it('keeps command-authoritative task definitions and subscriptions across ordinary stale state replacements', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    seedRuntimeReadyChannel(database, 'channel-1')
    await store.update((state) => ({
      ...state,
      agents: state.agents.map((item) => ({ ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } })),
      tasks: [{
        id: 'task-command', agentId: 'agent-1', name: 'Old task', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
        timeoutMinutes: 2, workspace: { type: 'system' }, channelIds: ['channel-1'], enabled: true, status: 'active', revision: 1,
        provenance: { createdBy: 'user' }, createdAt, updatedAt: createdAt
      }],
      channelTaskSubscriptions: [{ channelId: 'channel-1', taskId: 'task-command' }]
    }), { taskRowsOnly: true })
    const staleState = await store.getState()
    const commands = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'balanced' })
    await commands.execute({
      type: 'update', actor: { kind: 'user', source: 'renderer-settings' }, agentId: 'agent-1', taskId: 'task-command', expectedRevision: 1,
      patch: { name: 'New task' }
    })

    await store.replace({ ...staleState, tasks: [], channelTaskSubscriptions: [] })
    await store.update((state) => ({
      ...state,
      messagesBySessionId: { ...state.messagesBySessionId },
      tasks: staleState.tasks,
      channelTaskSubscriptions: staleState.channelTaskSubscriptions
    }))

    expect(repos.tasks.get('task-command')).toEqual(expect.objectContaining({ name: 'New task', revision: 2 }))
    expect(repos.channelTaskSubscriptions.listByTaskId('task-command')).toEqual([{ channelId: 'channel-1', taskId: 'task-command' }])
    expect((await store.getState()).tasks).toEqual([expect.objectContaining({ id: 'task-command', name: 'New task', revision: 2 })])
    expect((await createAgentSqliteStore(database).getState()).tasks).toEqual([
      expect.objectContaining({ id: 'task-command', name: 'New task', revision: 2 })
    ])
    expect(repos.taskMutationAudits.listByTask('task-command', { limit: 10, offset: 0 }).audits).toEqual([
      expect.objectContaining({ outcome: 'accepted', resultRevision: 2 })
    ])
  })

  it.each(['command-first', 'message-first'] as const)(
    'serializes %s task command and ordinary message write without losing either result',
    async (order) => {
      const database = createAgentPlatformDatabase(':memory:')
      const repos = createAgentPlatformRepositories(database)
      const store = createAgentSqliteStore(database, seed())
      await store.getState()
      await store.update((state) => ({
        ...state,
        agents: state.agents.map((item) => ({ ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } })),
        tasks: [{
          id: 'task-command-concurrent', agentId: 'agent-1', name: 'Before command', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
          timeoutMinutes: 2, workspace: { type: 'system' }, enabled: true, status: 'active', revision: 1,
          provenance: { createdBy: 'user' }, createdAt, updatedAt: createdAt
        }]
      }), { taskRowsOnly: true })
      const commands = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'balanced' })
      const runCommand = () => commands.execute({
        type: 'update', actor: { kind: 'user', source: 'renderer-settings' }, agentId: 'agent-1',
        taskId: 'task-command-concurrent', expectedRevision: 1, patch: { name: 'After command' }
      })
      const writeMessage = () => store.update((state) => ({
        ...state,
        messagesBySessionId: {
          ...state.messagesBySessionId,
          'session-1': [
            ...(state.messagesBySessionId['session-1'] ?? []),
            {
              id: `message-command-${order}`, sessionId: 'session-1', role: 'assistant',
              data: { parts: [{ type: 'text', text: order }] }, searchableText: order, status: 'success',
              modelId: null, modelSnapshot: null, stats: null, runtimeResumeToken: null, createdAt, updatedAt: createdAt
            }
          ]
        }
      }))
      await Promise.all(order === 'command-first' ? [runCommand(), writeMessage()] : [writeMessage(), runCommand()])

      expect(repos.tasks.get('task-command-concurrent')).toMatchObject({ name: 'After command', revision: 2 })
      expect((await store.getState()).messagesBySessionId['session-1']).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: `message-command-${order}` })
      ]))
      expect((await createAgentSqliteStore(database).getState()).messagesBySessionId['session-1']).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: `message-command-${order}` })
      ]))
    }
  )

  it('writes a failure-circuit runtime transition with a matching audit while keeping run completion metadata unaudited', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    await store.update((state) => ({
      ...state,
      tasks: [{
        id: 'task-runtime', agentId: 'agent-1', name: 'Runtime task', prompt: 'Run', trigger: { kind: 'once', at: Date.parse('2026-01-02T00:00:00.000Z') },
        timeoutMinutes: 2, workspace: { type: 'system' }, enabled: true, status: 'active', revision: 1,
        provenance: { createdBy: 'user' }, createdAt, updatedAt: createdAt
      }, {
        id: 'task-failure-circuit', agentId: 'agent-1', name: 'Failure task', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
        timeoutMinutes: 2, workspace: { type: 'system' }, enabled: true, status: 'active', revision: 1,
        provenance: { createdBy: 'user' }, createdAt, updatedAt: createdAt
      }]
    }), { taskRowsOnly: true })
    if (!store.recordRuntimeTaskRun || !store.pauseTaskForFailureCircuit) throw new Error('Expected SQLite runtime task writer.')

    await store.recordRuntimeTaskRun('task-runtime', { startedAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:01.000Z' })
    expect(repos.tasks.get('task-runtime')).toMatchObject({ status: 'completed', lastRun: '2026-01-02T00:00:00.000Z', revision: 1 })
    expect(repos.taskMutationAudits.listByTask('task-runtime', { limit: 10, offset: 0 }).total).toBe(0)

    await store.pauseTaskForFailureCircuit('task-failure-circuit', '2026-01-02T00:00:02.000Z')
    expect(repos.tasks.get('task-failure-circuit')).toMatchObject({ enabled: false, status: 'paused', pauseReason: 'failure-circuit', revision: 2 })
    expect(repos.taskMutationAudits.listByTask('task-failure-circuit', { limit: 10, offset: 0 }).audits).toEqual([
      expect.objectContaining({
        action: 'runtime-transition',
        actor: { kind: 'runtime', source: 'failure-circuit' },
        resultRevision: 2,
        outcome: 'accepted'
      })
    ])
  })

  it('rejects generic Channel row writes before task subscriptions can use them', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    await store.update((state) => ({
      ...state,
      agents: state.agents.map((item) => ({ ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } })),
      tasks: [{
        id: 'task-channel-command', agentId: 'agent-1', name: 'Channel task', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
        timeoutMinutes: 2, workspace: { type: 'system' }, channelIds: [], enabled: true, status: 'active', revision: 1,
        provenance: { createdBy: 'user' }, createdAt, updatedAt: createdAt
      }]
    }), { taskRowsOnly: true })
    await expect(store.update((state) => ({
      ...state,
      channels: [
        ...state.channels,
        {
          id: 'channel-other', type: 'telegram', name: 'Other', agentId: 'agent-2', workspace: { type: 'system' }, config: { bot_token: 'foreign' },
          isActive: true, createdAt, updatedAt: createdAt
        }
      ]
    }), { channelRowsOnly: true })).rejects.toThrow('channel-legacy-write-rejected')
    const services = createAgentPlatformServices(store)

    await expect(services.channels.subscribeToTask('channel-other', 'task-channel-command')).rejects.toMatchObject({ code: 'task-channel-ineligible' })
    expect(repos.tasks.get('task-channel-command')).toMatchObject({ channelIds: [], revision: 1 })
    expect(repos.channelTaskSubscriptions.listByTaskId('task-channel-command')).toEqual([])
    expect(repos.taskMutationAudits.listByTask('task-channel-command', { limit: 10, offset: 0 }).total).toBe(1)
  })

  it.skip('rejects a stale concurrent channel subscription through the same command revision gate', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    await store.update((state) => ({
      ...state,
      agents: state.agents.map((item) => ({ ...item, configuration: { ...item.configuration, permission_mode: 'bypassPermissions' } })),
      tasks: [{
        id: 'task-subscription-race', agentId: 'agent-1', name: 'Before', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
        timeoutMinutes: 2, workspace: { type: 'system' }, channelIds: [], enabled: true, status: 'active', revision: 1,
        provenance: { createdBy: 'user' }, createdAt, updatedAt: createdAt
      }]
    }), { taskRowsOnly: true })

    let policyRequests = 0
    let resolvePolicy: ((preset: 'balanced') => void) | undefined
    let resolveEntered: (() => void) | undefined
    const policyGate = new Promise<'balanced'>((resolve) => { resolvePolicy = resolve })
    const bothCommandsEntered = new Promise<void>((resolve) => { resolveEntered = resolve })
    const services = createAgentPlatformServices(store, {
      taskAutomation: {
        getPolicyPreset: async () => {
          policyRequests += 1
          if (policyRequests === 2) resolveEntered?.()
          return policyGate
        }
      }
    })

    const update = services.tasks.update('agent-1', 'task-subscription-race', {
      expectedRevision: 1,
      patch: { name: 'After' }
    })
    const subscribe = services.channels.subscribeToTask('channel-1', 'task-subscription-race')
    await bothCommandsEntered
    resolvePolicy?.('balanced')

    const outcomes = await Promise.allSettled([update, subscribe])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'task-revision-conflict' }) })
    ])
    expect(repos.tasks.get('task-subscription-race')).toMatchObject({ name: 'After', channelIds: [], revision: 2 })
    expect(repos.channelTaskSubscriptions.listByTaskId('task-subscription-race')).toEqual([])
    expect(repos.taskMutationAudits.listByTask('task-subscription-race', { limit: 10, offset: 0 }).audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'update', outcome: 'accepted', resultRevision: 2 }),
      expect.objectContaining({ action: 'update', outcome: 'rejected', errorCode: 'task-revision-conflict' })
    ]))
  })

  it.skip.each([
    { label: 'completed', status: 'completed' as const, enabled: false, permissionMode: 'default' as const },
    { label: 'paused', status: 'paused' as const, enabled: false, permissionMode: 'default' as const },
    { label: 'autonomy-disabled active', status: 'active' as const, enabled: true, permissionMode: 'default' as const }
  ])('removes a channel relation from a %s task without changing its lifecycle', async ({ status, enabled, permissionMode }) => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    await store.update((state) => ({
      ...state,
      agents: state.agents.map((agent) => ({ ...agent, configuration: { ...agent.configuration, permission_mode: permissionMode } })),
      tasks: [{
        id: `task-channel-${status}`, agentId: 'agent-1', name: `Channel ${status}`, prompt: 'Run',
        trigger: { kind: 'interval', ms: 5 * 60_000 }, timeoutMinutes: 2, workspace: { type: 'system' },
        channelIds: ['channel-1'], enabled, status, revision: 1, provenance: { createdBy: 'user' }, createdAt, updatedAt: createdAt
      }],
      channelTaskSubscriptions: [{ channelId: 'channel-1', taskId: `task-channel-${status}` }]
    }), { taskRowsOnly: true })

    const services = createAgentPlatformServices(store)
    await expect(services.channels.delete('channel-1')).resolves.toBe(true)

    expect(repos.channels.listAll().find((channel) => channel.id === 'channel-1')).toBeUndefined()
    expect(repos.tasks.get(`task-channel-${status}`)).toMatchObject({
      channelIds: [], status, enabled, revision: 2
    })
    expect(repos.channelTaskSubscriptions.listByTaskId(`task-channel-${status}`)).toEqual([])
    expect(repos.taskMutationAudits.listByTask(`task-channel-${status}`, { limit: 10, offset: 0 }).audits).toEqual([
      expect.objectContaining({ action: 'channel-delete-cleanup', outcome: 'accepted', resultRevision: 2 })
    ])
  })

  it.skip('rolls back all channel relation cleanups when a later cleanup audit fails', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    await store.update((state) => ({
      ...state,
      agents: state.agents.map((agent) => ({ ...agent, configuration: { ...agent.configuration, permission_mode: 'bypassPermissions' } })),
      tasks: ['task-channel-a', 'task-channel-b'].map((id) => ({
        id, agentId: 'agent-1', name: id, prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
        timeoutMinutes: 2, workspace: { type: 'system' }, channelIds: ['channel-1'], enabled: true, status: 'active' as const,
        revision: 1, provenance: { createdBy: 'user' as const }, createdAt, updatedAt: createdAt
      })),
      channelTaskSubscriptions: [
        { channelId: 'channel-1', taskId: 'task-channel-a' },
        { channelId: 'channel-1', taskId: 'task-channel-b' }
      ]
    }), { taskRowsOnly: true })
    database.connection.exec(`
      create trigger reject_second_channel_cleanup_audit
      before insert on agent_task_mutation_audits
      when new.task_id = 'task-channel-b' and new.outcome = 'accepted'
      begin
        select raise(abort, 'channel-cleanup-audit-failed');
      end;
    `)

    const services = createAgentPlatformServices(store)
    await expect(services.channels.delete('channel-1')).rejects.toThrow('channel-cleanup-audit-failed')

    for (const taskId of ['task-channel-a', 'task-channel-b']) {
      expect(repos.tasks.get(taskId)).toMatchObject({ channelIds: ['channel-1'], revision: 1 })
      expect(repos.channelTaskSubscriptions.listByTaskId(taskId)).toEqual([{ channelId: 'channel-1', taskId }])
      expect(repos.taskMutationAudits.listByTask(taskId, { limit: 10, offset: 0 }).total).toBe(0)
    }
    expect(repos.channels.listAll().find((channel) => channel.id === 'channel-1')).toBeDefined()
  })

  it.skip('rolls back all channel relation cleanups when one associated task has a stale revision', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    await store.update((state) => ({
      ...state,
      tasks: ['task-channel-stale-a', 'task-channel-stale-b'].map((id) => ({
        id, agentId: 'agent-1', name: id, prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
        timeoutMinutes: 2, workspace: { type: 'system' }, channelIds: ['channel-1'], enabled: true, status: 'active' as const,
        revision: 1, provenance: { createdBy: 'user' as const }, createdAt, updatedAt: createdAt
      })),
      channelTaskSubscriptions: [
        { channelId: 'channel-1', taskId: 'task-channel-stale-a' },
        { channelId: 'channel-1', taskId: 'task-channel-stale-b' }
      ]
    }), { taskRowsOnly: true })
    if (!store.transactChannelDeletionMutation) throw new Error('Expected SQLite channel deletion transaction.')
    const taskCommands = new TaskAutomationCommandService({ store, getPolicyPreset: async () => 'balanced' })

    await expect(store.transactChannelDeletionMutation({
      channelId: 'channel-1',
      mutate: (state) => ({
        ...taskCommands.prepareChannelDeleteCleanup(state, {
          channelId: 'channel-1',
          actor: { kind: 'user', source: 'renderer-agent-drawer' },
          expectedRevisionByTaskId: new Map([
            ['task-channel-stale-a', 1],
            ['task-channel-stale-b', 0]
          ])
        }),
        result: true
      })
    })).rejects.toMatchObject({ code: 'task-revision-conflict' })

    for (const taskId of ['task-channel-stale-a', 'task-channel-stale-b']) {
      expect(repos.tasks.get(taskId)).toMatchObject({ channelIds: ['channel-1'], revision: 1 })
      expect(repos.channelTaskSubscriptions.listByTaskId(taskId)).toEqual([{ channelId: 'channel-1', taskId }])
      expect(repos.taskMutationAudits.listByTask(taskId, { limit: 10, offset: 0 }).total).toBe(0)
    }
    expect(repos.channels.listAll().find((channel) => channel.id === 'channel-1')).toBeDefined()
  })

  it.skip('rolls back all channel relation cleanups when the final channel delete fails', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    await store.update((state) => ({
      ...state,
      agents: state.agents.map((agent) => ({ ...agent, configuration: { ...agent.configuration, permission_mode: 'bypassPermissions' } })),
      tasks: ['task-channel-delete-a', 'task-channel-delete-b'].map((id) => ({
        id, agentId: 'agent-1', name: id, prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
        timeoutMinutes: 2, workspace: { type: 'system' }, channelIds: ['channel-1'], enabled: true, status: 'active' as const,
        revision: 1, provenance: { createdBy: 'user' as const }, createdAt, updatedAt: createdAt
      })),
      channelTaskSubscriptions: [
        { channelId: 'channel-1', taskId: 'task-channel-delete-a' },
        { channelId: 'channel-1', taskId: 'task-channel-delete-b' }
      ]
    }), { taskRowsOnly: true })
    database.connection.exec(`
      create trigger reject_channel_delete
      before delete on agent_channels
      when old.id = 'channel-1'
      begin
        select raise(abort, 'channel-delete-failed');
      end;
    `)

    const services = createAgentPlatformServices(store)
    await expect(services.channels.delete('channel-1')).rejects.toThrow('channel-delete-failed')

    for (const taskId of ['task-channel-delete-a', 'task-channel-delete-b']) {
      expect(repos.tasks.get(taskId)).toMatchObject({ channelIds: ['channel-1'], revision: 1 })
      expect(repos.channelTaskSubscriptions.listByTaskId(taskId)).toEqual([{ channelId: 'channel-1', taskId }])
      expect(repos.taskMutationAudits.listByTask(taskId, { limit: 10, offset: 0 }).total).toBe(0)
    }
    expect(repos.channels.listAll().find((channel) => channel.id === 'channel-1')).toBeDefined()
  })

  it.skip('keeps SQLite channel rows authoritative across ordinary stale state replacements', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    const initial = await store.getState()

    await store.replace({ ...initial, channels: [] })
    await store.replace({
      ...initial,
      channels: initial.channels.map((channel) => ({ ...channel, name: 'Tampered channel', isActive: false }))
    })

    expect(repos.channels.listAll().find((channel) => channel.id === 'channel-1')).toMatchObject({ name: 'Telegram', isActive: true })
    expect((await store.getState()).channels).toEqual([expect.objectContaining({ id: 'channel-1', name: 'Telegram', isActive: true })])
    expect((await createAgentSqliteStore(database).getState()).channels).toEqual([
      expect.objectContaining({ id: 'channel-1', name: 'Telegram', isActive: true })
    ])
  })

  it('rejects focused legacy Channel row writes without rebuilding tasks or sessions', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    repos.tasks.upsert({
      id: 'task-1',
      agentId: 'agent-1',
      name: 'Existing Task',
      prompt: 'Run existing task',
      trigger: { kind: 'interval', ms: 60_000 },
      catchUpPolicy: { kind: 'skip-missed' },
      timeoutMinutes: 2,
      workspace: { type: 'system' },
      channelIds: [],
      enabled: true,
      status: 'active',
      createdAt,
      updatedAt: createdAt
    })

    await expect(store.update(
      (current) => ({
        ...current,
        channels: [
          {
            id: 'channel-focused',
            type: 'telegram',
            name: 'Focused Channel',
            agentId: 'agent-1',
            workspace: { type: 'system' },
            config: { bot_token: 'next' },
            isActive: true,
            createdAt,
            updatedAt: '2026-01-02T00:00:00.000Z'
          }
        ]
      }),
      { channelRowsOnly: true }
    )).rejects.toThrow('channel-legacy-write-rejected')

    expect(repos.channels.listAll()).toEqual([])
    expect(repos.tasks.listAll().map((task) => task.id)).toContain('task-1')
    expect(listPersistedSessionIds(repos)).toContain('session-1')
  })

  it('rejects a channel row-only state write before it can mutate subscriptions', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    const task = {
      id: 'task-channel-delete',
      agentId: 'agent-1',
      name: 'Channel Delete Task',
      prompt: 'Run with channel',
      trigger: { kind: 'interval', ms: 60_000 },
      catchUpPolicy: { kind: 'skip-missed' },
      timeoutMinutes: 2,
      workspace: { type: 'system' },
      channelIds: ['channel-1'],
      enabled: true,
      status: 'active',
      createdAt,
      updatedAt: createdAt
    } satisfies ScheduledTaskEntity

    await store.update(
      (current) => ({
        ...current,
        tasks: [task],
        channelTaskSubscriptions: [{ channelId: 'channel-1', taskId: task.id }]
      }),
      { taskRowsOnly: true }
    )

    await expect(store.update(
      (current) => ({
        ...current,
        channels: [],
        tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, channelIds: [] } : item)),
        channelTaskSubscriptions: []
      }),
      { channelRowsOnly: true }
    )).rejects.toThrow('channel-legacy-write-rejected')

    expect(repos.channels.listAll()).toEqual([])
    expect(repos.channelTaskSubscriptions.listByChannelId('channel-1')).toEqual([{ channelId: 'channel-1', taskId: task.id }])
    expect(repos.tasks.listAll().find((item) => item.id === task.id)?.channelIds).toEqual(['channel-1'])
    expect(listPersistedSessionIds(repos)).toContain('session-1')
  })

  it('does not let a focused subscription state write bypass task command mutation', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(database)
    const store = createAgentSqliteStore(database, seed())
    await store.getState()
    repos.tasks.upsert({
      id: 'task-1',
      agentId: 'agent-1',
      name: 'Existing Task',
      prompt: 'Run existing task',
      trigger: { kind: 'interval', ms: 60_000 },
      catchUpPolicy: { kind: 'skip-missed' },
      timeoutMinutes: 2,
      workspace: { type: 'system' },
      channelIds: [],
      enabled: true,
      status: 'active',
      createdAt,
      updatedAt: createdAt
    })

    await store.update(
      (current) => ({
        ...current,
        tasks: current.tasks.map((task) => (task.id === 'task-1' ? { ...task, channelIds: ['channel-1'] } : task)),
        channelTaskSubscriptions: [{ channelId: 'channel-1', taskId: 'task-1' }]
      }),
      { channelTaskSubscriptionRowsOnly: true }
    )

    expect(repos.channelTaskSubscriptions.listByTaskId('task-1')).toEqual([])
    expect(repos.tasks.get('task-1')?.channelIds).toEqual([])
    expect(repos.channels.listAll()).toEqual([])
    expect(listPersistedSessionIds(repos)).toContain('session-1')
  })
})

function listPersistedSessionIds(repos: ReturnType<typeof createAgentPlatformRepositories>): string[] {
  const workspacesById = new Map(repos.workspaces.listAll().map((workspace) => [workspace.id, workspace]))
  return repos.sessions.listAll(workspacesById).map((session) => session.id)
}

function seedRuntimeReadyChannel(
  database: ReturnType<typeof createAgentPlatformDatabase>,
  id: string,
  agentId = 'agent-1'
): void {
  database.connection.prepare(
    `insert into agent_channels (
      id, adapter_key, name, agent_id, public_config_json, requested_enabled, lifecycle_state,
      credential_health, created_at, updated_at
    ) values (?, 'telegram', 'Runtime channel', ?, '{}', 1, 'enabled', 'configured', ?, ?)`
  ).run(id, agentId, createdAt, createdAt)
}
