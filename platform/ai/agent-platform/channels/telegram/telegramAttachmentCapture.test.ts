import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createContentAddressedBlobStore } from '../../../../storage/contentAddressedBlobs'
import { captureTelegramAttachment } from './telegramAttachmentCapture'

/**
 * Telegram 入站附件的落盘（0.4.5）。三条判据：
 * - 白名单外 / 超 2MB **在下载前**就拒，`downloadFile` 一次都不调（别先拉下来再丢）；
 * - 下载失败是 `unreadable`（可重试），**不是** `unavailable`（那句会把网络问题说成读者的错）；
 * - 成功时只回 `fileRef`，字节进内容寻址 store。
 *
 * 其余平台（Discord / Lark / QQ）v1 不真拉取：它们的引用里只有文件 id，要下载还得另存 message id
 * 或原始 URL（那些 URL 是故意丢掉的），所以只登记引用——这条边界写在模块头，不在测试里假装。
 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7])
const dirs: string[] = []

async function storeInTemp() {
  const directory = await mkdtemp(join(tmpdir(), 'telegram-attachments-'))
  dirs.push(directory)
  return createContentAddressedBlobStore({ directory })
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const attachment = (overrides: Partial<{ mimeType: string; sizeBytes: number; stableRef: string }> = {}) => ({
  kind: 'image' as const,
  stableRef: 'telegram:file:file-abc',
  mimeType: 'image/png',
  sizeBytes: PNG.byteLength,
  ...overrides
})

describe('Telegram inbound attachment capture', () => {
  it('downloads once and stores the bytes, returning only the fileRef', async () => {
    const store = await storeInTemp()
    const downloadFile = vi.fn(async () => ({ ok: true as const, value: PNG }))
    const state = await captureTelegramAttachment({ attachment: attachment(), api: { downloadFile } as never, store })

    expect(state).toMatchObject({ state: 'stored' })
    expect(state.state === 'stored' && state.fileRef).toMatch(/^[a-f0-9]{64}\.png$/)
    expect(downloadFile).toHaveBeenCalledWith('file-abc', undefined)
    if (state.state === 'stored') await expect(store.read(state.fileRef)).resolves.toMatchObject({ state: 'ok' })
  })

  it('refuses an unsupported type or an oversized file before any download', async () => {
    const store = await storeInTemp()
    const downloadFile = vi.fn(async () => ({ ok: true as const, value: PNG }))

    await expect(captureTelegramAttachment({
      attachment: attachment({ mimeType: 'image/gif' }), api: { downloadFile } as never, store
    })).resolves.toEqual({ state: 'unavailable', reasonCode: 'attachment-unsupported-type' })

    await expect(captureTelegramAttachment({
      attachment: attachment({ sizeBytes: 2 * 1024 * 1024 + 1 }), api: { downloadFile } as never, store
    })).resolves.toEqual({ state: 'unavailable', reasonCode: 'attachment-too-large' })

    // 两次都拒在下载之前：一个请求都没发出去。
    expect(downloadFile).not.toHaveBeenCalled()
    await expect(store.listEntries()).resolves.toEqual([])
  })

  it('reports a failed download as unreadable and retryable, never as "there is nothing"', async () => {
    const store = await storeInTemp()
    const downloadFile = vi.fn(async () => ({ ok: false as const, code: 'telegram-network-unavailable' }))
    await expect(captureTelegramAttachment({ attachment: attachment(), api: { downloadFile } as never, store }))
      .resolves.toEqual({ state: 'unreadable', reasonCode: 'attachment-download-failed' })
  })

  it('refuses a reference that is not a Telegram file id, without asking the network', async () => {
    const store = await storeInTemp()
    const downloadFile = vi.fn(async () => ({ ok: true as const, value: PNG }))
    await expect(captureTelegramAttachment({
      attachment: attachment({ stableRef: 'discord:file:whatever' }), api: { downloadFile } as never, store
    })).resolves.toEqual({ state: 'unavailable', reasonCode: 'attachment-ref-invalid' })
    expect(downloadFile).not.toHaveBeenCalled()
  })
})