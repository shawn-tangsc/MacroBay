import { readFile, rm, stat, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDefaultEventBusStoreState, type EventBusStoreState } from './eventBusStore'
import { createEventBusJsonStorage } from './eventBusJsonStorage'
import { EventBusWriteBlockedError } from './eventBusJsonStorage'
import { parseEventBusStoreState, serializeEventBusState } from './eventBusStoreFormat'

/**
 * 闸门落在**唯一的落盘点**上：`createEventBusJsonStorage`。
 *
 * 这一组只测适配器本身（读结论 + 写拒绝 + 显式归档），运行时的行为在
 * `runtime/eventBusWriteGate.test.ts`。
 */
const directorys: string[] = []
afterEach(async () => {
  await Promise.all(directorys.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function storeFile(name = 'event-bus.json'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'event-bus-gate-'))
  directorys.push(directory)
  return join(directory, name)
}

function legacyState(eventId = 'evt-legacy'): EventBusStoreState {
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
    deliveries: [{ deliveryId: 'dlv-1', eventId, consumerId: 'product-a.consumer', status: 'pending', attemptCount: 0 }],
    checkpoints: [{ consumerId: 'product-a.consumer', lastCompletedRecordedAt: '2026-08-24T00:00:00.000Z', lastCompletedEventId: eventId, updatedAt: '2026-08-24T00:00:00.000Z' }]
  }
}

describe('event bus json storage gate', () => {
  it('calls a corrupt file corrupt, never empty, and refuses to write over it', async () => {
    const filePath = await storeFile()
    await writeFile(filePath, '{"events": [', 'utf8')
    const storage = createEventBusJsonStorage(filePath)

    await expect(storage.read()).resolves.toEqual({ integrity: 'corrupt', problem: 'invalid-json' })

    const before = await readFile(filePath, 'utf8')
    await expect(storage.write(createDefaultEventBusStoreState())).rejects.toBeInstanceOf(EventBusWriteBlockedError)
    // 一个字节都不写：坏文件原地留着，等读者决定归档还是手工处理。
    expect(await readFile(filePath, 'utf8')).toBe(before)
    await expect(stat(`${filePath}.next`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a future format instead of downgrading it', async () => {
    const filePath = await storeFile()
    await writeFile(filePath, JSON.stringify({ formatVersion: 2, events: [], deliveries: [], checkpoints: [] }), 'utf8')
    const storage = createEventBusJsonStorage(filePath)

    await expect(storage.read()).resolves.toEqual({ integrity: 'future-version', formatVersion: 2 })
    const blocked = storage.write(createDefaultEventBusStoreState())
    await expect(blocked).rejects.toMatchObject({ code: 'event-bus-write-blocked', reason: 'future-version' })
  })

  it('refuses a v1 file whose checksum no longer matches', async () => {
    const filePath = await storeFile()
    const tampered = JSON.parse(serializeEventBusState(legacyState())) as Record<string, unknown>
    tampered.events = [{ ...(tampered.events as Record<string, unknown>[])[0], topic: 'tampered' }]
    await writeFile(filePath, JSON.stringify(tampered), 'utf8')
    const storage = createEventBusJsonStorage(filePath)

    await expect(storage.read()).resolves.toEqual({ integrity: 'corrupt', problem: 'checksum-mismatch' })
    await expect(storage.write(createDefaultEventBusStoreState())).rejects.toMatchObject({
      code: 'event-bus-write-blocked',
      reason: 'checksum-mismatch'
    })
  })

  it('reads a leftover .next as empty (no main file) and leaves the leftover untouched', async () => {
    const filePath = await storeFile()
    // 半写入残留：只有 `.next`，主文件不存在 = 首次安装。
    await writeFile(`${filePath}.next`, '{"events":[', 'utf8')
    const storage = createEventBusJsonStorage(filePath)

    await expect(storage.read()).resolves.toEqual({ integrity: 'empty', state: createDefaultEventBusStoreState() })
    // 不自动改名：残留留在原处，等下一次正常写去覆盖。
    expect(await readFile(`${filePath}.next`, 'utf8')).toBe('{"events":[')
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('upgrades a legacy file on the first write and then writes the same bytes every time', async () => {
    const filePath = await storeFile()
    const legacy = legacyState()
    await writeFile(filePath, JSON.stringify(legacy), 'utf8')
    const storage = createEventBusJsonStorage(filePath)

    const before = await storage.read()
    expect(before.integrity).toBe('unverified-legacy')
    if (before.integrity !== 'unverified-legacy') return
    expect(before.state).toEqual(legacy)

    await storage.write(before.state)
    const firstBytes = await readFile(filePath, 'utf8')
    expect(parseEventBusStoreState(firstBytes)).toMatchObject({ integrity: 'ok' })
    // 行数与内容逐项不变：升级只换信封，不动数据。
    expect((JSON.parse(firstBytes) as EventBusStoreState).events).toEqual(legacy.events)

    await storage.write(before.state)
    expect(await readFile(filePath, 'utf8')).toBe(firstBytes)
  })

  it('archives a blocked file only when asked, and never on read', async () => {
    const filePath = await storeFile()
    const corruptBytes = '{"events": ['
    await writeFile(filePath, corruptBytes, 'utf8')
    const storage = createEventBusJsonStorage(filePath)

    expect((await storage.read()).integrity).toBe('corrupt')
    // 读一次不许碰文件（不自动修复、不改名、不覆盖）。
    expect(await readFile(filePath, 'utf8')).toBe(corruptBytes)
    expect(storage.archiveCorruptStore).toBeDefined()

    const archived = await storage.archiveCorruptStore!()
    expect(archived?.reason).toBe('corrupt')
    expect(archived?.archivedPath.startsWith(`${filePath}.corrupt-`)).toBe(true)
    // 归档 = 原样留一份 + marker 说清是谁；主文件不在了，下一次读是 empty，写重新被允许。
    expect(await readFile(archived!.archivedPath, 'utf8')).toBe(corruptBytes)
    const marker = JSON.parse(await readFile(archived!.markerPath, 'utf8')) as Record<string, unknown>
    expect(marker).toMatchObject({ reason: 'corrupt', filePath })
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(storage.read()).resolves.toEqual({ integrity: 'empty', state: createDefaultEventBusStoreState() })
    await expect(storage.write(createDefaultEventBusStoreState())).resolves.toBeUndefined()
  })
})
