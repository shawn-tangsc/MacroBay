import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { createAgentStoreState } from '../../ai/agent-platform/store/agentStore'
import {
  TASK_AUTOMATION_SMOKE_AGENT_ID,
  TASK_AUTOMATION_SMOKE_CREATE_PROMPT,
  TASK_AUTOMATION_SMOKE_RUNTIME_FAILURE_PROMPT,
  createTaskAutomationSmokeDriver,
  createTaskAutomationSmokeSeed
} from './taskAutomationSmokeFixture'

describe('task automation smoke fixture', () => {
  it('seeds generic local task data without channel credentials', () => {
    const seed = createTaskAutomationSmokeSeed('2026-07-17T00:00:00.000Z')

    expect(seed.agents).toEqual([
      expect.objectContaining({
        id: TASK_AUTOMATION_SMOKE_AGENT_ID,
        configuration: expect.objectContaining({ permission_mode: 'bypassPermissions' })
      })
    ])
    expect(JSON.stringify(seed)).not.toContain('http')
    expect(JSON.stringify(seed)).not.toContain('api-key')
  })

  it('contains no real Telegram host or network import', () => {
    const source = readFileSync(new URL('./taskAutomationSmokeFixture.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(/from ['"][^'"]*telegram/i)
    expect(source).not.toMatch(/\b(fetch|WebSocket|https?)\b/)
  })

  it('recognizes only the documented fixture prompt before invoking the shared Agent task tool', async () => {
    let state = createAgentStoreState(createTaskAutomationSmokeSeed('2026-07-17T00:00:00.000Z'))
    const invoke = vi.fn(async () => ({ task: { id: 'tool-created-task' } }))
    const driver = createTaskAutomationSmokeDriver({
      getState: async () => state,
      saveState: async (next) => { state = next },
      taskTools: { invoke }
    })

    await driver.sendMessage({
      agentId: TASK_AUTOMATION_SMOKE_AGENT_ID,
      sessionId: 'task-smoke-session',
      text: 'create a task for me'
    })
    expect(invoke).not.toHaveBeenCalled()

    const result = await driver.sendMessage({
      agentId: TASK_AUTOMATION_SMOKE_AGENT_ID,
      sessionId: 'task-smoke-session',
      text: TASK_AUTOMATION_SMOKE_CREATE_PROMPT
    })

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      agentId: TASK_AUTOMATION_SMOKE_AGENT_ID,
      sessionId: 'task-smoke-session',
      toolCallId: 'task-smoke-tool-create',
      toolName: 'scheduled_task_create'
    }))
    expect(result.assistantMessage.searchableText).toContain('created')
    expect(state.messagesBySessionId['task-smoke-session']).toHaveLength(4)
  })

  it('does not claim tool-created success when the shared task tool returns no task', async () => {
    let state = createAgentStoreState(createTaskAutomationSmokeSeed('2026-07-17T00:00:00.000Z'))
    const driver = createTaskAutomationSmokeDriver({
      getState: async () => state,
      saveState: async (next) => { state = next },
      taskTools: { invoke: vi.fn(async () => ({ task: null })) }
    })

    const result = await driver.sendMessage({
      agentId: TASK_AUTOMATION_SMOKE_AGENT_ID,
      sessionId: 'task-smoke-session',
      text: TASK_AUTOMATION_SMOKE_CREATE_PROMPT
    })

    expect(result.assistantMessage.searchableText).toContain('could not create')
    expect(result.assistantMessage.searchableText).not.toContain('created a local scheduled task')
  })

  it('recognizes an explicitly documented runtime failure command only by exact equality', async () => {
    let state = createAgentStoreState(createTaskAutomationSmokeSeed('2026-07-17T00:00:00.000Z'))
    const driver = createTaskAutomationSmokeDriver({
      getState: async () => state,
      saveState: async (next) => { state = next },
      taskTools: { invoke: vi.fn() }
    })

    await expect(driver.sendMessage({
      agentId: TASK_AUTOMATION_SMOKE_AGENT_ID,
      sessionId: 'task-smoke-session',
      text: `prefix ${TASK_AUTOMATION_SMOKE_RUNTIME_FAILURE_PROMPT}`
    })).resolves.toBeDefined()
    await expect(driver.sendMessage({
      agentId: TASK_AUTOMATION_SMOKE_AGENT_ID,
      sessionId: 'task-smoke-session',
      text: TASK_AUTOMATION_SMOKE_RUNTIME_FAILURE_PROMPT
    })).rejects.toThrow('task-smoke-runtime-failed')
  })

})
