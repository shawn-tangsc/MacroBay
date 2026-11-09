import { describe, expect, it } from 'vitest'

import type {
  PlatformEventCheckpoint,
  PlatformEventDelivery,
  PlatformEventEnvelope
} from '../contracts/eventBusContracts'
import type { EventBusStoreState } from './eventBusStore'
import { eventBusRetentionPolicy, pruneEventBusState } from './eventBusRetention'

const NOW = '2026-11-09T12:00:00.000Z'

function event(id: string, recordedAt: string): PlatformEventEnvelope {
  return {
    eventId: id,
    eventRecordId: `event-record-${id}`,
    topic: 'platform.test.changed',
    producer: { owner: 'platform' },
    schemaVersion: 1,
    occurredAt: recordedAt,
    recordedAt,
    payload: { id }
  }
}

function delivery(id: string, eventId: string, status: PlatformEventDelivery['status']): PlatformEventDelivery {
  return { deliveryId: id, deliveryRecordId: `delivery-record-${id}`, eventId, consumerId: 'platform.test.consumer', status, attemptCount: 1 }
}

function checkpoint(consumerId: string, updatedAt: string): PlatformEventCheckpoint {
  return { consumerId, lastCompletedRecordedAt: updatedAt, lastCompletedEventId: `event-${consumerId}`, updatedAt }
}

function state(overrides: Partial<EventBusStoreState> = {}): EventBusStoreState {
  return { events: [], deliveries: [], checkpoints: [], ...overrides }
}

describe('event bus retention', () => {
  it('keeps the newest events up to the count cap and drops the oldest with their terminal deliveries', () => {
    const events = [
      event('oldest', '2026-11-08T00:00:00.000Z'),
      event('middle', '2026-11-08T06:00:00.000Z'),
      event('newest', '2026-11-08T12:00:00.000Z')
    ]
    const result = pruneEventBusState(
      state({
        events,
        deliveries: [
          delivery('done-oldest', 'oldest', 'completed'),
          delivery('done-middle', 'middle', 'completed'),
          delivery('done-newest', 'newest', 'completed')
        ]
      }),
      { now: NOW, maxEvents: 2 }
    )

    // 最近窗口不丢：最老的那条被删，其余原顺序保留。
    expect(result.state.events.map((entry) => entry.eventId)).toEqual(['middle', 'newest'])
    expect(result.state.deliveries.map((entry) => entry.deliveryId)).toEqual(['done-middle', 'done-newest'])
    expect(result.removedEvents).toBe(1)
    expect(result.removedDeliveries).toBe(1)
  })

  it('never prunes an event that a pending delivery still has to replay', () => {
    const events = [
      event('pinned-oldest', '2026-01-01T00:00:00.000Z'),
      event('fresh', '2026-11-08T12:00:00.000Z')
    ]
    const result = pruneEventBusState(
      state({
        events,
        deliveries: [delivery('pending', 'pinned-oldest', 'pending'), delivery('done', 'fresh', 'completed')]
      }),
      { now: NOW, maxEvents: 1, retentionDays: 1 }
    )

    // 条数上限是 1、时间窗也在裁它，但 pending 钉住的事件和它的投递都必须留下：
    // 这条事件比 fresh 老得多，若按普通规则它第一个被删——留下它本身就证明钉住生效。
    expect(result.state.events.map((entry) => entry.eventId)).toEqual(['pinned-oldest'])
    expect(result.state.deliveries.map((entry) => entry.deliveryId)).toEqual(['pending'])
    expect(result.removedEvents).toBe(1)
    expect(result.removedDeliveries).toBe(1)
  })

  it('is idempotent: a second run removes nothing and returns the same state', () => {
    const initial = state({
      events: [
        event('old', '2026-01-01T00:00:00.000Z'),
        event('kept', '2026-11-09T00:00:00.000Z')
      ],
      deliveries: [delivery('done-old', 'old', 'completed'), delivery('done-kept', 'kept', 'completed')],
      checkpoints: [checkpoint('consumer-a', '2026-11-08T00:00:00.000Z')]
    })

    const first = pruneEventBusState(initial, { now: NOW, retentionDays: 7 })
    const second = pruneEventBusState(first.state, { now: NOW, retentionDays: 7 })

    expect(first.removedEvents).toBe(1)
    expect(second).toMatchObject({ removedEvents: 0, removedDeliveries: 0 })
    expect(second.state).toEqual(first.state)
  })

  it('applies the time window without the count cap, and keeps events whose timestamp cannot be read', () => {
    const events = [
      event('expired', '2026-10-01T00:00:00.000Z'),
      event('at-cutoff', '2026-11-02T12:00:00.000Z'),
      event('fresh', '2026-11-09T00:00:00.000Z'),
      event('unparsable', 'not-a-date')
    ]
    const result = pruneEventBusState(state({ events }), { now: NOW, retentionDays: 7, maxEvents: 100 })

    // 截止点当刻保留（半开窗口是「更旧才删」），读不出时间的保留而不是猜它很旧。
    expect(result.state.events.map((entry) => entry.eventId)).toEqual(['at-cutoff', 'fresh', 'unparsable'])
    expect(result.removedEvents).toBe(1)
  })

  it('keeps only the latest checkpoint per consumer and drops deliveries whose event is gone', () => {
    const result = pruneEventBusState(
      state({
        events: [event('kept', '2026-11-09T00:00:00.000Z')],
        deliveries: [
          delivery('done-kept', 'kept', 'completed'),
          delivery('dead-orphan', 'gone', 'dead-letter')
        ],
        checkpoints: [
          checkpoint('consumer-a', '2026-11-01T00:00:00.000Z'),
          checkpoint('consumer-b', '2026-11-02T00:00:00.000Z'),
          checkpoint('consumer-a', '2026-11-08T00:00:00.000Z')
        ]
      }),
      { now: NOW, retentionDays: 7 }
    )

    expect(result.state.deliveries.map((entry) => entry.deliveryId)).toEqual(['done-kept'])
    // consumer-a 只留 updatedAt 最新的那条；consumer-b 原样保留。
    expect(result.state.checkpoints).toEqual([
      checkpoint('consumer-a', '2026-11-08T00:00:00.000Z'),
      checkpoint('consumer-b', '2026-11-02T00:00:00.000Z')
    ])
  })

  it('uses the documented defaults when no limits are passed', () => {
    const events = Array.from({ length: eventBusRetentionPolicy.maxEvents + 3 }, (_, index) =>
      event(`e-${index}`, new Date(Date.UTC(2026, 10, 9, 0, 0, index)).toISOString())
    )

    const result = pruneEventBusState(state({ events }), { now: NOW })

    expect(result.state.events).toHaveLength(eventBusRetentionPolicy.maxEvents)
    expect(result.state.events[0]?.eventId).toBe('e-3')
    expect(result.removedEvents).toBe(3)
  })
})
