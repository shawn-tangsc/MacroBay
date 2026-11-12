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
    const resolved = await source.resolve({ messageId: 'm1', fileName: 'abc123.png' })
    expect(resolved).toMatchObject({ ok: true, mime: 'image/png' })
    if (!resolved.ok) throw new Error('unreachable')
    expect(resolved.bytes.byteLength).toBe(PNG.byteLength)
  })

  it('refuses an edit source (a user message) instead of sending it out', async () => {
    const { source, read } = harness({ message: assistantMessage({ role: 'user' }) })
    await expect(source.resolve({ messageId: 'm1', fileName: 'abc123.png' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-source-not-allowed', detail: 'role=user' })
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses a message that does not actually carry this file', async () => {
    const { source } = harness({ message: assistantMessage({ parts: [{ type: 'text', text: 'hi' }] }) })
    await expect(source.resolve({ messageId: 'm1', fileName: 'abc123.png' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-source-not-allowed', detail: 'part-mismatch' })
  })

  it('separates "file is gone" from "file cannot be read"', async () => {
    const missing = harness({ read: async () => null })
    await expect(missing.source.resolve({ messageId: 'm1', fileName: 'abc123.png' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail: 'missing' })

    const failing = harness({ read: async () => { throw new Error('EACCES') } })
    await expect(failing.source.resolve({ messageId: 'm1', fileName: 'abc123.png' }))
      .resolves.toEqual({ ok: false, code: 'delivery-image-unavailable', detail: 'read-failed' })
  })
})
