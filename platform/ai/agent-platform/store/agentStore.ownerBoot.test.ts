import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentSessionMessageEntity } from '../schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import { addAgentSessionMessage, createAgentStoreState, reconcileStalePendingMessages, type AgentStoreState } from './agentStore'

/**
 * 崩溃收尾的判据是 `ownerBootId`——「这条 pending 是哪一次主进程启动写的」。
 *
 * 四条covering 的是架构师列的四条：
 * ① 上一个批次的 pending → 收；② 本批次的 → 不动；
 * ③ boot 期间刚起的那次运行（本批次、时刻早于收敛那一刻）→ 不动——按时间判会红的就是这条；
 * ④ 没有字段的老消息只在 boot 那一趟收，运行期再跑一次不动它。
 */

const createdAt = '2026-01-01T00:00:00.000Z'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: 'workspace-1',
  createdAt,
  updatedAt: createdAt
}

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Default Agent',
  description: 'General helper',
  instructions: 'You are helpful.',
  model: 'provider:model-a',
  modelName: 'model-a',
  mcps: [],
  disabledTools: [],
  configuration: { avatar: 'A', soul_enabled: true },
  orderKey: 'agent-1',
  createdAt,
  updatedAt: createdAt
}

const session = {
  id: 'session-1',
  agentId: agent.id,
  name: 'Session',
  workspaceId: workspace.id,
  workspace,
  orderKey: 'session-1',
  createdAt,
  updatedAt: createdAt
}

const CURRENT_BOOT = 'boot-current'
const PREVIOUS_BOOT = 'boot-previous'

function pendingMessage(input: Readonly<{
  id: string
  ownerBootId?: string
  text?: string
  createdAt?: string
}>): AgentSessionMessageEntity {
  const at = input.createdAt ?? createdAt
  return {
    id: input.id,
    sessionId: session.id,
    role: 'assistant',
    data: { parts: [{ type: 'text', text: input.text ?? '半截正文' }] },
    searchableText: input.text ?? '半截正文',
    status: 'pending',
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    ...(input.ownerBootId ? { ownerBootId: input.ownerBootId } : {}),
    createdAt: at,
    updatedAt: at
  }
}

function stateWith(messages: readonly AgentSessionMessageEntity[]): AgentStoreState {
  let state = createAgentStoreState({ agents: [agent], sessions: [session], workspaces: [workspace] })
  for (const message of messages) {
    state = addAgentSessionMessage(state, session.id, message)
  }
  return state
}

function messageById(state: AgentStoreState, id: string): AgentSessionMessageEntity | undefined {
  return (state.messagesBySessionId[session.id] ?? []).find((message) => message.id === id)
}

describe('startup convergence judged by ownerBootId', () => {
  it('①收掉上一个进程批次留下的 pending，半截正文保留', () => {
    const next = reconcileStalePendingMessages(
      stateWith([pendingMessage({ id: 'm-previous', ownerBootId: PREVIOUS_BOOT, text: '上个进程收到的半截' })]),
      { ownerBootId: CURRENT_BOOT }
    )

    expect(messageById(next, 'm-previous')).toMatchObject({
      status: 'paused',
      searchableText: '上个进程收到的半截'
    })
  })

  it('②本批次的 pending 一条都不动', () => {
    const state = stateWith([pendingMessage({ id: 'm-current', ownerBootId: CURRENT_BOOT })])
    const next = reconcileStalePendingMessages(state, { ownerBootId: CURRENT_BOOT })

    expect(messageById(next, 'm-current')).toMatchObject({ status: 'pending' })
    // 没有可收的行时状态原样返回（不写回、不刷新 updatedAt）。
    expect(next).toBe(state)
  })

  it('③boot 期间刚起的那次运行（本批次、时刻早于收敛那一刻）不被收掉', () => {
    // 时间判法会红的就是这条：它的 createdAt 早于「现在」，但它属于本进程。
    const bootMoment = '2026-11-09T12:00:00.000Z'
    const state = stateWith([
      pendingMessage({ id: 'm-just-started', ownerBootId: CURRENT_BOOT, createdAt: bootMoment })
    ])
    const next = reconcileStalePendingMessages(state, { ownerBootId: CURRENT_BOOT })

    expect(messageById(next, 'm-just-started')).toMatchObject({ status: 'pending' })
  })

  it('④没有字段的老消息只在 boot 那一趟收；运行期再跑一次不动本批次的新 pending', () => {
    const afterBoot = reconcileStalePendingMessages(
      stateWith([pendingMessage({ id: 'm-legacy' })]),
      { ownerBootId: CURRENT_BOOT }
    )
    expect(messageById(afterBoot, 'm-legacy')).toMatchObject({ status: 'paused' })

    // 运行期又起了一次运行（本批次）；即便有人再把收尾跑一次，也不许动它。
    const runtime = addAgentSessionMessage(afterBoot, session.id, pendingMessage({
      id: 'm-runtime',
      ownerBootId: CURRENT_BOOT
    }))
    const second = reconcileStalePendingMessages(runtime, { ownerBootId: CURRENT_BOOT })

    expect(messageById(second, 'm-runtime')).toMatchObject({ status: 'pending' })
    expect(messageById(second, 'm-legacy')).toMatchObject({ status: 'paused' })
    expect(second).toBe(runtime)
  })
})
