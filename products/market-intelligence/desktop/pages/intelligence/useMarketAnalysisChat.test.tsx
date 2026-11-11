// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { AnalysisWorkspaceBinding } from '../../../contracts/analysisWorkspaceContracts'
import { useMarketAnalysisChat } from './useMarketAnalysisChat'


it.each(['success', 'failure', 'failure-with-new-draft'] as const)('clears the exact submitted draft before the reply and handles %s safely', async outcome => {
  const state = { agents: [{ id: 'crypto-market-analyst', model: 'test:model' }], sessions: [{ id: 'general', agentId: 'crypto-market-analyst', description: 'market-analysis-conversation' }], messagesBySessionId: {} }
  let finish: (value: unknown) => void = () => {}
  let fail: (reason: unknown) => void = () => {}
  const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject })
  const sendMessage = vi.fn(() => pending)
  vi.stubGlobal('platform', { agents: { getState: async () => state, onStateChanged: () => () => {}, sendMessage } })
  let chat!: ReturnType<typeof useMarketAnalysisChat>
  function Probe() { chat = useMarketAnalysisChat(undefined, '市场对话'); return null }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(Probe)))
    await act(async () => chat.setDraft('  你好\n'))
    let sending!: Promise<void>
    await act(async () => { sending = chat.send() })
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: '你好' }))
    expect(chat.sending).toBe(true)
    expect(chat.draft).toBe('')
    if (outcome === 'failure-with-new-draft') await act(async () => chat.setDraft('新问题'))
    await act(async () => {
      if (outcome === 'success') finish({ state })
      else fail(new Error('send failed'))
      await sending
    })
    expect(chat.draft).toBe(outcome === 'success' ? '' : outcome === 'failure' ? '  你好\n' : '新问题')
    expect(chat.failed).toBe(outcome !== 'success')
  } finally {
    finish({ state })
    await act(async () => root.unmount())
    container.remove(); vi.unstubAllGlobals()
  }
})

it.each(['success', 'failure'] as const)('keeps the in-flight session identity and preserves its draft on %s after selecting another event', async outcome => {
  const state = { agents: [{ id: 'crypto-market-analyst', model: 'test:model' }], sessions: [
    { id: 'general', agentId: 'crypto-market-analyst', description: 'market-analysis-conversation' },
    { id: 'event-b', agentId: 'crypto-market-analyst', description: 'market-analysis-follow-up:event-b' }
  ], messagesBySessionId: {} }
  let finish: (value: unknown) => void = () => {}
  let fail: (reason: unknown) => void = () => {}
  const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject })
  const cancelSession = vi.fn(async () => true)
  const selectSession = vi.fn(async () => state)
  const sendMessage = vi.fn(() => pending)
  vi.stubGlobal('platform', { agents: { getState: async () => state, onStateChanged: () => () => {},
    getRuntimeSnapshot: async () => ({ sessions: {}, toolApprovals: [{ sessionId: 'general', approvalId: 'approval-1' }] }),
    onRuntimeStateChanged: () => () => {}, cancelSession, selectSession, sendMessage } })
  let chat!: ReturnType<typeof useMarketAnalysisChat>
  function Probe({ binding }: { binding?: AnalysisWorkspaceBinding }) { chat = useMarketAnalysisChat(binding, '市场对话'); return null }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(Probe)))
    await act(async () => chat.setDraft('当前市场'))
    let sending!: Promise<void>
    await act(async () => { sending = chat.send() })
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'general' }))
    await act(async () => root.render(createElement(Probe, { binding: { agentId: 'crypto-market-analyst', eventGroupId: 'event-b', analysisRunId: 'run-b', summaryId: 'summary-b', asOf: '2026-09-30T00:00:00.000Z' } })))
    expect(chat.sending).toBe(true)
    expect(chat.approvals.map(a => a.approvalId)).toEqual(['approval-1'])
    await act(async () => chat.stop())
    expect(cancelSession).toHaveBeenCalledWith('general')
    await act(async () => chat.openAgent())
    expect(selectSession).toHaveBeenCalledWith('general')
    await act(async () => { if (outcome === 'success') finish({ state }); else fail(new Error('send failed')); await sending })
    expect(chat.draft).toBe(outcome === 'failure' ? '当前市场' : '')
    await act(async () => root.render(createElement(Probe)))
    expect(chat.draft).toBe(outcome === 'failure' ? '当前市场' : '')
  } finally {
    finish({ state })
    await act(async () => root.unmount())
    container.remove(); vi.unstubAllGlobals()
  }
})

it('lists only the reader\'s own conversations, never the automation run sessions', async () => {
  // 真实数据：这个 agent 下 47 条自动分析会话、1 条读者会话。面板以前把自动会话也列进来、
  // 还会选中最新那条——里面只有一张上下文卡片，打开就是空白。
  const state = {
    agents: [{ id: 'crypto-market-analyst', model: 'test:model' }],
    sessions: [
      { id: 'run-1', agentId: 'crypto-market-analyst', name: '市场分析', origin: 'automation', originGroup: 'market-analysis', updatedAt: '2026-11-10T01:00:00.000Z' },
      { id: 'mine', agentId: 'crypto-market-analyst', name: '我的对话', origin: 'reader', updatedAt: '2026-11-09T01:00:00.000Z' }
    ],
    messagesBySessionId: {}
  }
  vi.stubGlobal('platform', { agents: { getState: async () => state, onStateChanged: () => () => {}, getRuntimeSnapshot: async () => ({ sessions: {}, toolApprovals: [] }) } })
  let chat!: ReturnType<typeof useMarketAnalysisChat>
  function Probe() { chat = useMarketAnalysisChat(undefined, '市场对话'); return null }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(Probe)))
    await act(async () => { await Promise.resolve() })
    expect(chat.sessions.map(session => session.id)).toEqual(['mine'])
    // 选中的是读者自己的那条，而不是最新的自动会话。
    expect(chat.sessionId).toBe('mine')
  } finally {
    await act(async () => root.unmount())
    container.remove(); vi.unstubAllGlobals()
  }
})
