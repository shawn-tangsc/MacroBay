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

  it('does not let a failing cancel escape as an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const controller = new AbortController()
      const cancelled: string[] = []
      const port = {
        ensure: async () => ({ sessionId: 's1', created: true }),
        send: () => new Promise<never>(() => undefined),
        cancel: async (sessionId: string) => {
          cancelled.push(sessionId)
          throw new Error('runtime already stopped')
        },
        state: async () => undefined
      }
      const runner = createDailyBriefAgentRunner({ port: port as never, agentId: 'daily-brief-editor' })
      void runner.start({ editionKey: '2026-10-30:zh-CN', date: '2026-10-30', locale: 'zh-CN', prompt: 'task', signal: controller.signal })
      await new Promise((resolve) => setTimeout(resolve, 0))
      controller.abort()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(cancelled).toEqual(['s1'])
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('writes the first visible task in the edition language', async () => {
    const sent: { displayText?: string }[] = []
    const port = {
      ensure: vi.fn(async () => ({ sessionId: 's1', created: true })),
      send: vi.fn(async (_sessionId: string, message: { displayText?: string }) => {
        sent.push(message)
        return { assistantMessage: { searchableText: '{}' }, toolInvocations: [] }
      }),
      state: vi.fn(async () => undefined)
    }
    const runner = createDailyBriefAgentRunner({ port: port as never, agentId: 'daily-brief-editor' })
    await runner.start({ editionKey: '2026-10-30:en-US', date: '2026-10-30', locale: 'en-US', prompt: 'task' })
    expect(sent[0]?.displayText).toContain('2026-10-30')
    expect(sent[0]?.displayText).toContain('daily brief')
    expect(sent[0]?.displayText).not.toMatch(/[\u4e00-\u9fff]/)
  })
})
