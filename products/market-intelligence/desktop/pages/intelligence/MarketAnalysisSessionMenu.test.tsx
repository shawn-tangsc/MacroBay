// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import { MarketAnalysisSessionMenu } from './MarketAnalysisSessionMenu'


let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function session(id: string, name: string, updatedAt: string, originRef?: string): AgentSessionEntity {
  return {
    id,
    agentId: 'crypto-market-analyst',
    name,
    ...(originRef ? { originRef } : {}),
    description: 'market-analysis-conversation',
    workspaceId: 'workspace-1',
    workspace: { id: 'workspace-1', name: 'Workspace', path: '/tmp', type: 'system', orderKey: '0001', createdAt: updatedAt, updatedAt },
    orderKey: '0001',
    createdAt: updatedAt,
    updatedAt
  }
}

it('opens the history list, selects a conversation, and starts a new one', async () => {
  const onNewConversation = vi.fn()
  const onSelectConversation = vi.fn()
  const onDeleteConversation = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(MarketAnalysisSessionMenu, {
      sessions: [session('s-1', '市场解读对话', '2026-10-23T10:00:00.000Z'), session('s-2', '旧会话', '2026-10-22T10:00:00.000Z')],
      currentSessionId: 's-1',
      text: { newChat: '新对话', history: '历史会话', delete: '删除会话', deleteConfirm: '删除这个会话？', cancel: '取消', untitledSession: '未命名会话' },
      onNewConversation,
      onSelectConversation,
      onDeleteConversation
    }))
  })

  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="新对话"]')!.click()
  })
  expect(onNewConversation).toHaveBeenCalledTimes(1)

  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="历史会话"]')!.click()
  })
  const rows = document.querySelectorAll<HTMLButtonElement>('.mi-agent-sessions__select')
  expect(rows).toHaveLength(2)
  await act(async () => { rows[1]!.click() })
  expect(onSelectConversation).toHaveBeenCalledWith('s-2')
  expect(onDeleteConversation).not.toHaveBeenCalled()
})

it('shows one empty state with a create action when no conversation exists', async () => {
  const onNewConversation = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(MarketAnalysisSessionMenu, {
      sessions: [],
      text: { newChat: '新对话', history: '历史会话', delete: '删除会话', deleteConfirm: '删除这个会话？', cancel: '取消', untitledSession: '未命名会话' },
      onNewConversation,
      onSelectConversation: vi.fn(),
      onDeleteConversation: vi.fn()
    }))
  })

  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="历史会话"]')!.click()
  })

  const states = document.querySelectorAll('.state-view')
  expect(states).toHaveLength(1)
  const reason = states[0]!.querySelector('.state-view__reason')!
  expect(reason.getAttribute('data-reason-source')).toBe('product')
  expect(reason.textContent).toBe('还没有历史会话')

  const action = states[0]!.querySelector<HTMLButtonElement>('.state-view__action')!
  expect(action.textContent).toBe('创建')
  await act(async () => action.click())
  expect(onNewConversation).toHaveBeenCalledTimes(1)
})

it('never shows the run id as a conversation name, and marks the current row for assistive tech', async () => {
  // 老的自动会话把运行 id 当名字存下来（name = originRef = mi-ar-<uuid>）。
  // 菜单行照 name 渲染就是把账本编号印给读者；这种行只许显示中性名字。
  const runId = 'mi-ar-96eb9b12-005d-4e07-a61c-a98604a962f6'
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(MarketAnalysisSessionMenu, {
      sessions: [
        session('s-legacy', runId, '2026-10-23T10:00:00.000Z', runId),
        session('s-2', '市场解读对话', '2026-10-22T10:00:00.000Z')
      ],
      currentSessionId: 's-legacy',
      text: { newChat: '新对话', history: '历史会话', delete: '删除会话', deleteConfirm: '删除这个会话？', cancel: '取消', untitledSession: '未命名会话' },
      onNewConversation: vi.fn(),
      onSelectConversation: vi.fn(),
      onDeleteConversation: vi.fn()
    }))
  })

  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="历史会话"]')!.click()
  })

  const rows = [...document.querySelectorAll<HTMLButtonElement>('.mi-agent-sessions__select')]
  const legacyRow = rows.find((row) => row.textContent?.includes('未命名会话'))!
  expect(rows.map((row) => row.textContent).join(' ')).not.toContain('mi-ar-')
  expect(legacyRow).toBeDefined()
  // 整行是一个真按钮（名字 + 时刻 + 选中勾都在里面），可访问名由行内文本给出。
  expect(legacyRow.tagName).toBe('BUTTON')
  expect(legacyRow.textContent).toContain('未命名会话')
  // 选中态不能只靠一个 aria-hidden 的勾：读屏要知道哪一行是当前会话。
  expect(legacyRow.getAttribute('aria-current')).toBe('true')
  expect(rows.find((row) => row.textContent?.includes('市场解读对话'))?.getAttribute('aria-current')).toBeNull()
})
