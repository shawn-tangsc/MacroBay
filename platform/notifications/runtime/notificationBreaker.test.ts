import { describe, expect, it } from 'vitest'

import type { NotificationDailyCounters } from '../store/notificationStore'
import {
  decideNotificationBreaker,
  notificationBreakerPolicy,
  notificationCounterKey,
  pruneNotificationDailyCounters,
  utcDayOf
} from './notificationBreaker'

describe('notification breaker', () => {
  it('folds only the writes above the daily limit', () => {
    let counters: NotificationDailyCounters = {}
    const actions: string[] = []
    for (let index = 0; index < notificationBreakerPolicy.defaultDailyLimit + 1; index += 1) {
      const decision = decideNotificationBreaker({ counters, ownerId: 'market-intelligence', now: '2026-11-01T08:00:00.000Z' })
      counters = decision.counters
      actions.push(decision.action)
    }

    expect(actions.filter((action) => action === 'write')).toHaveLength(notificationBreakerPolicy.defaultDailyLimit)
    expect(actions.at(-1)).toBe('fold')
    expect(counters[notificationCounterKey('market-intelligence', '2026-11-01T08:00:00.000Z')]).toBe(51)
  })

  it('keeps a separate bucket per owner and per UTC day', () => {
    const first = decideNotificationBreaker({ counters: {}, ownerId: 'a', now: '2026-11-01T23:59:00.000Z' })
    const nextDay = decideNotificationBreaker({ counters: first.counters, ownerId: 'a', now: '2026-11-02T00:01:00.000Z' })
    const otherOwner = decideNotificationBreaker({ counters: nextDay.counters, ownerId: 'b', now: '2026-11-01T23:59:00.000Z' })

    expect(otherOwner.counters).toEqual({
      'a|2026-11-01': 1,
      'a|2026-11-02': 1,
      'b|2026-11-01': 1
    })
  })

  it('honours an explicit limit and a custom limit of 1', () => {
    const first = decideNotificationBreaker({ counters: {}, ownerId: 'p', now: '2026-11-01T00:00:00.000Z', limit: 1 })
    const second = decideNotificationBreaker({ counters: first.counters, ownerId: 'p', now: '2026-11-01T01:00:00.000Z', limit: 1 })

    expect(first.action).toBe('write')
    expect(second.action).toBe('fold')
  })

  it('does not mutate the counters it was given', () => {
    const counters = { 'p|2026-11-01': 3 }
    decideNotificationBreaker({ counters, ownerId: 'p', now: '2026-11-01T10:00:00.000Z' })

    expect(counters).toEqual({ 'p|2026-11-01': 3 })
  })

  it('drops counter buckets outside the counter retention window', () => {
    const counters = {
      'p|2026-10-01': 9,
      'p|2026-10-30': 4,
      'p|2026-11-01': 2,
      'broken': 1
    }

    const pruned = pruneNotificationDailyCounters(counters, '2026-11-01T12:00:00.000Z', 7)

    expect(pruned).toEqual({ 'p|2026-10-30': 4, 'p|2026-11-01': 2 })
  })

  it('parses the UTC day, not the local day', () => {
    expect(utcDayOf('2026-11-01T23:30:00.000Z')).toBe('2026-11-01')
    expect(utcDayOf('2026-11-02T00:30:00.000+08:00')).toBe('2026-11-01')
    expect(utcDayOf('not-a-date')).toBe('')
  })
})
