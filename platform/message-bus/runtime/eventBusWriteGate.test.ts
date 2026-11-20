import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { EventBusWriteBlockedError } from '../store/eventBusJsonStorage'
import { serializeEventBusState } from '../store/eventBusStoreFormat'
import { createDefaultEventBusStoreState } from '../store/eventBusStore'
import { createEventBusJsonStorage, createEventBusRuntime } from './eventBusRuntime'

/**
 * 阻断态在运行时里的四条行为（方案 §3 / §7 的 2、5、8 与「启动裁剪不写」）：
 *
 * - 写被拒 → `publish` / `publishDurably` **reject**，不返回事件对象；
 * - **内存不留幽灵事件**：写失败要把这一笔撤回，后续成功写也不许把它带出去；
 * - 阻断态下 **dispatch 停**、**裁剪不写**（今天真正丢数据的那一步）；
 * - `archiveCorruptStore()` 是唯一出路，且只能显式调用。
 */
const directorys: string[] = []
afterEach(async () => {
  await Promise.all(directorys.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

async function storeFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'event-bus-gate-runtime-'))
  directorys.push(directory)
  return join(directory, 'event-bus.json')
}

const eventInput = {
  topic: 'product-a.event.created',
  producer: { owner: 'product' as const, productId: 'product-a' },
  schemaVersion: 1,
  payload: { id: 'x' }
}

