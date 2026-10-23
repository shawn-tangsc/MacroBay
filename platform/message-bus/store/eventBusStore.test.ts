import { describe, expect, it } from 'vitest'

import { resetEventBusIdCountersForTests } from '../contracts/eventBusContracts'
import { createEventBusStore } from './eventBusStore'

describe('event bus store', () => {
  it('dedupes by idempotency key lookup and tracks checkpoints', () => {
    resetEventBusIdCountersForTests()
    const store = createEventBusStore()

    const event = store.appendEvent(
      {
        topic: 'product.sample.created',
        producer: { owner: 'product', productId: 'sample-product' },
        schemaVersion: 1,
        idempotencyKey: 'sample:1',
        payload: { id: '1' }
      },
      '2026-07-08T09:00:00.000Z'
    )

    expect(store.findEventByIdempotencyKey('sample:1')?.eventId).toBe(event.eventId)

    store.appendDeliveries(event, ['consumer-a'])
    expect(store.listPendingDeliveries('2026-07-08T09:00:00.000Z')).toHaveLength(1)

    store.upsertCheckpoint({
      consumerId: 'consumer-a',
      lastCompletedRecordedAt: event.recordedAt,
      lastCompletedEventId: event.eventId,
      updatedAt: '2026-07-08T09:00:01.000Z'
    })
    expect(store.getCheckpoint('consumer-a')?.lastCompletedEventId).toBe(event.eventId)
  })

  it('allocates distinct durable delivery records for each consumer in one event batch', () => {
    resetEventBusIdCountersForTests()
    const store = createEventBusStore()
    const event = store.appendEvent(
      {
        topic: 'product.sample.created',
        producer: { owner: 'product', productId: 'sample-product' },
        schemaVersion: 1,
        payload: { id: '1' }
      },
      '2026-08-24T09:00:00.000Z'
    )

    const [first, second] = store.appendDeliveries(event, ['consumer-a', 'consumer-b'])

    expect(first).toMatchObject({ eventRecordId: event.eventRecordId, consumerId: 'consumer-a' })
    expect(second).toMatchObject({ eventRecordId: event.eventRecordId, consumerId: 'consumer-b' })
    expect(first?.deliveryRecordId).not.toBe(second?.deliveryRecordId)

    store.updateDelivery(second!, { status: 'completed' })
    store.updateDelivery(first!, { attemptCount: 1, lastError: 'temporary', nextAttemptAt: '2026-08-24T09:01:00.000Z' })

    expect(store.getState().deliveries).toEqual([
      expect.objectContaining({ consumerId: 'consumer-a', status: 'pending', attemptCount: 1, lastError: 'temporary' }),
      expect.objectContaining({ consumerId: 'consumer-b', status: 'completed', attemptCount: 0 })
    ])

    store.updateDelivery(first!, { status: 'completed', attemptCount: 2, completedAt: '2026-08-24T09:01:00.000Z' })

    expect(store.getState().deliveries).toEqual([
      expect.objectContaining({ consumerId: 'consumer-a', status: 'completed', attemptCount: 2 }),
      expect.objectContaining({ consumerId: 'consumer-b', status: 'completed', attemptCount: 0 })
    ])
  })
})
