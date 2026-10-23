import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type {
  AgentSessionEntity,
  AgentSessionMessageEntity,
  MessageStatus
} from '@platform/ai/agent-platform/schemas/sessionSchemas'

import { buildTodoItems, shouldShowTodoPanel } from './AgentTodoListPanel'
import { agentText } from '../agentText'

const timestamp = '2026-01-01T00:00:00.000Z'
const todosText = agentText['zh-CN'].todos

describe('AgentTodoListPanel view model', () => {
  it('does not show the task status panel for the seeded welcome message before a user task exists', () => {
    const messages = [
      message({
        id: 'default-assistant-session-welcome',
        role: 'assistant',
        status: 'success',
        text: '你好，我已经准备好了。'
      })
    ]
    const items = buildTodoItems(agent(), session(), messages, todosText)

    expect(items.map((item) => [item.id, item.status])).toEqual([
      ['workspace', 'completed'],
      ['model', 'completed'],
      ['request', 'pending'],
      ['runtime', 'pending']
    ])
    expect(shouldShowTodoPanel(items)).toBe(false)
  })

  it('hides the task status panel after the user has submitted a task and the agent has replied successfully', () => {
    const messages = [
      message({ id: 'user-1', role: 'user', status: 'success', text: '帮我总结这个项目。' }),
      message({ id: 'assistant-1', role: 'assistant', status: 'success', text: '总结完成。' })
    ]
    const items = buildTodoItems(agent(), session(), messages, todosText)

    expect(items.map((item) => [item.id, item.status])).toEqual([
      ['workspace', 'completed'],
      ['model', 'completed'],
      ['request', 'completed'],
      ['runtime', 'completed']
    ])
    expect(shouldShowTodoPanel(items)).toBe(false)
  })

  it('shows the task status panel while an assistant response is pending even before persistence catches up', () => {
    const messages = [
      message({ id: 'assistant-pending', role: 'assistant', status: 'pending', text: '' })
    ]
    const items = buildTodoItems(agent(), session(), messages, todosText)

    expect(items.find((item) => item.id === 'runtime')?.status).toBe('in_progress')
    expect(shouldShowTodoPanel(items)).toBe(true)
  })

  it('shows the task status panel after a user task is submitted while waiting for the assistant turn to start', () => {
    const messages = [
      message({ id: 'user-1', role: 'user', status: 'success', text: '你好' })
    ]
    const items = buildTodoItems(agent(), session(), messages, todosText)

    expect(items.find((item) => item.id === 'runtime')).toMatchObject({
      label: todosText.waitingAgentResponse,
      status: 'pending'
    })
    expect(shouldShowTodoPanel(items)).toBe(true)
  })

  it('ignores stale pending assistant messages once the latest user turn has a completed assistant response', () => {
    const messages = [
      message({
        id: 'assistant-stale-pending',
        role: 'assistant',
        status: 'pending',
        text: '',
        createdAt: '2026-01-01T00:00:00.000Z'
      }),
      message({
        id: 'user-1',
        role: 'user',
        status: 'success',
        text: '你好',
        createdAt: '2026-01-01T00:00:01.000Z'
      }),
      message({
        id: 'assistant-1',
        role: 'assistant',
        status: 'success',
        text: '你好！',
        createdAt: '2026-01-01T00:00:02.000Z'
      })
    ]
    const items = buildTodoItems(agent(), session(), messages, todosText)

    expect(items.find((item) => item.id === 'runtime')).toMatchObject({
      label: todosText.agentResponseCompleted,
      status: 'completed'
    })
    expect(shouldShowTodoPanel(items)).toBe(false)
  })

  it('marks the runtime step as error after a failed assistant response instead of leaving it pending', () => {
    const messages = [
      message({ id: 'user-1', role: 'user', status: 'success', text: '11' }),
      message({
        id: 'assistant-1',
        role: 'assistant',
        status: 'error',
        text: 'Claude Code runtime driver requires a workspace path in runtime composition.'
      })
    ]
    const items = buildTodoItems(agent(), session(), messages, todosText)

    expect(items.find((item) => item.id === 'runtime')).toMatchObject({
      label: todosText.responseNeedsErrorHandling,
      status: 'error'
    })
    expect(shouldShowTodoPanel(items)).toBe(true)
  })

  it('keeps system workspace status as completed even when the internal placeholder path is present', () => {
    const items = buildTodoItems(
      agent(),
      session({
        workspace: {
          id: 'workspace-1',
          name: 'Default Workspace',
          path: '/tmp/agent-system-workspace',
          type: 'system',
          orderKey: '0001',
          createdAt: timestamp,
          updatedAt: timestamp
        }
      }),
      [message({ id: 'user-1', role: 'user', status: 'success', text: '11' })],
      todosText
    )

    expect(items.find((item) => item.id === 'workspace')).toMatchObject({
      label: todosText.systemWorkspace,
      status: 'completed'
    })
  })
})

function agent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return {
    id: 'agent-1',
    type: 'claude-code',
    name: 'Agent',
    description: '',
    instructions: '',
    model: 'silicon:deepseek-ai/DeepSeek-V4-Pro',
    modelName: 'deepseek-ai/DeepSeek-V4-Pro',
    mcps: [],
    disabledTools: [],
    configuration: {},
    orderKey: '0001',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function session(overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    name: 'Session',
    workspaceId: 'workspace-1',
    workspace: {
      id: 'workspace-1',
      name: 'Default Workspace',
      path: '',
      type: 'system',
      orderKey: '0001',
      createdAt: timestamp,
      updatedAt: timestamp
    },
    orderKey: '0001',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function message(input: {
  id: string
  role: AgentSessionMessageEntity['role']
  status: MessageStatus
  text: string
  createdAt?: string
}): AgentSessionMessageEntity {
  return {
    id: input.id,
    sessionId: 'session-1',
    role: input.role,
    data: { parts: [{ type: 'text', text: input.text }] },
    searchableText: input.text,
    status: input.status,
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.createdAt ?? timestamp
  }
}
