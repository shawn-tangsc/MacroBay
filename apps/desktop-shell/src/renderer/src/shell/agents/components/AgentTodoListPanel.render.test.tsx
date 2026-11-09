// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type {
  AgentSessionEntity,
  AgentSessionMessageEntity,
  MessageStatus
} from '@platform/ai/agent-platform/schemas/sessionSchemas'

import AgentTodoListPanel from './AgentTodoListPanel'

const timestamp = '2026-01-01T00:00:00.000Z'

let root: Root | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

/**
 * 这条用例钉的是一个**整窗黑屏**的真事故（用户 2026-11-10 报告：点「生成日报」就黑屏）。
 *
 * 待办面板在没有待办时 `return null`，智能体一开始跑（生成日报就是一个智能体任务）它就出现。
 * `useId()` 原来写在那个提前返回**之后**，于是同一个组件实例上钩子数从 8 变 9，React 抛
 * `Rendered more hooks than during the previous render`，整棵树被卸载 —— 读者看到的是黑屏。
 *
 * 所以这里必须走「隐藏 → 出现」这条路：只渲染出现态是测不到的。
 */
describe('AgentTodoListPanel mounting', () => {
  it('survives the panel appearing mid-run, instead of unmounting the whole tree', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    // 第一帧：只有欢迎语，面板不显示（走 `return null` 那一支）。
    await act(async () => {
      root?.render(createElement(AgentTodoListPanel, {
        agent: agent(),
        messages: [message({ id: 'welcome', role: 'assistant', status: 'success', text: '你好，我已经准备好了。' })],
        session: session()
      }))
    })
    expect(container.querySelector('.agent-todo-panel')).toBeNull()

    // 第二帧：读者发出任务、助手还在跑 —— 面板出现。钩子顺序若变化，这里会抛错。
    await act(async () => {
      root?.render(createElement(AgentTodoListPanel, {
        agent: agent(),
        messages: [
          message({ id: 'user-1', role: 'user', status: 'success', text: '生成这一期日报。' }),
          message({ id: 'assistant-1', role: 'assistant', status: 'pending', text: '' })
        ],
        session: session()
      }))
    })

    const panel = container.querySelector('.agent-todo-panel')
    expect(panel).not.toBeNull()
    // 头部按钮的 aria-controls 必须指向面板里真实存在的那块（`useId` 落到了该落的位置）。
    const header = panel?.querySelector('.agent-todo-header')
    const controls = header?.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    expect(container.querySelector(`#${CSS.escape(controls as string)}`)).not.toBeNull()
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
