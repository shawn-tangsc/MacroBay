import { describe, expect, it } from 'vitest'

import {
  PUSH_BACKOFF_FAILURES,
  PUSH_BACKOFF_WINDOW_MS,
  recordPushOutcome,
  shouldSkipPush
} from './pushBackoffPolicy'
import type { NotificationPushBackoff } from '../contracts/notificationContracts'

const NOW = '2026-11-03T00:00:00.000Z'

function backoff(patch: Partial<NotificationPushBackoff> = {}): NotificationPushBackoff {
  return { channelId: 'channel-a', failures: 0, pausedUntil: null, ...patch }
}

describe('pushBackoffPolicy', () => {
  it('keeps the threshold and window in exactly one place', () => {
    expect(PUSH_BACKOFF_FAILURES).toBe(3)
    expect(PUSH_BACKOFF_WINDOW_MS).toBe(30 * 60 * 1000)
  })

  it('counts failures without pausing until the third one', () => {
    const first = recordPushOutcome(undefined, 'failed', NOW)
    expect(first).toEqual({ failures: 1, pausedUntil: null, transition: null, changed: true })

    const second = recordPushOutcome(backoff({ failures: 1 }), 'failed', NOW)
    expect(second).toEqual({ failures: 2, pausedUntil: null, transition: null, changed: true })

    const third = recordPushOutcome(backoff({ failures: 2 }), 'failed', NOW)
    expect(third.failures).toBe(3)
    expect(third.pausedUntil).toBe(new Date(Date.parse(NOW) + PUSH_BACKOFF_WINDOW_MS).toISOString())
    expect(third.transition).toBe('suspended')
  })

  it('skips only inside the window, and treats an unreadable window as not paused', () => {
    const paused = backoff({ failures: 3, pausedUntil: '2026-11-03T00:30:00.000Z' })
    expect(shouldSkipPush(paused, '2026-11-03T00:29:59.999Z')).toBe(true)
    expect(shouldSkipPush(paused, '2026-11-03T00:30:00.000Z')).toBe(false)
    expect(shouldSkipPush(backoff(), NOW)).toBe(false)
    expect(shouldSkipPush(undefined, NOW)).toBe(false)
    // 坏时间戳不能把读者的推送永远停住：按「没暂停」处理。
    expect(shouldSkipPush(backoff({ failures: 3, pausedUntil: 'not-a-time' }), NOW)).toBe(false)
  })

  it('resumes on the first accepted send and reports the boundary once', () => {
    const paused = backoff({ failures: 3, pausedUntil: '2026-11-03T00:30:00.000Z' })
    const resumed = recordPushOutcome(paused, 'sent-accepted', '2026-11-03T00:31:00.000Z')
    expect(resumed).toEqual({ failures: 0, pausedUntil: null, transition: 'resumed', changed: true })

    // 已经解除之后再成功，不再报第二次 resumed。
    const again = recordPushOutcome(backoff(), 'sent-accepted', NOW)
    expect(again.transition).toBeNull()
    // 没有既有状态可清：写入口不该为一个从没失败过的通道造一行。
    expect(again.changed).toBe(false)
  })

  it('treats unknown-after-send as neither a failure nor a reset', () => {
    const paused = backoff({ failures: 3, pausedUntil: '2026-11-03T00:30:00.000Z' })
    expect(recordPushOutcome(paused, 'unknown-after-send', NOW)).toEqual({
      failures: 3,
      pausedUntil: '2026-11-03T00:30:00.000Z',
      transition: null,
      changed: false
    })
    expect(recordPushOutcome(backoff({ failures: 2 }), 'unknown-after-send', NOW)).toEqual({
      failures: 2,
      pausedUntil: null,
      transition: null,
      changed: false
    })
    expect(recordPushOutcome(undefined, 'unknown-after-send', NOW)).toEqual({
      failures: 0,
      pausedUntil: null,
      transition: null,
      changed: false
    })
  })

  it('re-suspends with a new window after the previous one expired', () => {
    const expired = backoff({ failures: 3, pausedUntil: '2026-11-03T00:00:00.000Z' })
    const next = recordPushOutcome(expired, 'failed', '2026-11-03T01:00:00.000Z')
    expect(next.failures).toBe(4)
    expect(next.pausedUntil).toBe('2026-11-03T01:30:00.000Z')
    expect(next.transition).toBe('suspended')
  })

  it('never invents a pause when the clock is unreadable', () => {
    const decision = recordPushOutcome(backoff({ failures: 2 }), 'failed', 'not-a-time')
    expect(decision.failures).toBe(3)
    expect(decision.pausedUntil).toBeNull()
    expect(decision.transition).toBeNull()
  })

  it('keeps the policy pure: same input, same output, no mutation', () => {
    const current = backoff({ failures: 2 })
    const snapshot = { ...current }
    const first = recordPushOutcome(current, 'failed', NOW)
    const second = recordPushOutcome(current, 'failed', NOW)
    expect(first).toEqual(second)
    expect(current).toEqual(snapshot)
  })
})
