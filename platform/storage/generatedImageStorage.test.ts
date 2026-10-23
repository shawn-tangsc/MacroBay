import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createGeneratedImageStorage,
  MAX_STORED_IMAGE_BYTES
} from './generatedImageStorage'
import { generatedImageFileNamePattern } from '../ui/images/generatedImageUrl'

/**
 * T1：生成图片落盘。
 * - 文件名 = 内容 sha256 前 16 位 + 扩展名（不可预测、与 prompt 无关）；
 * - 目录不存在则创建；同一内容幂等；>2MB 拒绝且不落盘；
 * - 只接受 png/jpeg/webp，路径穿越一律拒绝。
 */
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
)

/** 最小 JPEG：SOI + SOF0(高 32 / 宽 64) + EOI。 */
const jpegBytes = Buffer.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03,
  0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9
])

describe('generatedImageStorage', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function storage(maxBytes?: number) {
    const dir = mkdtempSync(join(tmpdir(), 'sample-product-images-'))
    dirs.push(dir)
    const directory = join(dir, 'generated-images')
    return { directory, store: createGeneratedImageStorage({ directory, ...(maxBytes === undefined ? {} : { maxBytes }) }) }
  }

  it('writes a png under a sha256-prefixed deterministic file name and creates the directory', async () => {
    const { directory, store } = storage()

    const first = await store.write(pngBytes, 'image/png')
    const second = await store.write(pngBytes, 'image/png')

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('expected a stored image')
    // 目录原本不存在 ⇒ 自动创建
    expect(readdirSync(directory)).toEqual([first.file.fileName])
    expect(first.file.fileName).toMatch(generatedImageFileNamePattern)
    expect(first.file.fileName).toMatch(/^[a-f0-9]{16}\.png$/)
    expect(first.file.mime).toBe('image/png')
    expect(first.file.byteLength).toBe(pngBytes.byteLength)
    expect(first.file.width).toBe(1)
    expect(first.file.height).toBe(1)
    // 同一内容 ⇒ 同一文件名（幂等，不产生重复文件）
    expect(second.file.fileName).toBe(first.file.fileName)
    const stored = readFileSync(join(directory, first.file.fileName))
    expect(stored.equals(pngBytes)).toBe(true)
    expect(statSync(join(directory, first.file.fileName)).size).toBe(pngBytes.byteLength)
  })

  it('names different content differently and never derives the name from the prompt', async () => {
    const { store } = storage()
    const other = Buffer.from(pngBytes)
    other[other.length - 1] = 0x00

    const first = await store.write(pngBytes, 'image/png')
    const second = await store.write(other, 'image/png')

    if (!first.ok || !second.ok) throw new Error('expected stored images')
    expect(first.file.fileName).not.toBe(second.file.fileName)
    expect(first.file.fileName).not.toContain('prompt')
  })

  it('keeps the extension aligned with the mime type and reads jpeg dimensions', async () => {
    const { store } = storage()

    const jpeg = await store.write(jpegBytes, 'image/jpeg')
    const webp = await store.write(pngBytes, 'image/webp')

    if (!jpeg.ok || !webp.ok) throw new Error('expected stored images')
    expect(jpeg.file.fileName).toMatch(/\.jpg$/)
    expect(jpeg.file.width).toBe(64)
    expect(jpeg.file.height).toBe(32)
    expect(webp.file.fileName).toMatch(/\.webp$/)
  })

  it('refuses images over the size limit and writes nothing', async () => {
    const { directory, store } = storage()

    const outcome = await store.write(new Uint8Array(MAX_STORED_IMAGE_BYTES + 1), 'image/png')

    expect(outcome).toMatchObject({ ok: false, reasonCode: 'image_too_large' })
    // 拒绝时连目录都不创建：没有任何字节落盘
    expect(existsSync(directory)).toBe(false)
  })

  it('honours a caller-supplied size limit for larger source images', async () => {
    const { store } = storage()

    const rejected = await store.write(new Uint8Array(MAX_STORED_IMAGE_BYTES + 8), 'image/png')
    const accepted = await store.write(pngBytes, 'image/png', { maxBytes: 4 * MAX_STORED_IMAGE_BYTES })

    expect(rejected.ok).toBe(false)
    expect(accepted.ok).toBe(true)
  })

  it('rejects mime types outside png/jpeg/webp', async () => {
    const { directory, store } = storage()

    const outcome = await store.write(pngBytes, 'image/gif')

    expect(outcome).toMatchObject({ ok: false, reasonCode: 'unsupported_image_type' })
    expect(existsSync(directory)).toBe(false)
  })

  it('describes and reads only safe file names (no traversal)', async () => {
    const { store } = storage()
    const written = await store.write(pngBytes, 'image/png')
    if (!written.ok) throw new Error('expected a stored image')

    const described = await store.describe(written.file.fileName)
    expect(described).toMatchObject({ kind: 'image', mime: 'image/png', byteLength: pngBytes.byteLength })
    const read = await store.read(written.file.fileName)
    expect(read?.mime).toBe('image/png')
    expect(Buffer.from(read!.bytes).equals(pngBytes)).toBe(true)

    expect(await store.describe('../../etc/passwd')).toBeNull()
    expect(await store.describe('not-a-hash.png')).toBeNull()
    expect(await store.read('../secrets.png')).toBeNull()
    expect(store.pathFor('../secrets.png')).toBeNull()
    expect(await store.describe('0123456789abcdef.png')).toBeNull()
  })
})
