import { describe, expect, it, vi } from 'vitest'

import { createAnalysisRunSession } from './analysisRunSession'

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
  return { ensure, createAgentSession, appendAgentSessionMessages, sessions }
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
      originGroup: 'market-analysis'
    }))
  })

  it('writes the context card and the summary, and never the prompt or the answer', async () => {
    const { ensure, appendAgentSessionMessages } = harness()
    await ensure({ runId: 'mi-ar-2', summary: 'BTC 持仓骤降' })
    const call = appendAgentSessionMessages.mock.calls[0]![0] as unknown as { messages: { role: string; content: string }[] }
    expect(call.messages).toHaveLength(2)
    expect(call.messages[0]!.content).toBe('market-analysis-run:mi-ar-2')
    // 原文只存在 mi_analysis_io，会话只放 runId；这里不该出现提示词或模型原文。
    expect(JSON.stringify(call.messages)).not.toContain('messages:')
  })

  it('stays quiet when the port is not injected', async () => {
    const ensure = createAnalysisRunSession({})
    expect(await ensure({ runId: 'mi-ar-3' })).toBeUndefined()
  })
})
