import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const eventBusJsonFileControls = vi.hoisted(() => ({
  beforeRename: undefined as undefined | ((from: string, to: string) => Promise<void>)
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function createPersistedState(eventId: string): EventBusStoreState {
  return {
    events: [{
      eventId,
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      occurredAt: '2026-08-24T00:00:00.000Z',
      recordedAt: '2026-08-24T00:00:00.000Z',
      payload: {}
    }],
    deliveries: [],
    checkpoints: []
  }
}

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      await eventBusJsonFileControls.beforeRename?.(String(args[0]), String(args[1]))
      await actual.rename(...args)
    }
  }
})

import { resetEventBusIdCountersForTests, type PlatformEventEnvelope } from '../contracts/eventBusContracts'
import { createDefaultEventBusStoreState, createEventBusStore, type EventBusStoreState } from '../store/eventBusStore'
import {
  createEventBusJsonStorage,
  createEventBusRuntime,
  type EventBusStorage,
  type EventBusStorageReadResult
} from './eventBusRuntime'

/** 读一份存储状态（闸门之后 `read()` 带完整性结论）：被阻断时这里直接抛，免得用例把坏文件当空。 */
async function readState(storage: EventBusStorage): Promise<EventBusStoreState> {
  const outcome = await storage.read()
  if (outcome.integrity === 'corrupt' || outcome.integrity === 'future-version') {
    throw new Error(`store blocked: ${outcome.integrity}`)
  }
  return outcome.state
}

