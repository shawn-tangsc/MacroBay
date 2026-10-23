import { describe, expect, it, vi } from 'vitest'

import { AgentTaskDispatchService } from '../../ai/agent-platform/runtime/tasks/AgentTaskDispatchService'
import { AgentTaskExecutionCoordinator } from '../../ai/agent-platform/runtime/tasks/AgentTaskExecutionCoordinator'
import { TaskManagementToolRuntimeService } from '../../ai/agent-platform/runtime/tasks/TaskManagementToolRuntimeService'
import { createAgentPlatformServices } from '../../ai/agent-platform/services'
import { createAgentSqliteStore } from '../../ai/agent-platform/store/agentSqliteStore'
import { createAgentPlatformDatabase } from '../../ai/agent-platform/db/createAgentPlatformDatabase'
import { TASK_AUTOMATION_SMOKE_AGENT_ID, TASK_AUTOMATION_SMOKE_CREATE_PROMPT, createTaskAutomationSmokeDriver, createTaskAutomationSmokeSeed } from './taskAutomationSmokeFixture'

describe('task automation smoke fixture integration', () => {
  it('keeps task execution intact when the task has no channel delivery target', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const store = createAgentSqliteStore(database, createTaskAutomationSmokeSeed('2026-07-17T00:00:00.000Z'))
    const services = createAgentPlatformServices(store)
    let coordinator: AgentTaskExecutionCoordinator
    const taskTools = new TaskManagementToolRuntimeService({
      store, commands: services.taskCommands,
      runTask: async (input) => { const run = await coordinator.enqueueManualRun(input); return { taskId: input.taskId, runLogId: run.id } }
    })
    const driver = createTaskAutomationSmokeDriver({ getState: () => store.getState(), saveState: async (state) => { await store.replace(state) }, taskTools })
    const dispatcher = new AgentTaskDispatchService({ services, runtime: driver })
    coordinator = new AgentTaskExecutionCoordinator({ services, dispatchQueuedRun: (input) => dispatcher.dispatchQueuedRun(input) })

    await driver.sendMessage({ agentId: TASK_AUTOMATION_SMOKE_AGENT_ID, sessionId: 'task-smoke-session', text: TASK_AUTOMATION_SMOKE_CREATE_PROMPT })
    const task = (await store.getState()).tasks.find((item) => item.name === 'Task smoke tool task')
    if (!task) throw new Error('Expected task fixture.')
    const run = await coordinator.enqueueManualRun({ agentId: TASK_AUTOMATION_SMOKE_AGENT_ID, taskId: task.id, expectedRevision: task.revision ?? 1 })
    await vi.waitFor(async () => {
      const runLog = (await store.getState()).taskRunLogs.find((item) => item.id === run.id)
      expect(runLog).toEqual(expect.objectContaining({ status: 'completed' }))
      expect(runLog?.deliverySummary).toBeUndefined()
    })
    database.connection.close()
  })
})
