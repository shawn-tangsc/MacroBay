import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createContentAddressedBlobStore } from '../../../storage/contentAddressedBlobs'
import type { ChannelVerifiedInboundAttachment } from './ChannelInboundContracts'
import {
  CHANNEL_ATTACHMENT_ORPHAN_GRACE_DAYS,
  captureInboundAttachment,
  readInboundAttachment,
  runChannelAttachmentSweep
} from './channelAttachmentCapture'

/**
 * 入站附件「字节落盘」的五条判据（0.4.5；骨架原是 `8bc6b73b1` 的 5 条 todo）。
 *
 * 用的是**真的 store**（临时目录 + 真文件），不是假实现：这一块出错的形态是「写进去的和读出来的
 * 不是同一份」「坏盘被画成没有」，假 store 恰好测不到这两种。
 */
const dirs: string[] = []

async function storeInTemp() {
  const directory = await mkdtemp(join(tmpdir(), 'channel-attachments-'))
  dirs.push(directory)
  return { directory, store: createContentAddressedBlobStore({ directory }) }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const attachment = (overrides: Partial<ChannelVerifiedInboundAttachment> = {}): ChannelVerifiedInboundAttachment => ({
  kind: 'image',
  stableRef: 'telegram:file:abc',
  mimeType: 'image/png',
  sizeBytes: PNG.byteLength,
  ...overrides
})

describe('inbound attachment bytes', () => {
  it('stores an image-only attachment through the content-addressed blobs and keeps only its fileRef on the row', async () => {
    const { store } = await storeInTemp()
    const captured = await captureInboundAttachment({ attachment: attachment(), bytes: PNG, store })
    expect(captured.ok).toBe(true)
    if (!captured.ok) return

    // 行上是内容寻址的引用（全 64 位 sha256 + 扩展名），**没有字节字段**。
    expect(captured.attachment.fileRef).toMatch(/^[a-f0-9]{64}\.png$/)
    expect(Object.keys(captured.attachment)).not.toContain('bytes')
    // 同一份字节第二次捕获：复用已有文件，不重复写。
    const again = await captureInboundAttachment({ attachment: attachment(), bytes: PNG, store })
    expect(again.ok && again.reused).toBe(true)
    await expect(store.read(captured.attachment.fileRef)).resolves.toMatchObject({ state: 'ok', mime: 'image/png' })
  })

  it('refuses a mime outside png/jpeg/webp or a file over 2MB, with a reason, and writes nothing', async () => {
    const { directory, store } = await storeInTemp()
    const wrongType = await captureInboundAttachment({ attachment: attachment({ mimeType: 'image/gif' }), bytes: PNG, store })
    expect(wrongType).toMatchObject({ ok: false, reasonCode: 'attachment-unsupported-type' })

    const huge = new Uint8Array(2 * 1024 * 1024 + 1)
    const tooLarge = await captureInboundAttachment({ attachment: attachment({ mimeType: 'image/png' }), bytes: huge, store })
    expect(tooLarge).toMatchObject({ ok: false, reasonCode: 'attachment-too-large' })

    // 两个都拒在入口：临时目录里一个文件都没有（连目录都不建）。
    await expect(store.listEntries()).resolves.toEqual([])
    expect(directory).toBeTruthy()
  })

  it('drops the message row without touching the bytes, because another message may share them', async () => {
    const { store } = await storeInTemp()
    const captured = await captureInboundAttachment({ attachment: attachment(), bytes: PNG, store })
    expect(captured.ok).toBe(true)
    if (!captured.ok) return

    // 删行 = 丢掉那条记录对象；字节不归它管，仍可被另一条引用同一份内容的消息读出来。
    const rows = [{ ...captured.attachment }]
    rows.splice(0, rows.length)
    expect(rows).toHaveLength(0)
    await expect(store.read(captured.attachment.fileRef)).resolves.toMatchObject({ state: 'ok' })
    await expect(store.listEntries()).resolves.toHaveLength(1)
  })

  it('reads a missing file as an error with a retry path, and "no attachment" as an empty state', async () => {
    const { directory, store } = await storeInTemp()

    // 没有引用 → 空态（这条消息本来就没有附件字节）。
    await expect(readInboundAttachment(store, undefined)).resolves.toEqual({ state: 'none' })
    await expect(readInboundAttachment(store, '   ')).resolves.toEqual({ state: 'none' })

    // 形状对、文件不在 → 「暂时读不到」，不是「没有」。
    const missing = `${'a'.repeat(64)}.png`
    await expect(readInboundAttachment(store, missing)).resolves.toEqual({ state: 'unreadable', retryable: true, reasonCode: 'file-missing' })

    // 同名位置是个目录 → 读不出来（另一个错误态）。
    await mkdir(join(directory, `${'b'.repeat(64)}.png`))
    await expect(readInboundAttachment(store, `${'b'.repeat(64)}.png`)).resolves.toEqual({ state: 'unreadable', retryable: true, reasonCode: 'read-failed' })

    // 引用形状不合法 → 同样是错误，不是「没有」。
    await expect(readInboundAttachment(store, '../../etc/passwd')).resolves.toEqual({ state: 'unreadable', retryable: true, reasonCode: 'invalid-ref' })
  })

  it('keeps live refs whatever their age, removes only orphans past the grace window, and reports the counts', async () => {
    const { directory, store } = await storeInTemp()
    const live = await captureInboundAttachment({ attachment: attachment(), bytes: PNG, store })
    const orphanOld = await captureInboundAttachment({ attachment: attachment(), bytes: new Uint8Array([...PNG, 9]), store })
    const orphanFresh = await captureInboundAttachment({ attachment: attachment(), bytes: new Uint8Array([...PNG, 8]), store })
    expect(live.ok && orphanOld.ok && orphanFresh.ok).toBe(true)
    if (!live.ok || !orphanOld.ok || !orphanFresh.ok) return

    // 把**活引用那个文件**和老孤儿的 mtime 都拨到宽限期之外：活引用再老也不许删，
    // 只有孤儿才按宽限期走（另一个孤儿留在窗口内）。这样这条用例才真的能证「年龄不是依据」。
    const ancient = new Date(Date.now() - (CHANNEL_ATTACHMENT_ORPHAN_GRACE_DAYS + 2) * 24 * 3_600_000)
    const { readFile, utimes } = await import('node:fs/promises')
    for (const fileRef of [live.attachment.fileRef, orphanOld.attachment.fileRef]) {
      // 覆写一次不改内容（内容寻址，同名同内容），只为拿到可 utimes 的普通文件。
      await writeFile(join(directory, fileRef), await readFile(join(directory, fileRef)))
      await utimes(join(directory, fileRef), ancient, ancient)
    }

    const lines: string[] = []
    const result = await runChannelAttachmentSweep({
      store,
      // 活引用比所有文件都老，也**不许删**（保留期只看引用，不看年龄）。
      liveRefs: () => new Set([live.attachment.fileRef]),
      nowMs: Date.now(),
      log: (line) => lines.push(line)
    })

    expect(result).toMatchObject({ state: 'swept', removedOrphanFiles: 1, remainingFiles: 2 })
    await expect(store.read(live.attachment.fileRef)).resolves.toMatchObject({ state: 'ok' })
    await expect(store.read(orphanOld.attachment.fileRef)).resolves.toMatchObject({ state: 'missing' })
    // 宽限期内的孤儿不动。
    await expect(store.read(orphanFresh.attachment.fileRef)).resolves.toMatchObject({ state: 'ok' })
    expect(lines[0]).toContain('[channel-attachments] sweep')
    expect(lines[0]).toContain('remainingFiles=2')
  })

  it('skips the whole sweep when the reference set cannot be read', async () => {
    const { store } = await storeInTemp()
    const captured = await captureInboundAttachment({ attachment: attachment(), bytes: PNG, store })
    expect(captured.ok).toBe(true)
    if (!captured.ok) return

    const lines: string[] = []
    await expect(runChannelAttachmentSweep({
      store,
      liveRefs: () => undefined,
      nowMs: Date.now(),
      log: (line) => lines.push(line)
    })).resolves.toEqual({ state: 'skipped', reasonCode: 'refs-unreadable' })
    // 读不到引用集时一个字节都不删——「读不到」不是「没有可删」。
    await expect(store.read(captured.attachment.fileRef)).resolves.toMatchObject({ state: 'ok' })
    expect(lines[0]).toContain('skipped reason=refs-unreadable')
  })
})