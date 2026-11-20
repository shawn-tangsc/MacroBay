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

describe('the second source: briefing poster', () => {
  /** 海报那一支只认暂存记录 + 版本：给不出路径，也就伪造不了。 */
  function posterHarness(readPoster: (edition: { date: string; periodId: string; locale: string }) => Promise<unknown>) {
    const source = createChannelImageSource({
      read: async () => null,
      getMessage: () => null,
      readPoster: readPoster as never
    })
    return { source }
  }

  it('reads the stored poster for exactly this edition', async () => {
    const edition = { date: '2026-11-12', periodId: 'default', locale: 'zh-CN' }
    const { source } = posterHarness(async () => ({ ok: true, bytes: PNG, mime: 'image/png', record: {} }))
    await expect(source.resolve({ kind: 'briefing-poster', edition })).resolves.toMatchObject({ ok: true, mime: 'image/png' })
  })

  it('does not borrow the assistant path: no message lookup, and no path input exists', async () => {
    // 版本对不上（上一个版本/残留）→ 来源被拒，detail 说清是版本问题。
    const { source } = posterHarness(async () => ({ ok: false, code: 'delivery-image-source-not-allowed', detail: 'edition-mismatch' }))
    await expect(source.resolve({ kind: 'briefing-poster', edition: { date: '2026-11-11', periodId: 'default', locale: 'zh-CN' } }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-source-not-allowed', detail: 'edition-mismatch' })
  })

  it('keeps "gone" and "cannot read" apart on the poster branch too', async () => {
    for (const detail of ['missing', 'expired', 'read-failed']) {
      const { source } = posterHarness(async () => ({ ok: false, code: 'delivery-image-unavailable', detail }))
      await expect(source.resolve({ kind: 'briefing-poster', edition: { date: '2026-11-12', periodId: 'default', locale: 'zh-CN' } }))
        .resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail })
    }
  })

  it('says unavailable (not allowed) when the outbox is not wired', async () => {
    const source = createChannelImageSource({ read: async () => null, getMessage: () => null })
    await expect(source.resolve({ kind: 'briefing-poster', edition: { date: '2026-11-12', periodId: 'default', locale: 'zh-CN' } }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail: 'poster-outbox-unavailable' })
  })
})
