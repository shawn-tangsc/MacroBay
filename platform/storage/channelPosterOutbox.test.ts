import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CHANNEL_POSTER_RETENTION_MS,
  MAX_CHANNEL_POSTER_BYTES,
  channelPosterEditionId,
  createChannelPosterOutbox
} from './channelPosterOutbox'

/**
 * 日报海报的暂存区（方案 §1/§2）。
 *
 * 判据全在「来源记录 + 版本绑定」上：目录里有什么不算数（`channel-outbox/` 会有残留），
 * 体积在写盘**之前**判，格式按字节头嗅探，`editionId` 只有一种拼法。
 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20])

const EDITION = { date: '2026-11-12', periodId: 'default', locale: 'zh-CN' }
const NOW = '2026-11-12T12:00:00.000Z'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'channel-outbox-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function outbox(now = NOW) {
  return createChannelPosterOutbox({ directory: dir, now: () => now })
}

describe('storing a poster', () => {
  it('writes the bytes under a content hash and records the edition', async () => {
    const store = outbox()
    const stored = await store.store({ edition: EDITION, bytes: PNG, mime: 'image/png' })
    expect(stored.ok).toBe(true)
    if (!stored.ok) throw new Error('unreachable')
    expect(stored.record).toMatchObject({ kind: 'briefing-poster', editionId: channelPosterEditionId(EDITION), mime: 'image/png' })
    // 文件名是内容 hash，不含日期/版本：内容幂等，也不泄露读者信息。
    expect(stored.record.fileName).toMatch(/^[0-9a-f]{32}\.png$/u)
    const files = readdirSync(dir).sort()
    expect(files).toContain(stored.record.fileName)
    expect(files).toContain('records.json')
  })

  it('rejects 8 MB+1 before touching the disk', async () => {
    const store = outbox()
    const oversize = new Uint8Array(MAX_CHANNEL_POSTER_BYTES + 1)
    oversize.set(PNG.subarray(0, 8))
    await expect(store.store({ edition: EDITION, bytes: oversize, mime: 'image/png' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-too-large', detail: `bytes=${oversize.byteLength}` })
    // 写盘前就拒：目录里连记录文件都不该出现。
    expect(readdirSync(dir)).toEqual([])
  })

  it('decides the format by the byte signature, not by the declared mime', async () => {
    const store = outbox()
    // 声明 png、实际 webp：本版不收 webp（与频道图片同一条规则）。
    await expect(store.store({ edition: EDITION, bytes: WEBP, mime: 'image/png' }))
      .resolves.toMatchObject({ ok: false, code: 'delivery-image-unsupported' })
    // 声明 png、实际 jpeg：按字节放行，扩展名跟着真实格式。
    const jpeg = await store.store({ edition: EDITION, bytes: JPEG, mime: 'image/png' })
    expect(jpeg).toMatchObject({ ok: true })
    if (!jpeg.ok) throw new Error('unreachable')
    expect(jpeg.record.mime).toBe('image/jpeg')
    expect(jpeg.record.fileName.endsWith('.jpg')).toBe(true)
  })

  it('keeps exactly one record per edition: re-sending the same edition overwrites it', async () => {
    const store = outbox()
    await store.store({ edition: EDITION, bytes: PNG, mime: 'image/png' })
    const second = await store.store({ edition: EDITION, bytes: JPEG, mime: 'image/jpeg' })
    expect(second).toMatchObject({ ok: true })
    const records = JSON.parse(await readFile(join(dir, 'records.json'), 'utf8')) as Record<string, { mime: string }>
    expect(Object.keys(records)).toEqual([channelPosterEditionId(EDITION)])
    expect(Object.values(records)[0]?.mime).toBe('image/jpeg')
  })
})

describe('reading a poster back', () => {
  it('returns the stored bytes for the same edition', async () => {
    const store = outbox()
    await store.store({ edition: EDITION, bytes: PNG, mime: 'image/png' })
    const read = await store.read(EDITION)
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error('unreachable')
    expect(read.mime).toBe('image/png')
    expect(read.bytes.byteLength).toBe(PNG.byteLength)
  })

  it('does not serve a stale edition, and never by directory scan', async () => {
    const store = outbox()
    await store.store({ edition: EDITION, bytes: PNG, mime: 'image/png' })
    // 上一版/别的 period 来要：没有记录，就是没有（不看目录里躺了什么）。
    await expect(store.read({ ...EDITION, periodId: 'evening' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail: 'missing' })
  })

  it('ignores a file that sits in the folder without a source record', async () => {
    // 残留文件（上一版、失败重试）不足以成为来源：判据是记录，不是目录内容。
    await mkdir(dir, { recursive: true })
    writeFileSync(join(dir, 'stray.png'), PNG)
    await expect(outbox().read(EDITION))
      .resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail: 'missing' })
  })

  it('separates "gone" from "cannot read"', async () => {
    const store = outbox()
    const stored = await store.store({ edition: EDITION, bytes: PNG, mime: 'image/png' })
    if (!stored.ok) throw new Error('unreachable')
    rmSync(join(dir, stored.record.fileName))
    await expect(store.read(EDITION)).resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail: 'read-failed' })
  })

  it('treats an expired record as unavailable instead of sending an old poster', async () => {
    const stored = await outbox().store({ edition: EDITION, bytes: PNG, mime: 'image/png' })
    expect(stored.ok).toBe(true)
    const later = new Date(Date.parse(NOW) + CHANNEL_POSTER_RETENTION_MS + 1_000).toISOString()
    await expect(outbox(later).read(EDITION))
      .resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail: 'expired' })
  })
})

describe('cleanup', () => {
  it('removes only expired records and leaves a trace instead of deleting silently', async () => {
    const traces: string[] = []
    const store = createChannelPosterOutbox({ directory: dir, now: () => NOW })
    await store.store({ edition: EDITION, bytes: PNG, mime: 'image/png' })
    const later = new Date(Date.parse(NOW) + CHANNEL_POSTER_RETENTION_MS + 1_000).toISOString()
    const pruner = createChannelPosterOutbox({ directory: dir, now: () => later, onPrune: (entry) => traces.push(entry.fileName) })
    const removed = await pruner.prune()
    expect(removed).toHaveLength(1)
    expect(traces).toEqual(removed)
    const records = JSON.parse(await readFile(join(dir, 'records.json'), 'utf8')) as Record<string, unknown>
    expect(records).toEqual({})
    expect(readdirSync(dir).filter((name) => name !== 'records.json')).toEqual([])
  })

  it('keeps a fresh poster', async () => {
    const store = outbox()
    await store.store({ edition: EDITION, bytes: PNG, mime: 'image/png' })
    await expect(store.prune()).resolves.toEqual([])
    await expect(store.read(EDITION)).resolves.toMatchObject({ ok: true })
  })
})
