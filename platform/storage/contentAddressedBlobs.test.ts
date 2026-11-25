import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  contentAddressedBlobFileName,
  contentAddressedBlobPolicy,
  createContentAddressedBlobStore,
  normalizeBlobMime,
  sha256Hex,
  type ContentAddressedBlobStore
} from './contentAddressedBlobs'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

let root = ''
let store: ContentAddressedBlobStore

beforeEach(async () => {
  root = join(tmpdir(), `macrobay-blobs-${process.pid}-${Math.random().toString(36).slice(2)}`)
  store = createContentAddressedBlobStore({ directory: join(root, 'channel-attachments') })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

describe('content addressed blob store', () => {
  it('writes bytes once per content and reads back exactly what was written', async () => {
    const first = await store.write({ bytes: PNG_BYTES, mime: 'image/png' })
    expect(first).toMatchObject({ ok: true, mime: 'image/png', byteLength: PNG_BYTES.byteLength, reused: false })
    const fileRef = first.ok ? first.fileRef : ''
    // 名字只由内容决定：全 64 位 sha256 + 扩展名。
    expect(fileRef).toBe(contentAddressedBlobFileName(PNG_BYTES, 'png'))
    expect(contentAddressedBlobPolicy.fileRefPattern.test(fileRef)).toBe(true)

    // 同一份字节第二次写：同名字、标记复用，磁盘上仍然只有一个文件。
    const second = await store.write({ bytes: PNG_BYTES, mime: 'image/png' })
    expect(second).toMatchObject({ ok: true, fileRef, reused: true })
    expect(await readdir(store.directory)).toEqual([fileRef])

    const read = await store.read(fileRef)
    expect(read.state).toBe('ok')
    expect(read.state === 'ok' && [...read.bytes]).toEqual([...PNG_BYTES])
    expect(read.state === 'ok' && read.mime).toBe('image/png')
    // 写后读回校验：文件里的内容 hash 必须就是文件名里的那一段。
    expect(sha256Hex(PNG_BYTES)).toBe(fileRef.slice(0, 64))
  })

  it('refuses an oversized attachment and a type outside the whitelist with a reason code', async () => {
    const tooLarge = await store.write({ bytes: new Uint8Array(16), mime: 'image/png', maxBytes: 8 })
    expect(tooLarge).toMatchObject({ ok: false, reasonCode: 'blob_too_large' })

    const wrongType = await store.write({ bytes: PNG_BYTES, mime: 'application/pdf' })
    expect(wrongType).toMatchObject({ ok: false, reasonCode: 'unsupported_blob_type' })
    // 被拒的都不落盘：目录甚至还没建。
    await expect(stat(store.directory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('tells "not there" apart from "cannot read it"', async () => {
    const written = await store.write({ bytes: PNG_BYTES, mime: 'image/png' })
    const fileRef = written.ok ? written.fileRef : ''

    // 确实没有：合法名字，文件不存在。
    const absentRef = contentAddressedBlobFileName(new TextEncoder().encode('never-written'), 'png')
    expect(await store.read(absentRef)).toEqual({ state: 'missing' })

    const ok = await store.read(fileRef)
    expect(ok.state).toBe('ok')

    // 读不到：同名位置是个目录（模拟坏盘/权限），必须是 unreadable，不能折成 missing。
    const brokenRef = contentAddressedBlobFileName(new TextEncoder().encode('broken'), 'png')
    await mkdir(join(store.directory, brokenRef))
    expect(await store.read(brokenRef)).toEqual({ state: 'unreadable', reasonCode: 'read-failed' })

    // 路径穿越在入口即拒，不会读到目录外的东西。
    expect(await store.read('../escape.png')).toEqual({ state: 'invalid-ref', reasonCode: 'invalid-file-ref' })
  })

  it('describes only files it owns', async () => {
    const written = await store.write({ bytes: PNG_BYTES, mime: 'image/jpeg' })
    const fileRef = written.ok ? written.fileRef : ''
    // image/jpeg 归一成 .jpg 扩展名。
    expect(fileRef.endsWith('.jpg')).toBe(true)
    expect(await store.describe(fileRef)).toEqual({ fileRef, mime: 'image/jpeg', byteLength: PNG_BYTES.byteLength })
    expect(await store.describe('not-a-hash.png')).toBeNull()
    expect(await store.describe(contentAddressedBlobFileName(new TextEncoder().encode('gone'), 'png'))).toBeNull()
  })

  it('lists entries with size and modification time, and says "cannot read" instead of "empty"', async () => {
    expect(await store.listEntries()).toBeUndefined()

    const written = await store.write({ bytes: PNG_BYTES, mime: 'image/png' })
    const fileRef = written.ok ? written.fileRef : ''
    // 不是内容寻址形状的文件不属于这个 store，列表里不许出现（更不许删）。
    await writeFile(join(store.directory, 'notes.txt'), 'not mine', 'utf8')

    const entries = await store.listEntries()
    expect(entries?.map((entry) => entry.fileRef)).toEqual([fileRef])
    expect(entries?.[0]).toMatchObject({ mime: 'image/png', byteLength: PNG_BYTES.byteLength })
    expect(entries?.[0]?.modifiedAtMs).toBeGreaterThan(0)
  })

  it('deletes one file and reports the bytes, and says nothing for a file that is already gone', async () => {
    const written = await store.write({ bytes: PNG_BYTES, mime: 'image/png' })
    const fileRef = written.ok ? written.fileRef : ''

    expect(await store.deleteRef(fileRef)).toBe(PNG_BYTES.byteLength)
    expect(await store.read(fileRef)).toEqual({ state: 'missing' })
    expect(await store.deleteRef(fileRef)).toBeUndefined()
    expect(await store.deleteRef('../escape.png')).toBeUndefined()
  })

  it('normalizes the mime aliases the channels actually send', () => {
    expect(normalizeBlobMime('image/jpg')).toBe('image/jpeg')
    expect(normalizeBlobMime('IMAGE/PJPEG')).toBe('image/jpeg')
    expect(normalizeBlobMime('image/webp')).toBe('image/webp')
    expect(normalizeBlobMime('image/gif')).toBeNull()
  })
})