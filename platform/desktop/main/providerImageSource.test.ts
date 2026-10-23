import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createGeneratedImageStorage } from '../../storage/generatedImageStorage'
import { resolveImageEditSource } from './providerImageSource'

/**
 * T3：原图来源解析。
 * 会话内图片 ⇒ 只给文件名，由主进程读盘（渲染层永远拿不到路径）；
 * 上传图片 ⇒ 字节先落到 generated-images 再进请求，消息里同样只留引用。
 */
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
)

describe('resolveImageEditSource', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function storage() {
    const root = mkdtempSync(join(tmpdir(), 'sample-product-edit-source-'))
    dirs.push(root)
    return createGeneratedImageStorage({ directory: join(root, 'generated-images') })
  }

  it('reads a stored session image from disk by file name', async () => {
    const store = storage()
    const written = await store.write(pngBytes, 'image/png')
    if (!written.ok) throw new Error('expected a stored image')

    const resolved = await resolveImageEditSource(store, { kind: 'file', fileName: written.file.fileName })

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.stored).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      fileName: written.file.fileName,
      byteLength: pngBytes.byteLength,
      width: 1,
      height: 1
    })
    expect(Buffer.from(resolved.source.bytes).equals(pngBytes)).toBe(true)
    expect(resolved.source.mime).toBe('image/png')
  })

  it('rejects an unknown stored file name without reading anything', async () => {
    const store = storage()

    const resolved = await resolveImageEditSource(store, { kind: 'file', fileName: '0123456789abcdef.png' })

    expect(resolved).toMatchObject({ ok: false, reasonCode: 'source_image_missing' })
  })

  it('stores an uploaded image and resolves it as a new session image', async () => {
    const store = storage()

    const resolved = await resolveImageEditSource(store, {
      kind: 'inline',
      mime: 'image/png',
      bytes: new Uint8Array(pngBytes)
    })

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.stored.fileName).toMatch(/^[a-f0-9]{16}\.png$/)
    const reread = await store.read(resolved.stored.fileName)
    expect(Buffer.from(reread!.bytes).equals(pngBytes)).toBe(true)
  })

  it('rejects an unsupported upload mime type', async () => {
    const store = storage()

    const resolved = await resolveImageEditSource(store, {
      kind: 'inline',
      mime: 'image/gif',
      bytes: new Uint8Array(pngBytes)
    })

    expect(resolved).toMatchObject({ ok: false, reasonCode: 'source_image_type_unsupported' })
  })
})