describe('event bus write gate (runtime)', () => {
  it('rejects a publish on a corrupt store and leaves the bad file byte-for-byte intact', async () => {
    const filePath = await storeFile()
    const corruptBytes = '{"events": ['
    await writeFile(filePath, corruptBytes, 'utf8')
    const runtime = createEventBusRuntime({ storage: createEventBusJsonStorage(filePath) })

    await expect(runtime.publish(eventInput)).rejects.toBeInstanceOf(EventBusWriteBlockedError)
    await expect(runtime.publishDurably(eventInput)).rejects.toMatchObject({
      code: 'event-bus-write-blocked',
      reason: 'corrupt'
    })
    // 坏文件原地留着：不自动修复、不改名、不覆盖。
    expect(await readFile(filePath, 'utf8')).toBe(corruptBytes)
    await expect(stat(`${filePath}.next`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('blocks publishing on a future-format file instead of downgrading it', async () => {
    const filePath = await storeFile()
    await writeFile(filePath, JSON.stringify({ formatVersion: 2, events: [], deliveries: [], checkpoints: [] }), 'utf8')
    const runtime = createEventBusRuntime({ storage: createEventBusJsonStorage(filePath) })

    await expect(runtime.publish(eventInput)).rejects.toMatchObject({ reason: 'future-version' })
  })

  it('does not let a failed write leave a ghost event behind', async () => {
    const filePath = await storeFile()
    const runtime = createEventBusRuntime({ storage: createEventBusJsonStorage(filePath) })
    // 让写盘失败一次：`.next` 位置上放一个目录，临时文件写不进去。
    await mkdir(`${filePath}.next`, { recursive: true })

    await expect(runtime.publish(eventInput)).rejects.toBeDefined()

    // 写失败 → 这一笔从内存撤回：诊断里查不到，后续成功写也不会把它带出去。
    const afterFailure = await runtime.getDiagnostics({})
    expect(afterFailure.recentEvents).toEqual([])

    await rm(`${filePath}.next`, { recursive: true, force: true })
    const kept = await runtime.publish({ ...eventInput, payload: { id: 'kept' } })
    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { events: { eventId: string }[] }
    expect(persisted.events.map((event) => event.eventId)).toEqual([kept.eventId])
    expect((await runtime.getDiagnostics({})).recentEvents.map((event) => event.eventId)).toEqual([kept.eventId])
  })

  it('leaves a blocked store alone through the whole startup path: no prune write, still blocked', async () => {
    const filePath = await storeFile()
    const corruptBytes = '{"deliveries": ['
    await writeFile(filePath, corruptBytes, 'utf8')
    const storage = createEventBusJsonStorage(filePath)
    const write = vi.spyOn(storage, 'write')
    const runtime = createEventBusRuntime({ storage })

    // 今天真正丢数据的那一步是「读完之后的任何一次 persist 把空写回」——启动裁剪是其中最早的那次。
    await expect(runtime.pruneRetained()).resolves.toEqual({ removedEvents: 0, removedDeliveries: 0 })
    expect(write).not.toHaveBeenCalled()
    expect(await readFile(filePath, 'utf8')).toBe(corruptBytes)
    // 而且它没有被「悄悄当成空文件」：裁剪之后仍然是阻断态，发布照旧被拒。
    await expect(runtime.publish(eventInput)).rejects.toBeInstanceOf(EventBusWriteBlockedError)
    expect(await readFile(filePath, 'utf8')).toBe(corruptBytes)
  })

  it('stops dispatching while blocked, and only an explicit archive lets writing resume', async () => {
    const filePath = await storeFile()
    await writeFile(filePath, '{"events": [', 'utf8')
    const runtime = createEventBusRuntime({ storage: createEventBusJsonStorage(filePath) })
    const handler = vi.fn(async () => undefined)
    runtime.registerConsumer(
      { consumerId: 'product-a.consumer', owner: 'product', productId: 'product-a', topics: ['product-a.event.created'] },
      handler
    )

    await expect(runtime.dispatchPending()).resolves.toBeUndefined()
    expect(handler).not.toHaveBeenCalled()

    // 显式归档是唯一出路：归档后主文件缺失 = empty，写重新被允许。
    const archived = await runtime.archiveCorruptStore()
    expect(archived?.reason).toBe('corrupt')
    const published = await runtime.publish({ ...eventInput, payload: { id: 'after-archive' } })
    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { formatVersion: number; events: { eventId: string }[] }
    expect(persisted.formatVersion).toBe(1)
    expect(persisted.events.map((event) => event.eventId)).toEqual([published.eventId])
  })

  describe('diagnostics tell a blocked file apart from a new feature failing to write', () => {
    it('reports integrity and blocked for a corrupt file, and says which problem it was in one log line', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const filePath = await storeFile()
      await writeFile(filePath, '{"events": [', 'utf8')
      const runtime = createEventBusRuntime({ storage: createEventBusJsonStorage(filePath) })

      // 「没有事件」与「文件坏了」必须是两句：events: 0 + integrity: corrupt + blocked: true。
      await expect(runtime.getDiagnostics()).resolves.toMatchObject({
        integrity: 'corrupt',
        blocked: true,
        recentEvents: []
      })
      expect(warn).toHaveBeenCalledWith('event-bus-store-blocked reason=invalid-json')
      warn.mockRestore()
    })

    it('names the future-version and checksum-mismatch reasons the same way', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      const futurePath = await storeFile()
      await writeFile(futurePath, JSON.stringify({ formatVersion: 2, events: [], deliveries: [], checkpoints: [] }), 'utf8')
      const futureRuntime = createEventBusRuntime({ storage: createEventBusJsonStorage(futurePath) })
      await expect(futureRuntime.getDiagnostics()).resolves.toMatchObject({ integrity: 'future-version', blocked: true })
      expect(warn).toHaveBeenCalledWith('event-bus-store-blocked reason=future-version')

      warn.mockClear()
      const tamperedPath = await storeFile()
      const tampered = JSON.parse(serializeEventBusState(createDefaultEventBusStoreState())) as Record<string, unknown>
      tampered.events = [{ eventId: 'x', topic: 'tampered' }]
      await writeFile(tamperedPath, JSON.stringify(tampered), 'utf8')
      const tamperedRuntime = createEventBusRuntime({ storage: createEventBusJsonStorage(tamperedPath) })
      await expect(tamperedRuntime.getDiagnostics()).resolves.toMatchObject({ integrity: 'corrupt', blocked: true })
      expect(warn).toHaveBeenCalledWith('event-bus-store-blocked reason=checksum-mismatch')
      warn.mockRestore()
    })

    it('keeps blocked false when the gate is not the reason a write failed', async () => {
      const filePath = await storeFile()
      const runtime = createEventBusRuntime({ storage: createEventBusJsonStorage(filePath) })
      // 写失败来自磁盘（`.next` 位置被占），不是闸门：诊断必须仍然说「文件没问题」。
      await mkdir(`${filePath}.next`, { recursive: true })
      await expect(runtime.publish(eventInput)).rejects.toBeDefined()

      await expect(runtime.getDiagnostics()).resolves.toMatchObject({ integrity: 'empty', blocked: false })
      await rm(`${filePath}.next`, { recursive: true, force: true })
    })

    it('says empty for a first install and ok once the file is written', async () => {
      const filePath = await storeFile()
      const runtime = createEventBusRuntime({ storage: createEventBusJsonStorage(filePath) })

      await expect(runtime.getDiagnostics()).resolves.toMatchObject({ integrity: 'empty', blocked: false })
      await runtime.publish(eventInput)
      await expect(runtime.getDiagnostics()).resolves.toMatchObject({ integrity: 'ok', blocked: false })
    })

    it('calls a legacy file unverified-legacy, and ok after the first upgrade write', async () => {
      const filePath = await storeFile()
      await writeFile(filePath, JSON.stringify(createDefaultEventBusStoreState()), 'utf8')
      const runtime = createEventBusRuntime({ storage: createEventBusJsonStorage(filePath) })

      await expect(runtime.getDiagnostics()).resolves.toMatchObject({ integrity: 'unverified-legacy', blocked: false })
      await runtime.publish(eventInput)
      await expect(runtime.getDiagnostics()).resolves.toMatchObject({ integrity: 'ok', blocked: false })
    })

    it('reports empty and unblocked again after an explicit archive', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const filePath = await storeFile()
      await writeFile(filePath, '{"events": [', 'utf8')
      const runtime = createEventBusRuntime({ storage: createEventBusJsonStorage(filePath) })
      await expect(runtime.getDiagnostics()).resolves.toMatchObject({ integrity: 'corrupt', blocked: true })

      await runtime.archiveCorruptStore()
      await expect(runtime.getDiagnostics()).resolves.toMatchObject({ integrity: 'empty', blocked: false })
      warn.mockRestore()
    })
  })

  it('keeps a readable legacy store publishable and upgrades it on the next write', async () => {
    const filePath = await storeFile()
    await writeFile(filePath, JSON.stringify(createDefaultEventBusStoreState()), 'utf8')
    const runtime = createEventBusRuntime({ storage: createEventBusJsonStorage(filePath) })

    const event = await runtime.publish(eventInput)
    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    // 旧文件不是「坏了」：照常发布，写一次即升级为 v1（信封变了，行是新的那一行）。
    expect(persisted.formatVersion).toBe(1)
    expect((persisted.events as { eventId: string }[]).map((entry) => entry.eventId)).toEqual([event.eventId])
    expect(serializeEventBusState(createDefaultEventBusStoreState())).toContain('"formatVersion":1')
  })
})
