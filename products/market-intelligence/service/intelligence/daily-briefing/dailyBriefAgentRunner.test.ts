import { describe, expect, it, vi } from 'vitest'
import { createDailyBriefAgentRunner } from './dailyBriefAgentRunner'

describe('daily brief agent runner', () => {
  it('creates a session, sends the first prompt, continues, and records state', async () => {
    const port = {
      ensure: vi.fn(async () => ({ sessionId: 's1', created: true })),
      send: vi.fn(async () => ({ assistantMessage: { searchableText: '{}' }, toolInvocations: [] })),
      state: vi.fn(async () => undefined)
    }
    const runner = createDailyBriefAgentRunner({ port: port as never, agentId: 'daily-brief-editor' })
    await runner.start({ editionKey: '2026-10-30:zh-CN', date: '2026-10-30', locale: 'zh-CN', prompt: 'task', allowedTools: ['WebSearch'] })
    expect(port.ensure).toHaveBeenCalledWith(expect.objectContaining({ editionKey: '2026-10-30:zh-CN', agentId: 'daily-brief-editor', allowedTools: ['WebSearch'] }))
    expect(port.send).toHaveBeenCalledWith('s1', expect.objectContaining({ agentId: 'daily-brief-editor', text: 'task' }))
    await runner.continue('s1', 'repair')
    expect(port.send).toHaveBeenLastCalledWith('s1', expect.objectContaining({ text: 'repair' }))
    await runner.finish('2026-10-30:zh-CN', 'accepted')
    expect(port.state).toHaveBeenCalledWith('2026-10-30:zh-CN', 'accepted')
  })
})
