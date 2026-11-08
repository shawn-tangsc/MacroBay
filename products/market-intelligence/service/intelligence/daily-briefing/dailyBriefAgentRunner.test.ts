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
    await runner.start({ date: '2026-10-30', periodId: 'default', locale: 'zh-CN', prompt: 'task', allowedTools: ['WebSearch'] })
    expect(port.ensure).toHaveBeenCalledWith(expect.objectContaining({ editionDate: '2026-10-30', periodId: 'default', locale: 'zh-CN', agentId: 'daily-brief-editor', allowedTools: ['WebSearch'] }))
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
      void runner.start({ date: '2026-10-30', periodId: 'default', locale: 'zh-CN', prompt: 'task', signal: controller.signal })
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
    await runner.start({ date: '2026-10-30', periodId: 'default', locale: 'en-US', prompt: 'task' })
    expect(sent[0]?.displayText).toContain('2026-10-30')
    expect(sent[0]?.displayText).toContain('daily brief')
    expect(sent[0]?.displayText).not.toMatch(/[\u4e00-\u9fff]/)
  })

  /**
   * 终态三态分离（架构师 2026-11-07 退回项）：`error` 不是"应用被关"。
   *
   * 三种都要能红：pause + 自己的信号 = 取消；pause 而信号没动 = 运行时被停（应用在关）；
   * error = 模型/网关自己报错，**保留平台写的那个码**，不许换成 run-interrupted。
   */
  describe('why a turn stopped', () => {
    /** `stopReason` 是平台给的那一档（`runtimeTypes.ts`）：只认它，不看我们自己的信号。 */
    const runnerWith = async (
      message: Readonly<{ status: string; data?: unknown }>,
      stopReason?: Readonly<{ kind: string }>
    ) => {
      const port = {
        ensure: vi.fn(async () => ({ sessionId: 's1', created: true })),
        send: vi.fn(async () => ({
          assistantMessage: { searchableText: '', ...message },
          toolInvocations: [],
          ...(stopReason === undefined ? {} : { stopReason })
        })),
        cancel: vi.fn(async () => undefined),
        state: vi.fn(async () => undefined)
      }
      const runner = createDailyBriefAgentRunner({ port: port as never, agentId: 'daily-brief-editor' })
      return runner.continue('s1', 'task')
    }
    const runtimeText = (code: string) => ({ parts: [{ type: 'runtime-text', key: `agent.runtime.${code}`, fallback: code, text: code }] })

    it('calls a runtime-stop an interrupted run — the app closing is the common one', async () => {
      const result = await runnerWith({ status: 'paused' }, { kind: 'runtime-stop' })
      expect(result).toMatchObject({ stopped: true, stoppedReason: 'run-interrupted' })
    })

    it('calls the reader\'s own stop a cancellation, never a system fault', async () => {
      // 读者连点两次的第二次、或他自己按了取消：`user-stop` / `interrupt`。把它报成「上次没跑完」
      // 就是把读者的动作说成系统故障——今晚就会踩。
      for (const kind of ['user-stop', 'interrupt']) {
        const result = await runnerWith({ status: 'paused' }, { kind })
        expect(result, kind).toMatchObject({ stopped: true, stoppedReason: 'cancelled' })
      }
    })

    it('calls a pause with no reason at all a cancellation too — unknown is not a fault', async () => {
      const result = await runnerWith({ status: 'paused' })
      expect(result).toMatchObject({ stopped: true, stoppedReason: 'cancelled' })
    })

    it('keeps the provider code on an error, and never calls it an interrupted run', async () => {
      const result = await runnerWith({ status: 'error', data: runtimeText('provider-request-failed') })
      expect(result).toMatchObject({ stopped: true, stoppedReason: 'failed', failureCode: 'provider-error', failureDetail: 'provider-request-failed' })
      expect(result.stoppedReason).not.toBe('run-interrupted')
    })

    it('maps a missing model to the model failure the brief already has', async () => {
      const result = await runnerWith({ status: 'error', data: runtimeText('provider-model-not-found') })
      expect(result).toMatchObject({ stoppedReason: 'failed', failureCode: 'model-unavailable', failureDetail: 'provider-model-not-found' })
    })

    it('invents no provider code when the message carries none', async () => {
      const result = await runnerWith({ status: 'error' })
      expect(result).toMatchObject({ stoppedReason: 'failed', failureCode: 'provider-error' })
      expect(result.failureDetail).toBeUndefined()
    })
  })
})
