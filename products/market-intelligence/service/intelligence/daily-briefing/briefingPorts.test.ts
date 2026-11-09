import { describe, expect, it, vi } from 'vitest'

import { briefingNotificationPorts } from './briefingPorts'

/**
 * 通知"没发"必须留痕（2026-11-07：成功失败两条通知一条都没发，库里日志里都没有痕迹）。
 * 判"发没发"以库里记录为准，但"为什么没发"要能从日志读出来。
 */
describe('the briefing notification port leaves a trace', () => {
  it('records a missing port at wiring time instead of staying silent', () => {
    const log = vi.fn()
    const ports = briefingNotificationPorts({ log })
    expect(ports.noticeSubmit).toBeUndefined()
    expect(log).toHaveBeenCalledWith('warn', 'MI_DAILY_BRIEF_NOTICE_PORT_MISSING', { at: 'wiring' })
  })

  it('records the platform rejection reason, and still hands the outcome back', async () => {
    const log = vi.fn()
    const rejected = { kind: 'rejected' as const, reason: 'unknown-event-type' as const, message: 'nope' }
    const ports = briefingNotificationPorts({ log, submitNotification: vi.fn(async () => rejected) })

    const outcome = await ports.noticeSubmit!({ eventTypeId: 'market-intelligence.briefing.ready' } as never)

    expect(outcome).toBe(rejected)
    expect(log).toHaveBeenCalledWith('warn', 'MI_DAILY_BRIEF_NOTICE_NOT_DELIVERED', {
      eventTypeId: 'market-intelligence.briefing.ready', outcome: 'rejected', reason: 'unknown-event-type'
    })
  })

  it('records a submit that threw, and rethrows so the notifier keeps its own contract', async () => {
    const log = vi.fn()
    const ports = briefingNotificationPorts({
      log,
      submitNotification: vi.fn(async () => { throw new Error('notification-runtime-clock-not-configured') })
    })

    await expect(ports.noticeSubmit!({ eventTypeId: 'market-intelligence.briefing.ready' } as never)).rejects.toThrow('clock-not-configured')
    expect(log).toHaveBeenCalledWith('error', 'MI_DAILY_BRIEF_NOTICE_SUBMIT_FAILED', {
      eventTypeId: 'market-intelligence.briefing.ready', message: 'notification-runtime-clock-not-configured'
    })
  })

  it('says nothing when the platform accepted the notice', async () => {
    const log = vi.fn()
    const accepted = { kind: 'accepted' as const, recordId: 'r1', levels: [], suppressedLevels: [] }
    const ports = briefingNotificationPorts({ log, submitNotification: vi.fn(async () => accepted) })

    await expect(ports.noticeSubmit!({ eventTypeId: 'market-intelligence.briefing.ready' } as never)).resolves.toBe(accepted)
    expect(log).not.toHaveBeenCalled()
  })
})
