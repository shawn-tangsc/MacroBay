import { describe, expect, it } from 'vitest'
import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { createAgentStoreState, type AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import { createAgentPlatformServices, type AgentPlatformStateStore } from '@platform/ai/agent-platform/services/agentServices'
import { analysisWorkspacePolicy } from '../../../contracts/analysisWorkspaceContracts'
import { analysisRunSessionPolicy, appendAnalysisRunSummary, createAnalysisRunSession } from './analysisRunSession'

/**
 * 真路径（服务层，不 mock 会话端口）：建 run 会话 → 窄查 → 摘要写回会话。
 *
 * 这条用例钉的是平台层的一个真 bug：`createAgentSession` 建实体时没拷 `payload.originRef`，
 * 于是 `findAgentSessionByAutomationRef` 永远查不到，`appendAnalysisRunSummary` 静默返回——
 * 分析库里 368 条摘要、agent 库里 0 条会话摘要消息，就是这么来的。
 * 红法：平台修好之前，第二条断言直接 `expected [] to have length 1`。
 */

const at = '2026-11-09T00:00:00.000Z'

const agent: AgentEntity = {
  id: analysisRunSessionPolicy.agentId,
  type: 'claude-code',
  name: 'Analyst',
  description: '',
  instructions: '',
  model: 'provider:model-a',
  modelName: 'model-a',
  mcps: [],
  disabledTools: [],
  configuration: {},
  orderKey: 'a',
  createdAt: at,
  updatedAt: at
}

function memoryStore(state: AgentStoreState): AgentPlatformStateStore {
  let current = state
  return { getState: async () => current, update: async (updater) => { current = updater(current); return current }, replace: async (next) => { current = next; return current } }
}

describe('analysis run conversation really persists', () => {
  it('finds the run session by its automation ref and appends the published summary to it', async () => {
    const store = memoryStore(createAgentStoreState({ agents: [agent], sessions: [], workspaces: [], messagesBySessionId: {} }))
    const services = createAgentPlatformServices(store)

    const ensureRunSession = createAnalysisRunSession({
      createAgentSession: (input) => services.sessions.create(input) as Promise<AgentSessionEntity>,
      findAgentSessionByAutomationRef: (agentId, originRef) => services.sessions.findByAutomationRef(agentId, originRef),
      appendAgentSessionMessages: (input) => services.messages.saveMessages(input) as Promise<AgentSessionMessageEntity[]>,
      titleFor: () => '市场分析'
    })
    const runId = 'mi-ar-persistence-1'
    const sessionId = await ensureRunSession({ runId, queuedAt: at })
    expect(sessionId).toBeTruthy()

    // 身份必须真的落进会话：窄查要能按 runId 命中（这就是平台丢 originRef 时的第一处红灯）。
    const found = await services.sessions.findByAutomationRef(analysisRunSessionPolicy.agentId, runId)
    expect(found?.id).toBe(sessionId)

    await appendAnalysisRunSummary({
      appendAgentSessionMessages: (input) => services.messages.saveMessages(input) as Promise<AgentSessionMessageEntity[]>,
      findAgentSessionByAutomationRef: (agentId, originRef) => services.sessions.findByAutomationRef(agentId, originRef)
    })({ runId, summary: '本期结论：资金面转弱。' })

    const state = await store.getState()
    const messages = state.messagesBySessionId[sessionId!] ?? []
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
    expect(messages.find((message) => message.role === 'assistant')?.searchableText).toContain('资金面转弱')

    // 同样的 runId 再 ensure 一次：复用同一条会话，不新增（这是 E5 依赖的窄查语义）。
    const again = await ensureRunSession({ runId, queuedAt: at })
    expect(again).toBe(sessionId)
    expect((await store.getState()).sessions).toHaveLength(1)
  })
})
