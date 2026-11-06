import { describe, expect, it, vi } from 'vitest'

import { appendAnalysisRunSummary, createAnalysisRunSession } from './analysisRunSession'

function harness() {
  const sessions: { id: string; agentId: string | null; description?: string }[] = []
  const createAgentSession = vi.fn(async (input: { agentId: string; description?: string }) => {
    const session = { id: `s-${sessions.length + 1}`, agentId: input.agentId, description: input.description }
    sessions.push(session)
    return session
  })
  const appendAgentSessionMessages = vi.fn(async (_input: { sessionId: string; messages: readonly unknown[] }) => undefined)
  const ensure = createAnalysisRunSession({
    getAgentState: async () => ({ sessions: [...sessions] }),
    createAgentSession: createAgentSession as never,
    appendAgentSessionMessages: appendAgentSessionMessages as never
  })
  const appendRunSummary = appendAnalysisRunSummary({
    getAgentState: async () => ({ sessions: [...sessions] }),
    appendAgentSessionMessages: appendAgentSessionMessages as never
  })
  return { ensure, appendRunSummary, createAgentSession, appendAgentSessionMessages, sessions }
}

describe('the analysis run session', () => {
  it('creates one session on the fixed agent and reuses it for the same run', async () => {
    const { ensure, createAgentSession } = harness()
    expect(await ensure({ runId: 'mi-ar-1' })).toBe('s-1')
    // 同一次分析重跑：不新建第二条。
    expect(await ensure({ runId: 'mi-ar-1' })).toBe('s-1')
    expect(createAgentSession).toHaveBeenCalledTimes(1)
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      // 建在固定智能体下，不读「当前选中项」，否则侧栏那块永远凑不齐。
      agentId: 'crypto-market-analyst',
      description: 'market-analysis-run:mi-ar-1',
      origin: 'automation',
      // 分组键恒定；幂等键是这一次运行，只有它一个含义。
      originGroup: 'market-analysis',
      originRef: 'mi-ar-1'
    }))
  })

  it('writes the context card and the summary, and never the prompt or the answer', async () => {
    const { ensure, appendAgentSessionMessages } = harness()
    await ensure({ runId: 'mi-ar-2', summary: 'BTC 持仓骤降' })
    const call = appendAgentSessionMessages.mock.calls[0]![0] as unknown as { messages: { role: string; content: string }[] }
    expect(call.messages).toHaveLength(2)
    // 上下文卡片是 agent-context 部件，payload 只带 runId；正文里没有内部标识。
    expect(call.messages[0]).toMatchObject({
      role: 'system',
      data: { parts: [{ type: 'agent-context', kind: 'market-analysis-run', payload: { runId: 'mi-ar-2' } }] }
    })
    expect(JSON.stringify(call.messages)).not.toContain('market-analysis-run:')
    // 原文只存在 mi_analysis_io，会话只放 runId；这里不该出现提示词或模型原文。
    expect(JSON.stringify(call.messages)).not.toContain('prompt')
  })

  it('appends the published summary to the run’s existing conversation', async () => {
    const { ensure, appendRunSummary, appendAgentSessionMessages } = harness()
    await ensure({ runId: 'mi-ar-4' })
    await appendRunSummary({ runId: 'mi-ar-4', summary: 'BTC 持仓骤降，量放大 3.4 倍' })
    const last = appendAgentSessionMessages.mock.calls.at(-1)![0] as unknown as { sessionId: string; messages: { role: string; content: string }[] }
    expect(last.sessionId).toBe('s-1')
    expect(last.messages).toEqual([{ role: 'assistant', data: { parts: [{ type: 'text', text: 'BTC 持仓骤降，量放大 3.4 倍' }] } }])
  })

  it('titles the conversation with the moment and the module, never the run id', async () => {
    const { ensure, createAgentSession } = harness()
    const titled = createAnalysisRunSession({
      getAgentState: async () => ({ sessions: [] }),
      createAgentSession: createAgentSession as never,
      titleFor: queuedAt => `${queuedAt} · 市场分析`
    })
    await titled({ runId: 'mi-ar-9', queuedAt: '2026-11-06T10:15:00.000Z' })
    const call = createAgentSession.mock.calls.at(-1)![0] as unknown as { name: string }
    expect(call.name).toBe('2026-11-06T10:15:00.000Z · 市场分析')
    expect(call.name).not.toContain('mi-ar-')
    await ensure({ runId: 'mi-ar-10' })
  })

  it('uses the narrow lookup when it is available, so the list is never read', async () => {
    const createAgentSession = vi.fn(async () => ({ id: 's-9', agentId: 'crypto-market-analyst' }))
    const findSessionByAutomationRef = vi.fn(async () => ({ id: 's-1', agentId: 'crypto-market-analyst' }))
    const getAgentState = vi.fn(async () => ({ sessions: [] }))
    const ensure = createAnalysisRunSession({ getAgentState, createAgentSession: createAgentSession as never, findSessionByAutomationRef })
    // 同一个 run 再来一次：窄查命中，既不建第二条，也不读全量列表。
    expect(await ensure({ runId: 'mi-ar-1', queuedAt: '2026-11-06T10:15:00.000Z' })).toBe('s-1')
    expect(findSessionByAutomationRef).toHaveBeenCalledWith('crypto-market-analyst', 'mi-ar-1')
    expect(getAgentState).not.toHaveBeenCalled()
    expect(createAgentSession).not.toHaveBeenCalled()
  })

  it('stays quiet when the port is not injected', async () => {
    const ensure = createAnalysisRunSession({})
    expect(await ensure({ runId: 'mi-ar-3' })).toBeUndefined()
  })
})
