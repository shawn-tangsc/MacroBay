// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import { MarketAnalysisSessionMenu } from './MarketAnalysisSessionMenu'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function session(id: string, name: string, updatedAt: string): AgentSessionEntity {
  return {
    id,
    agentId: 'crypto-market-analyst',
    name,
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
      text: { newChat: '新对话', history: '历史会话', delete: '删除会话', deleteConfirm: '删除这个会话？', cancel: '取消', empty: '还没有历史会话' },
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
