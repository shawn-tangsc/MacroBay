import { describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '../ipc/channels'
import {
  registerAgentTaskIpcHandlers,
  type AgentTaskIpcHandlers,
  type AgentTaskIpcListener,
  type AgentTaskIpcMain
} from './registerAgentTaskIpcHandlers'

const expectedChannels = [
  IpcChannels.agentsListTasks,
  IpcChannels.agentsGetTaskLogs,
  IpcChannels.agentsPreviewTaskSchedule,
  IpcChannels.agentsListTaskPage,
  IpcChannels.agentsGetTaskDeliveryAttempts,
  IpcChannels.agentsRetryTaskDelivery,
  IpcChannels.agentsListTaskMutationAudits,
  IpcChannels.agentsGetTaskAutomationPolicy,
  IpcChannels.agentsUpdateTaskAutomationPolicy,
  IpcChannels.agentsGetTaskDeliveryReadiness,
  IpcChannels.agentsCreateTask,
  IpcChannels.agentsUpdateTask,
  IpcChannels.agentsDeleteTask,
  IpcChannels.agentsRunTask,
  IpcChannels.agentsCancelTaskRun
].sort()

type HandlerSpies = {
  [K in keyof AgentTaskIpcHandlers]: ReturnType<typeof vi.fn<AgentTaskIpcHandlers[K]>>
}

function createHandlers(): HandlerSpies {
  return {
    listTasks: vi.fn<AgentTaskIpcHandlers['listTasks']>(() => undefined as never),
    getTaskLogs: vi.fn<AgentTaskIpcHandlers['getTaskLogs']>(() => undefined as never),
    previewTaskSchedule: vi.fn<AgentTaskIpcHandlers['previewTaskSchedule']>(() => undefined as never),
    listTaskPage: vi.fn<AgentTaskIpcHandlers['listTaskPage']>(() => undefined as never),
    getTaskDeliveryAttempts: vi.fn<AgentTaskIpcHandlers['getTaskDeliveryAttempts']>(
      () => undefined as never
    ),
    retryTaskDelivery: vi.fn<AgentTaskIpcHandlers['retryTaskDelivery']>(() => ({ delivered: 1 }) as never),
    listTaskMutationAudits: vi.fn<AgentTaskIpcHandlers['listTaskMutationAudits']>(
      () => undefined as never
    ),
    getTaskAutomationPolicy: vi.fn<AgentTaskIpcHandlers['getTaskAutomationPolicy']>(
      () => undefined as never
    ),
    updateTaskAutomationPolicy: vi.fn<AgentTaskIpcHandlers['updateTaskAutomationPolicy']>(
      () => undefined as never
    ),
    getTaskDeliveryReadiness: vi.fn<AgentTaskIpcHandlers['getTaskDeliveryReadiness']>(
      () => undefined as never
    ),
    createTask: vi.fn<AgentTaskIpcHandlers['createTask']>(() => ({ id: 'task-1' }) as never),
    updateTask: vi.fn<AgentTaskIpcHandlers['updateTask']>(() => ({ id: 'task-1' }) as never),
    deleteTask: vi.fn<AgentTaskIpcHandlers['deleteTask']>(() => ({ id: 'task-1' }) as never),
    runTask: vi.fn<AgentTaskIpcHandlers['runTask']>(() => ({ runLogId: 'run-1' }) as never),
    cancelTaskRun: vi.fn<AgentTaskIpcHandlers['cancelTaskRun']>(
      () => ({ runLogId: 'run-1', cancelled: true }) as never
    )
  } satisfies AgentTaskIpcHandlers
}

function createRegistration(afterCommit: () => Promise<void> | void = vi.fn()) {
  const listeners = new Map<string, AgentTaskIpcListener>()
  const ipcMain: AgentTaskIpcMain = {
    handle(channel, listener) {
      listeners.set(channel, listener)
    }
  }
  const handlers = createHandlers()
  registerAgentTaskIpcHandlers(ipcMain, handlers, {
    getScheduleValidationOptions: () => ({
      now: new Date('2026-01-02T00:00:00.000Z'),
      defaultTimezone: 'UTC'
    }),
    afterCommit
  })
  return { afterCommit, handlers, listeners }
}

async function invoke(
  listeners: Map<string, AgentTaskIpcListener>,
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const listener = listeners.get(channel)
  if (!listener) throw new Error(`Missing listener for ${channel}`)
  return listener({}, ...args)
}

const validCreateInput = {
  name: 'Task name',
  prompt: 'Task prompt',
  trigger: { kind: 'interval', ms: 300_000 },
  workspace: { type: 'system' }
}

describe('registerAgentTaskIpcHandlers', () => {
  it('registers exactly the Task IPC channels', () => {
    const { listeners } = createRegistration()

    expect([...listeners.keys()].sort()).toEqual(expectedChannels)
  })

  it('keeps create and run successes when afterCommit throws', async () => {
    const afterCommit = vi.fn(async () => {
      throw new Error('scheduler notification failed')
    })
    const { handlers, listeners } = createRegistration(afterCommit)

    await expect(
      invoke(listeners, IpcChannels.agentsCreateTask, 'agent-1', validCreateInput)
    ).resolves.toEqual({ ok: true, data: { id: 'task-1' } })
    await expect(
      invoke(listeners, IpcChannels.agentsRunTask, 'agent-1', 'task-1', { expectedRevision: 1 })
    ).resolves.toEqual({ ok: true, data: { runLogId: 'run-1' } })

    expect(handlers.createTask).toHaveBeenCalledTimes(1)
    expect(handlers.runTask).toHaveBeenCalledTimes(1)
    expect(afterCommit).toHaveBeenCalledTimes(2)
  })

  it('does not commit after raw service or validation failures', async () => {
    const afterCommit = vi.fn()
    const { handlers, listeners } = createRegistration(afterCommit)
    const rawFailure = new Error('secret /private/path')
    handlers.createTask.mockImplementation(() => {
      throw rawFailure
    })
    handlers.runTask.mockImplementation(() => {
      throw rawFailure
    })

    const createFailure = await invoke(
      listeners,
      IpcChannels.agentsCreateTask,
      'agent-1',
      validCreateInput
    )
    const runFailure = await invoke(
      listeners,
      IpcChannels.agentsRunTask,
      'agent-1',
      'task-1',
      { expectedRevision: 1 }
    )
    const pastOnceFailure = await invoke(listeners, IpcChannels.agentsCreateTask, 'agent-1', {
      ...validCreateInput,
      trigger: { kind: 'once', at: Date.UTC(2026, 0, 1) }
    })

    expect(createFailure).toEqual({ ok: false, error: { code: 'task-internal-error' } })
    expect(runFailure).toEqual({ ok: false, error: { code: 'task-internal-error' } })
    expect(pastOnceFailure).toEqual({ ok: false, error: { code: 'task-schedule-invalid' } })
    expect(JSON.stringify([createFailure, runFailure])).not.toContain('secret')
    expect(JSON.stringify([createFailure, runFailure])).not.toContain('/private/path')
    expect(handlers.createTask).toHaveBeenCalledTimes(1)
    expect(handlers.runTask).toHaveBeenCalledTimes(1)
    expect(afterCommit).not.toHaveBeenCalled()
  })

  it('uses the shared mutation wrapper for update, delete, and cancel but not policy updates', async () => {
    const afterCommit = vi.fn()
    const { handlers, listeners } = createRegistration(afterCommit)
    handlers.updateTask.mockImplementation(() => ({ id: 'task-1' }) as never)
    handlers.deleteTask.mockImplementation(() => ({ id: 'task-1' }) as never)
    handlers.cancelTaskRun.mockImplementation(() => ({ runLogId: 'run-1', cancelled: true }) as never)
    handlers.updateTaskAutomationPolicy.mockImplementation(() => ({ policyPreset: 'conservative' }) as never)

    await expect(
      invoke(listeners, IpcChannels.agentsUpdateTask, 'agent-1', 'task-1', {
        expectedRevision: 1,
        patch: { name: 'next' }
      })
    ).resolves.toEqual({ ok: true, data: { id: 'task-1' } })
    await expect(
      invoke(listeners, IpcChannels.agentsDeleteTask, 'agent-1', 'task-1', { expectedRevision: 1 })
    ).resolves.toEqual({ ok: true, data: { id: 'task-1' } })
    await expect(invoke(listeners, IpcChannels.agentsCancelTaskRun, 'run-1')).resolves.toEqual({
      ok: true,
      data: { runLogId: 'run-1', cancelled: true }
    })
    await expect(invoke(listeners, IpcChannels.agentsRetryTaskDelivery, 'agent-1', 'run-1', 'attempt-1')).resolves.toEqual({
      ok: true,
      data: { delivered: 1 }
    })
    await expect(
      invoke(listeners, IpcChannels.agentsUpdateTaskAutomationPolicy, {
        policyPreset: 'conservative'
      })
    ).resolves.toEqual({ ok: true, data: { policyPreset: 'conservative' } })

    expect(handlers.updateTask).toHaveBeenCalledWith('agent-1', 'task-1', {
      expectedRevision: 1,
      patch: { name: 'next' }
    })
    expect(handlers.deleteTask).toHaveBeenCalledWith('agent-1', 'task-1', { expectedRevision: 1 })
    expect(handlers.cancelTaskRun).toHaveBeenCalledWith('run-1')
    expect(handlers.retryTaskDelivery).toHaveBeenCalledWith('agent-1', 'run-1', 'attempt-1')
    expect(handlers.updateTaskAutomationPolicy).toHaveBeenCalledWith({ policyPreset: 'conservative' })
    expect(afterCommit).toHaveBeenCalledTimes(4)
  })
})
