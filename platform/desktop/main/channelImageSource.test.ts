import { describe, expect, it, vi } from 'vitest'

import { createChannelImageSource } from './channelImageSource'

/**
 * 读盘入口的两条边界：来源必须是「这条助手消息自己带着这张图」；
 * 「没有」与「拿不到」在审计里必须是两种 detail。
 */
const PNG = (() => {
  const value = new Uint8Array(64)
  value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return value
})()

function harness(options: {
  message?: ReturnType<typeof assistantMessage> | null
  read?: () => Promise<{ bytes: Uint8Array; mime: string } | null> | never
} = {}) {
  const read = vi.fn(options.read ?? (async () => ({ bytes: PNG, mime: 'image/png' })))
  const source = createChannelImageSource({
    read,
    getMessage: () => (options.message === undefined ? assistantMessage() : options.message)
  })
  return { source, read }
}

function assistantMessage(overrides: { role?: string; status?: string; parts?: Array<Record<string, unknown>> } = {}) {
  return {
    role: overrides.role ?? 'assistant',
    status: overrides.status ?? 'success',
    data: { parts: overrides.parts ?? [{ type: 'image', kind: 'image', mime: 'image/png', fileName: 'abc123.png' }] }
  }
}

describe('channel image source', () => {
  it('reads the bytes when this assistant message carries the image', async () => {
    const { source } = harness()
    const resolved = await source.resolve({ kind: 'assistant-message', messageId: 'm1', fileName: 'abc123.png' })
    expect(resolved).toMatchObject({ ok: true, mime: 'image/png' })
    if (!resolved.ok) throw new Error('unreachable')
    expect(resolved.bytes.byteLength).toBe(PNG.byteLength)
  })

  it('refuses an edit source (a user message) instead of sending it out', async () => {
    const { source, read } = harness({ message: assistantMessage({ role: 'user' }) })
    await expect(source.resolve({ kind: 'assistant-message', messageId: 'm1', fileName: 'abc123.png' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-source-not-allowed', detail: 'role=user' })
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses a message that does not actually carry this file', async () => {
    const { source } = harness({ message: assistantMessage({ parts: [{ type: 'text', text: 'hi' }] }) })
    await expect(source.resolve({ kind: 'assistant-message', messageId: 'm1', fileName: 'abc123.png' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-source-not-allowed', detail: 'part-mismatch' })
  })

  it('separates "file is gone" from "file cannot be read"', async () => {
    const missing = harness({ read: async () => null })
    await expect(missing.source.resolve({ kind: 'assistant-message', messageId: 'm1', fileName: 'abc123.png' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail: 'missing' })

    const failing = harness({ read: async () => { throw new Error('EACCES') } })
    await expect(failing.source.resolve({ kind: 'assistant-message', messageId: 'm1', fileName: 'abc123.png' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail: 'read-failed' })
  })
})

describe('the second source: briefing poster (record-anchored)', () => {
  /** 海报那一支只认**记录里的内容 hash**：给不出路径、也给不出「当前版次」，所以伪造不了。 */
  function posterHarness(readBriefingPoster: (contentHash: string) => Promise<unknown>) {
    const source = createChannelImageSource({
      read: async () => null,
      getMessage: () => null,
      readBriefingPoster: readBriefingPoster as never
    })
    return { source }
  }

  it('reads the poster by the content hash the record carries', async () => {
    const seen: string[] = []
    const { source } = posterHarness(async (contentHash) => {
      seen.push(contentHash)
      return { ok: true, bytes: PNG, mime: 'image/png' }
    })
    const resolved = await source.resolve({ kind: 'briefing-poster', contentHash: 'abc123def456abcd' })
    expect(resolved).toMatchObject({ ok: true, mime: 'image/png' })
    // 取图走的就是记录里那个 hash，不查「当前版次」。
    expect(seen).toEqual(['abc123def456abcd'])
  })

  it('trusts the bytes over the declared mime (a mislabelled poster must not be sent as png)', async () => {
    const { source } = posterHarness(async () => ({ ok: true, bytes: PNG, mime: 'image/webp' }))
    await expect(source.resolve({ kind: 'briefing-poster', contentHash: 'abc123def456abcd' }))
      .resolves.toMatchObject({ ok: true, mime: 'image/png' })
  })

  it('says "this edition has no poster" differently from "the file cannot be read"', async () => {
    // 没有这一行（这一版从没出过图 / 已被保留期删掉）→ 来源不成立。
    const notFound = posterHarness(async () => ({ ok: false, code: 'poster-not-found', detail: 'no-row' }))
    await expect(notFound.source.resolve({ kind: 'briefing-poster', contentHash: 'abc123def456abcd' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-source-not-allowed', detail: 'poster-not-found' })

    // 行在、文件不在 / 读不出来 → 拿不到，两种 detail 都要能分辨。
    for (const detail of ['missing', 'read-failed'] as const) {
      const broken = posterHarness(async () => ({ ok: false, code: 'read-failed', detail }))
      await expect(broken.source.resolve({ kind: 'briefing-poster', contentHash: 'abc123def456abcd' }))
        .resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail })
    }
  })

  it('treats a throwing reader as "cannot read" (never as "not allowed")', async () => {
    const { source } = posterHarness(async () => { throw new Error('EIO') })
    await expect(source.resolve({ kind: 'briefing-poster', contentHash: 'abc123def456abcd' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail: 'read-failed' })
  })

  it('says unavailable when the poster reader is not wired at all', async () => {
    const source = createChannelImageSource({ read: async () => null, getMessage: () => null })
    await expect(source.resolve({ kind: 'briefing-poster', contentHash: 'abc123def456abcd' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail: 'poster-reader-unavailable' })
  })
})