describe('event bus runtime', () => {
  it('persists events before dispatch and advances checkpoint on success', async () => {
    resetEventBusIdCountersForTests()
    const store = createEventBusStore()
    const handler = vi.fn(async (_event: PlatformEventEnvelope) => undefined)
    const runtime = createEventBusRuntime({ store })

    runtime.registerConsumer(
      {
        consumerId: 'product-a.consumer',
        owner: 'product',
        productId: 'product-a',
        topics: ['product-a.event.created']
      },
      handler
    )

    const event = await runtime.publish({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      payload: { id: '1' }
    })

    expect(store.getState().events).toHaveLength(1)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]?.[0]?.eventId).toBe(event.eventId)
    expect(store.getCheckpoint('product-a.consumer')?.lastCompletedEventId).toBe(event.eventId)
  })

  it('completes one durable delivery for each consumer subscribed to the same topic', async () => {
    resetEventBusIdCountersForTests()
    const store = createEventBusStore()
    const firstHandler = vi.fn(async () => undefined)
    const secondHandler = vi.fn(async () => undefined)
    const runtime = createEventBusRuntime({ store })

    runtime.registerConsumer(
      { consumerId: 'product-a.first', owner: 'product', productId: 'product-a', topics: ['product-a.event.created'] },
      firstHandler
    )
    runtime.registerConsumer(
      { consumerId: 'product-a.second', owner: 'product', productId: 'product-a', topics: ['product-a.event.created'] },
      secondHandler
    )

    const event = await runtime.publishDurably({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      payload: { id: 'shared-topic' }
    })

    await vi.waitFor(() => {
      expect(firstHandler).toHaveBeenCalledTimes(1)
      expect(secondHandler).toHaveBeenCalledTimes(1)
      expect(store.getState().deliveries).toEqual([
        expect.objectContaining({ eventId: event.eventId, consumerId: 'product-a.first', status: 'completed' }),
        expect.objectContaining({ eventId: event.eventId, consumerId: 'product-a.second', status: 'completed' })
      ])
    })
    expect(new Set(store.getState().deliveries.map((delivery) => delivery.deliveryRecordId)).size).toBe(2)
  })

  it('returns the same event for duplicate idempotency keys', async () => {
    resetEventBusIdCountersForTests()
    const runtime = createEventBusRuntime({ store: createEventBusStore() })
    const first = await runtime.publish({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      idempotencyKey: 'dup-key',
      payload: { id: '1' }
    })
    const second = await runtime.publish({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      idempotencyKey: 'dup-key',
      payload: { id: '2' }
    })
    expect(second.eventId).toBe(first.eventId)
  })

  it('persists a new event without waiting for a slow persistent consumer backfill', async () => {
    resetEventBusIdCountersForTests()
    const directory = await mkdtemp(join(tmpdir(), 'event-bus-runtime-'))
    const filePath = join(directory, 'event-bus.json')
    const storage = createEventBusJsonStorage(filePath)
    const persisted = createEventBusStore()
    persisted.appendEvent({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      payload: { id: 'historical' }
    }, new Date(Date.now() - 60 * 60 * 1000).toISOString())
    await storage.write(persisted.getState())

    const consumerEntered = deferred<void>()
    const releaseConsumer = deferred<void>()
    const handler = vi.fn(async () => {
      consumerEntered.resolve()
      await releaseConsumer.promise
    })
    const runtime = createEventBusRuntime({ storage })
    runtime.registerConsumer(
      { consumerId: 'product-a.consumer', owner: 'product', productId: 'product-a', topics: ['product-a.event.created'] },
      handler
    )
    await consumerEntered.promise

    const event = await runtime.publishDurably({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      payload: { id: 'new' }
    })

    const durableState = await readState(storage)
    expect(durableState.events.map((item) => item.eventId)).toContain(event.eventId)
    expect(durableState.deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: event.eventId, consumerId: 'product-a.consumer', status: 'pending' })
    ]))
    expect(handler).toHaveBeenCalledTimes(1)

    releaseConsumer.resolve()
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2))
    await rm(directory, { recursive: true, force: true })
  })

  it('keeps durable-only consumer failures pending for the existing retry dispatcher', async () => {
    resetEventBusIdCountersForTests()
    const store = createEventBusStore()
    const handler = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(undefined)
    const runtime = createEventBusRuntime({ store })
    runtime.registerConsumer(
      {
        consumerId: 'product-a.consumer',
        owner: 'product',
        productId: 'product-a',
        topics: ['product-a.event.created'],
        retryPolicy: { maxAttempts: 2, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 }
      },
      handler
    )
    await Promise.resolve()

    const event = await runtime.publishDurably({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      payload: { id: 'retry' }
    })

    await vi.waitFor(() => expect(store.getState().deliveries[0]).toMatchObject({
      eventId: event.eventId, status: 'pending', attemptCount: 1, lastError: 'temporary'
    }))
    await runtime.dispatchPending()
    expect(handler).toHaveBeenCalledTimes(2)
    expect(store.getState().deliveries[0]).toMatchObject({ status: 'completed', attemptCount: 2 })
  })

  it('retains a durable-only event and pending delivery across a runtime restart before consumer dispatch completes', async () => {
    resetEventBusIdCountersForTests()
    const directory = await mkdtemp(join(tmpdir(), 'event-bus-runtime-'))
    const storage = createEventBusJsonStorage(join(directory, 'event-bus.json'))
    const started = deferred<void>()
    const neverSettles = new Promise<void>(() => undefined)
    const firstRuntime = createEventBusRuntime({ storage })
    firstRuntime.registerConsumer(
      { consumerId: 'product-a.consumer', owner: 'product', productId: 'product-a', topics: ['product-a.event.created'] },
      async () => {
        started.resolve()
        await neverSettles
      }
    )

    const event = await firstRuntime.publishDurably({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      payload: { id: 'restart' }
    })
    await started.promise
    expect(await readState(storage)).toMatchObject({
      events: [expect.objectContaining({ eventId: event.eventId })],
      deliveries: [expect.objectContaining({ eventId: event.eventId, status: 'pending' })]
    })

    resetEventBusIdCountersForTests()
    const delivered = vi.fn(async () => undefined)
    const restartedRuntime = createEventBusRuntime({ storage })
    restartedRuntime.registerConsumer(
      { consumerId: 'product-a.consumer', owner: 'product', productId: 'product-a', topics: ['product-a.event.created'] },
      delivered
    )

    await vi.waitFor(() => expect(delivered).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: event.eventId }), expect.anything()
    ))
    const postRestartEvent = await restartedRuntime.publishDurably({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      payload: { id: 'post-restart' }
    })
    const recovered = await readState(storage)
    expect(postRestartEvent.eventId).not.toBe(event.eventId)
    expect(new Set(recovered.deliveries.map((delivery) => delivery.deliveryId)).size).toBe(recovered.deliveries.length)
    await vi.waitFor(async () => {
      expect((await readState(storage)).deliveries.every((delivery) => delivery.status !== 'pending')).toBe(true)
    })
    await rm(directory, { recursive: true, force: true })
  })

  it('allocates distinct durable event and delivery identities after a process counter reset', async () => {
    resetEventBusIdCountersForTests()
    const directory = await mkdtemp(join(tmpdir(), 'event-bus-runtime-'))
    const storage = createEventBusJsonStorage(join(directory, 'event-bus.json'))
    const firstRuntime = createEventBusRuntime({ storage })
    const first = await firstRuntime.publishDurably({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      payload: { id: 'first' }
    })

    resetEventBusIdCountersForTests()
    const secondRuntime = createEventBusRuntime({ storage })
    const secondHandler = vi.fn(async () => undefined)
    secondRuntime.registerConsumer(
      { consumerId: 'product-b.consumer', owner: 'product', productId: 'product-b', topics: ['product-a.event.created'] },
      secondHandler
    )
    const second = await secondRuntime.publishDurably({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      payload: { id: 'second' }
    })

    const durableState = await readState(storage)
    expect(second.eventId).not.toBe(first.eventId)
    expect(new Set(durableState.events.map((event) => event.eventId)).size).toBe(durableState.events.length)
    expect(new Set(durableState.deliveries.map((delivery) => delivery.deliveryId)).size).toBe(durableState.deliveries.length)
    await vi.waitFor(async () => {
      expect((await readState(storage)).deliveries.every((delivery) => delivery.status !== 'pending')).toBe(true)
    })
    await rm(directory, { recursive: true, force: true })
  })

  it('blocks ambiguous legacy references while dispatching and updating only an exactly linked delivery', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'event-bus-runtime-'))
    const filePath = join(directory, 'event-bus.json')
    await writeFile(filePath, JSON.stringify({
      events: [
        {
          eventId: 'evt-1', topic: 'product-a.event.created', producer: { owner: 'product', productId: 'product-a' },
          schemaVersion: 1, occurredAt: '2026-08-24T00:00:00.000Z', recordedAt: '2026-08-24T00:00:00.000Z', payload: { id: 'wrong-first' }
        },
        {
          eventId: 'evt-1', topic: 'product-a.event.created', producer: { owner: 'product', productId: 'product-a' },
          schemaVersion: 1, occurredAt: '2026-08-24T00:01:00.000Z', recordedAt: '2026-08-24T00:01:00.000Z', payload: { id: 'wrong-second' }
        },
        {
          eventId: 'evt-unambiguous', topic: 'product-a.event.created', producer: { owner: 'product', productId: 'product-a' },
          schemaVersion: 1, occurredAt: '2026-08-24T00:02:00.000Z', recordedAt: '2026-08-24T00:02:00.000Z', payload: { id: 'exact-target' }
        }
      ],
      deliveries: [
        { deliveryId: 'dlv-1', eventId: 'evt-1', consumerId: 'product-a.consumer', status: 'pending', attemptCount: 0 },
        { deliveryId: 'dlv-1', eventId: 'evt-unambiguous', consumerId: 'product-a.consumer', status: 'pending', attemptCount: 0 }
      ],
      checkpoints: []
    }), 'utf8')

    const handler = vi.fn(async () => undefined)
    const runtime = createEventBusRuntime({ storage: createEventBusJsonStorage(filePath) })
    runtime.registerConsumer(
      { consumerId: 'product-a.consumer', owner: 'product', productId: 'product-a', topics: ['product-a.event.created'] },
      handler
    )

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ payload: { id: 'exact-target' } }), expect.anything())
    const recoveryStorage = createEventBusJsonStorage(filePath)
    await vi.waitFor(async () => {
      expect((await readState(recoveryStorage)).deliveries.find((delivery) => delivery.eventId === 'evt-unambiguous')).toMatchObject({
        status: 'completed', attemptCount: 1
      })
    })
    const recovered = await readState(recoveryStorage)
    expect(recovered.deliveries.find((delivery) => delivery.eventId === 'evt-1')).toMatchObject({
      status: 'blocked', lastError: 'legacy-event-identity-ambiguous', attemptCount: 0
    })
    await expect(runtime.getDiagnostics()).resolves.toMatchObject({
      blockedDeliveries: [expect.objectContaining({ eventId: 'evt-1', lastError: 'legacy-event-identity-ambiguous' })]
    })

    await rm(directory, { recursive: true, force: true })
  })

  it('retries failed deliveries and moves exhausted attempts to dead-letter', async () => {
    resetEventBusIdCountersForTests()
    const store = createEventBusStore()
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('temporary'))
    const runtime = createEventBusRuntime({ store })

    runtime.registerConsumer(
      {
        consumerId: 'product-a.consumer',
        owner: 'product',
        productId: 'product-a',
        topics: ['product-a.event.created'],
        retryPolicy: { maxAttempts: 3, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 }
      },
      handler
    )

    await runtime.publish({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      payload: { id: '1' }
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(store.getState().deliveries[0]?.status).toBe('pending')
    expect(store.getState().deliveries[0]?.attemptCount).toBe(1)

    await runtime.dispatchPending()
    expect(handler).toHaveBeenCalledTimes(2)
    expect(store.getState().deliveries[0]?.status).toBe('pending')
    expect(store.getState().deliveries[0]?.attemptCount).toBe(2)

    await runtime.dispatchPending()
    expect(handler).toHaveBeenCalledTimes(3)
    expect(store.getState().deliveries[0]?.status).toBe('dead-letter')
    expect(store.getCheckpoint('product-a.consumer')).toBeUndefined()
  })

  it('keeps consumer handlers idempotent across duplicate dispatch', async () => {
    resetEventBusIdCountersForTests()
    const store = createEventBusStore()
    let processed = 0
    const runtime = createEventBusRuntime({ store })

    runtime.registerConsumer(
      {
        consumerId: 'product-a.consumer',
        owner: 'product',
        productId: 'product-a',
        topics: ['product-a.event.created']
      },
      async () => {
        processed += 1
      }
    )

    const event = await runtime.publish({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      payload: { id: '1' }
    })

    const delivery = store.getState().deliveries[0]!
    store.updateDelivery(delivery, { status: 'pending', completedAt: undefined })
    await runtime.dispatchPending()

    expect(processed).toBe(2)
    expect(store.getCheckpoint('product-a.consumer')?.lastCompletedEventId).toBe(event.eventId)
  })

  it('backfills deliveries when a consumer registers after events were published', async () => {
    resetEventBusIdCountersForTests()
    const store = createEventBusStore()
    const runtime = createEventBusRuntime({ store })
    const handler = vi.fn(async (_event: PlatformEventEnvelope) => undefined)

    const event = await runtime.publish({
      topic: 'product-a.event.created',
      producer: { owner: 'product', productId: 'product-a' },
      schemaVersion: 1,
      payload: { id: 'late-consumer' }
    })

    expect(store.getState().deliveries).toHaveLength(0)

    runtime.registerConsumer(
      {
        consumerId: 'product-a.consumer',
        owner: 'product',
        productId: 'product-a',
        topics: ['product-a.event.created']
      },
      handler
    )

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    expect(store.getState().deliveries).toHaveLength(1)
    expect(store.getCheckpoint('product-a.consumer')?.lastCompletedEventId).toBe(event.eventId)
  })

  it('tells a missing store apart from a corrupt one, and still reads a complete legacy state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'event-bus-runtime-'))
    const filePath = join(directory, 'event-bus.json')
    const storage = createEventBusJsonStorage(filePath)
    const expected = {
      events: [{ eventId: 'event-1' }],
      deliveries: [{ deliveryId: 'delivery-1' }],
      checkpoints: [{ consumerId: 'consumer-1' }]
    }

    // 主文件不存在 = 首次安装：`empty`（带一份默认状态，写会重新开一份）。
    await expect(storage.read()).resolves.toEqual({ integrity: 'empty', state: createDefaultEventBusStoreState() })

    // 空文件与截断文件是**有内容但读不懂**，不是「从来没有过数据」——今天丢数据就是从这里进的。
    await writeFile(filePath, '', 'utf8')
    await expect(storage.read()).resolves.toEqual({ integrity: 'corrupt', problem: 'invalid-json' })

    await writeFile(filePath, '{"events":', 'utf8')
    await expect(storage.read()).resolves.toEqual({ integrity: 'corrupt', problem: 'invalid-json' })

    // 闸门之前的完整旧文件（无 formatVersion / checksum）：读得出、行不变，标 legacy。
    await writeFile(filePath, JSON.stringify(expected), 'utf8')
    await expect(storage.read()).resolves.toEqual({ integrity: 'unverified-legacy', state: expected })

    await rm(directory, { recursive: true, force: true })
  })

  it('replaces persisted state atomically without truncating a readable prior state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'event-bus-runtime-'))
    const filePath = join(directory, 'event-bus.json')
    const temporaryPath = `${filePath}.next`
    const storage = createEventBusJsonStorage(filePath)
    const prior = createPersistedState('prior')

    await storage.write(prior)
    await expect(access(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' })

    await mkdir(temporaryPath)
    await expect(storage.write(createPersistedState('next'))).rejects.toBeDefined()
    await expect(readState(storage)).resolves.toEqual(prior)
    // 磁盘上是 v1 信封（formatVersion + checksum）+ 原样 payload；比较 payload 本身。
    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    expect(persisted.formatVersion).toBe(1)
    expect(persisted).toMatchObject(prior)

    await rm(directory, { recursive: true, force: true })
  })

  it('serializes overlapping writes so the later requested state replaces the earlier one', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'event-bus-runtime-'))
    const filePath = join(directory, 'event-bus.json')
    const temporaryPath = `${filePath}.next`
    const storage = createEventBusJsonStorage(filePath)
    let releaseFirstRename: (() => void) | undefined
    const firstRenamePaused = new Promise<void>((resolve) => {
      let renameCount = 0
      eventBusJsonFileControls.beforeRename = async (from) => {
        if (from !== temporaryPath || renameCount++ > 0) return
        resolve()
        await new Promise<void>((release) => {
          releaseFirstRename = release
        })
      }
    })
    const first = createPersistedState('first')
    const second = createPersistedState('second')

    const firstWrite = storage.write(first)
    await firstRenamePaused
    const secondWrite = storage.write(second)
    releaseFirstRename?.()

    await expect(Promise.all([firstWrite, secondWrite])).resolves.toEqual([undefined, undefined])
    await expect(readState(storage)).resolves.toEqual(second)
    await expect(access(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' })

    eventBusJsonFileControls.beforeRename = undefined
    await rm(directory, { recursive: true, force: true })
  })

  it('keeps the prior file readable after a queued write fails and permits a later valid write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'event-bus-runtime-'))
    const filePath = join(directory, 'event-bus.json')
    const temporaryPath = `${filePath}.next`
    const storage = createEventBusJsonStorage(filePath)
    const prior = createPersistedState('prior')
    const later = createPersistedState('later')

    await storage.write(prior)
    await mkdir(temporaryPath)
    await expect(storage.write(createPersistedState('failed'))).rejects.toBeDefined()
    await expect(readState(storage)).resolves.toEqual(prior)
    await rm(temporaryPath, { recursive: true, force: true })

    await expect(storage.write(later)).resolves.toBeUndefined()
    await expect(readState(storage)).resolves.toEqual(later)

    await rm(directory, { recursive: true, force: true })
  })

  it('contains background hydration failures without dispatching an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const handler = vi.fn(async (_event: PlatformEventEnvelope) => undefined)
    const runtime = createEventBusRuntime({
      storage: {
        read: vi.fn(async (): Promise<EventBusStorageReadResult> => {
          throw new Error('storage unavailable')
        }),
        write: vi.fn(async () => undefined)
      }
    })

    runtime.registerConsumer(
      {
        consumerId: 'product-a.consumer',
        owner: 'product',
        productId: 'product-a',
        topics: ['product-a.event.created']
      },
      handler
    )

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('Event bus background operation failed.'))
    expect(handler).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('contains background persistence failures behind the fixed diagnostic', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const runtime = createEventBusRuntime({
      storage: {
        read: vi.fn(async () => ({ integrity: 'empty' as const, state: createDefaultEventBusStoreState() })),
        write: vi.fn(async () => {
          throw new Error('disk unavailable')
        })
      }
    })

    runtime.registerConsumer(
      { consumerId: 'product-a.consumer', owner: 'product', productId: 'product-a', topics: ['product-a.event.created'] },
      async () => undefined
    )

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('Event bus background operation failed.'))
    warn.mockRestore()
  })

  it('contains consumer dispatch failure in the persisted delivery state during background backfill', async () => {
    const store = createEventBusStore()
    const event = store.appendEvent(
      {
        topic: 'product-a.event.created',
        producer: { owner: 'product', productId: 'product-a' },
        schemaVersion: 1,
        payload: { id: '1' }
      },
      '2026-08-20T00:00:00.000Z'
    )
    const handler = vi.fn(async () => {
      throw new Error('consumer failed')
    })
    const runtime = createEventBusRuntime({ store })

    runtime.registerConsumer(
      { consumerId: 'product-a.consumer', owner: 'product', productId: 'product-a', topics: ['product-a.event.created'] },
      handler
    )

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    expect(store.getState().deliveries).toMatchObject([
      { eventId: event.eventId, consumerId: 'product-a.consumer', status: 'pending', attemptCount: 1 }
    ])
  })

  it('shares one in-flight hydration across concurrent consumer registration', async () => {
    let resolveRead: ((outcome: EventBusStorageReadResult) => void) | undefined
    const read = vi.fn(
      () => new Promise<EventBusStorageReadResult>((resolve) => {
        resolveRead = resolve
      })
    )
    const runtime = createEventBusRuntime({
      storage: {
        read,
        write: vi.fn(async () => undefined)
      }
    })

    runtime.registerConsumer(
      { consumerId: 'product-a.consumer', owner: 'product', productId: 'product-a', topics: ['product-a.event.created'] },
      async () => undefined
    )
    runtime.registerConsumer(
      { consumerId: 'product-b.consumer', owner: 'product', productId: 'product-b', topics: ['product-b.event.created'] },
      async () => undefined
    )

    await Promise.resolve()
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(1)

    resolveRead?.({ integrity: 'empty', state: createDefaultEventBusStoreState() })
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  })
})
