import { describe, expect, it, vi } from 'vitest'

import type { PlatformEventDelivery, PlatformEventEnvelope } from '../contracts/eventBusContracts'
import type { EventBusStoreState } from '../store/eventBusStore'
import { createEventBusRuntime, type EventBusStorage } from './eventBusRuntime'

const NOW = new Date().toISOString()
// 相对「现在」取时间：hydration 用的真实时钟，固定字面量会在 30 天后自己过期。
const EXPIRED = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
const FRESH = new Date(Date.now() - 60 * 60 * 1000).toISOString()

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

function state(overrides: Partial<EventBusStoreState> = {}): EventBusStoreState {
  return { events: [], deliveries: [], checkpoints: [], ...overrides }
}

function storageReturning(initial: EventBusStoreState): EventBusStorage & { write: ReturnType<typeof vi.fn> } {
  return {
    read: vi.fn(async () => initial),
    write: vi.fn(async () => undefined)
  }
}

describe('event bus retention on hydration', () => {
  it('shrinks the stored file on the first read, keeping the newest window and pending events', async () => {
    const storage = storageReturning(
      state({
        events: [
          event('expired', EXPIRED),
          event('pinned', EXPIRED),
          event('fresh', FRESH)
        ],
        deliveries: [
          delivery('done-expired', 'expired', 'completed'),
          delivery('pending-pinned', 'pinned', 'pending'),
          delivery('done-fresh', 'fresh', 'completed')
        ]
      })
    )
    const runtime = createEventBusRuntime({ storage })

    // 第一次操作触发 hydration：老文件在这一刻就被裁掉并写回，不必等每日任务。
    // 显式调用发生在 hydration 之后，所以它自己删 0 条（幂等）。
    const result = await runtime.pruneRetained({ now: NOW })

    expect(result).toEqual({ removedEvents: 0, removedDeliveries: 0 })
    expect(storage.write).toHaveBeenCalledOnce()
    const persisted = storage.write.mock.calls[0]![0] as EventBusStoreState
    expect(persisted.events.map((entry) => entry.eventId)).toEqual(['pinned', 'fresh'])
    expect(persisted.deliveries.map((entry) => entry.deliveryId)).toEqual(['pending-pinned', 'done-fresh'])
  })

  it('does not rewrite the file when there is nothing to prune, and stays idempotent on the next runtime', async () => {
    const initial = state({
      events: [event('fresh', FRESH)],
      deliveries: [delivery('done-fresh', 'fresh', 'completed')]
    })
    const firstStorage = storageReturning(initial)
    const first = createEventBusRuntime({ storage: firstStorage })
    await expect(first.pruneRetained({ now: NOW })).resolves.toEqual({ removedEvents: 0, removedDeliveries: 0 })
    expect(firstStorage.write).not.toHaveBeenCalled()

    // 重启：同一份（已裁过的）状态再跑一次，仍然 0 删除、0 写回。
    const secondStorage = storageReturning(initial)
    const second = createEventBusRuntime({ storage: secondStorage })
    await expect(second.pruneRetained({ now: NOW })).resolves.toEqual({ removedEvents: 0, removedDeliveries: 0 })
    expect(secondStorage.write).not.toHaveBeenCalled()
  })
})
