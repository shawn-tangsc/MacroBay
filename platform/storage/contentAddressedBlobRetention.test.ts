import { rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createContentAddressedBlobStore, type ContentAddressedBlobStore } from './contentAddressedBlobs'
import { sweepContentAddressedBlobs } from './contentAddressedBlobRetention'

const DAY_MS = 24 * 3_600_000
const nowMs = Date.UTC(2026, 10, 24, 6, 0, 0)

let root = ''
let store: ContentAddressedBlobStore

function bytesFor(label: string): Uint8Array {
  return new TextEncoder().encode(label)
}

async function writeAt(label: string, ageDays: number): Promise<string> {
  const written = await store.write({ bytes: bytesFor(label), mime: 'image/png' })
  if (!written.ok) throw new Error(written.reasonCode)
  const ageSeconds = (nowMs - ageDays * DAY_MS) / 1_000
  await utimes(join(store.directory, written.fileRef), ageSeconds, ageSeconds)
  return written.fileRef
}

beforeEach(async () => {
  root = join(tmpdir(), `macrobay-blob-retention-${process.pid}-${Math.random().toString(36).slice(2)}`)
  store = createContentAddressedBlobStore({ directory: join(root, 'channel-attachments') })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('content addressed blob sweep', () => {
  it('never deletes a file a live row references, however old it is', async () => {
    const liveRef = await writeAt('still-referenced-and-ancient', 400)

    const result = await sweepContentAddressedBlobs({
      store,
      liveRefs: () => new Set([liveRef]),
      orphanGraceDays: 7,
      nowMs,
      includeOrphans: true
    })

    // 活引用：连年龄都不看。
    expect(result).toMatchObject({ state: 'swept', removedFiles: 0, removedOrphanFiles: 0, remainingFiles: 1 })
    expect(await store.read(liveRef)).toMatchObject({ state: 'ok' })
  })

  it('deletes the file whose row was deleted in this pass and reports the bytes', async () => {
    const droppedRef = await writeAt('row-deleted-this-pass', 1)

    const result = await sweepContentAddressedBlobs({
      store,
      liveRefs: () => new Set(),
      droppedRefs: new Set([droppedRef]),
      orphanGraceDays: 7,
      nowMs
    })

    // 过期文件不受孤儿宽限期保护：行已经没了，宽限它只会让磁盘一直涨。
    expect(result).toMatchObject({ state: 'swept', removedFiles: 1, removedOrphanFiles: 0 })
    expect(result.state === 'swept' && result.reclaimedBytes).toBe(bytesFor('row-deleted-this-pass').byteLength)
    expect(await store.read(droppedRef)).toMatchObject({ state: 'missing' })
  })

  it('keeps an orphan inside the grace window, and reclaims it only when asked', async () => {
    const fresh = await writeAt('orphan-written-a-moment-ago', 0)
    const stale = await writeAt('orphan-from-a-reset', 30)

    const keptBoth = await sweepContentAddressedBlobs({
      store, liveRefs: () => new Set(), orphanGraceDays: 7, nowMs, includeOrphans: false
    })
    expect(keptBoth).toMatchObject({ state: 'swept', removedFiles: 0, removedOrphanFiles: 0, remainingFiles: 2 })

    const swept = await sweepContentAddressedBlobs({
      store, liveRefs: () => new Set(), orphanGraceDays: 7, nowMs, includeOrphans: true
    })
    // 宽限期内的孤儿不动，过期孤儿才走：并发写到一半的文件不会被扫掉。
    expect(swept).toMatchObject({ state: 'swept', removedFiles: 0, removedOrphanFiles: 1, remainingFiles: 1 })
    expect(await store.read(fresh)).toMatchObject({ state: 'ok' })
    expect(await store.read(stale)).toMatchObject({ state: 'missing' })
  })

  it('reports what it would reclaim on a dry run without deleting anything', async () => {
    const droppedRef = await writeAt('dry-run', 30)

    const result = await sweepContentAddressedBlobs({
      store, liveRefs: () => new Set(), droppedRefs: new Set([droppedRef]), orphanGraceDays: 7, nowMs, dryRun: true
    })

    expect(result).toMatchObject({ state: 'swept', dryRun: true, removedFiles: 1 })
    expect(result.state === 'swept' && result.reclaimedBytes).toBe(bytesFor('dry-run').byteLength)
    expect(await store.read(droppedRef)).toMatchObject({ state: 'ok' })
  })

  it('says "cannot read" instead of "nothing to delete" when the directory is unreadable', async () => {
    await rm(store.directory, { recursive: true, force: true })

    const result = await sweepContentAddressedBlobs({
      store, liveRefs: () => new Set(), orphanGraceDays: 7, nowMs, includeOrphans: true
    })

    // 目录读不到就一个字节都不删：把「读不到」画成「没有可删」等于把坏盘当健康。
    expect(result).toEqual({ state: 'skipped', reasonCode: 'directory-unreadable' })
  })

  it('says "cannot read" when the row store cannot produce the live set', async () => {
    const keptRef = await writeAt('row-store-unreadable', 30)

    const result = await sweepContentAddressedBlobs({
      store, liveRefs: () => undefined, orphanGraceDays: 7, nowMs, includeOrphans: true
    })

    expect(result).toEqual({ state: 'skipped', reasonCode: 'refs-unreadable' })
    expect(await store.read(keptRef)).toMatchObject({ state: 'ok' })
  })
})