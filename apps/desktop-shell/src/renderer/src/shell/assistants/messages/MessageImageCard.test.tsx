// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssistantImageMessagePart } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import { platformText } from '../../../i18n/platformText'
import { MessageImageCard } from './MessageImageCard'

/**
 * T1：图片卡片只认引用。
 * `<img src>` 必须是 `app-image://generated-images/<hash>.<ext>`，消息体里没有 `data:`；
 * 下载链接给出 generated-<ts>.<ext>，指回同一个协议地址。
 */
vi.mock('antd', () => ({
  Image: ({ src, alt }: { src?: string; alt?: string }) => createElement('img', { src, alt }),
  __esModule: true
}))

const labels = platformText['en-US'].assistants
const images: AssistantImageMessagePart[] = [
  {
    type: 'image',
    kind: 'image',
    mime: 'image/png',
    fileName: '0123456789abcdef.png',
    byteLength: 128,
    width: 512,
    height: 512
  },
  {
    type: 'image',
    kind: 'image',
    mime: 'image/webp',
    fileName: 'fedcba9876543210.webp',
    byteLength: 256
  }
]

let root: Root | undefined

async function mount(next: readonly AssistantImageMessagePart[]): Promise<HTMLElement> {
  document.body.replaceChildren()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(MessageImageCard, { labels, images: next, createdAt: 1_700_000_000_000 }))
  })
  return container
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

/**
 * 「发到频道」：按钮是否出现由主进程投影决定；失败按四类各说一句；
 * 「只发图片」只在 caption 超长终态失败后出现，并且走第三个键（由主进程负责，这里只传 withoutCaption）。
 */
describe('send an image to the channel', () => {
  function installChannels(
    target: { channels: readonly { channelId: string; channelName: string; supportsImage: boolean }[] } | null,
    sendResult: Record<string, unknown>
  ) {
    const sendMessageImage = vi.fn(async (_input: { messageId: string; fileName: string; withoutCaption?: boolean }) => sendResult)
    ;(globalThis as { window?: unknown }).window = Object.assign(globalThis.window ?? {}, {
      platform: { channels: { imageTarget: vi.fn(async () => target), sendMessageImage } }
    })
    return { sendMessageImage }
  }

  async function mountCard(props: { messageId?: string; caption?: string } = {}): Promise<HTMLElement> {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(MessageImageCard, { labels, images, createdAt: 0, ...props })))
    await act(async () => {})
    return host
  }

  it('does not draw the action when no channel is available', async () => {
    installChannels(null, { ok: false, state: 'failed', code: 'delivery-host-unavailable', channels: [] })
    const host = await mountCard({ messageId: 'm1', caption: 'hi' })
    expect(host.querySelector('[data-image-send-action]')).toBeNull()
  })

  it('sends with the message id and file name, then shows the channel it went to', async () => {
    const { sendMessageImage } = installChannels({ channels: [{ channelId: 'c1', channelName: 'Telegram', supportsImage: true }] }, { ok: true, state: 'sent-accepted', code: null, channels: [{ channelId: 'c1', channelName: 'Telegram', state: 'sent-accepted' }] })
    const host = await mountCard({ messageId: 'm1', caption: 'hi' })
    const button = host.querySelector('[data-image-send-action]') as HTMLButtonElement
    expect(button).not.toBeNull()
    await act(async () => button.click())
    await act(async () => {})
    expect(sendMessageImage).toHaveBeenCalledWith({ messageId: 'm1', fileName: '0123456789abcdef.png' })
    expect(host.querySelector('[data-image-send-result="sent"]')?.textContent).toContain('Telegram')
  })

  it('offers "send image only" after a caption-too-long failure, and never truncates silently', async () => {
    const { sendMessageImage } = installChannels(
      { channels: [{ channelId: 'c1', channelName: 'Telegram', supportsImage: true }] },
      { ok: false, state: 'failed', code: 'delivery-caption-too-long', channels: [{ channelId: 'c1', channelName: 'Telegram', state: 'failed', code: 'delivery-caption-too-long' }] }
    )
    const host = await mountCard({ messageId: 'm1', caption: 'x'.repeat(1500) })
    await act(async () => (host.querySelector('[data-image-send-action]') as HTMLButtonElement).click())
    await act(async () => {})
    const failed = host.querySelector('[data-image-send-result="failed"]')
    expect(failed?.textContent).toContain(labels.imageSendCaptionTooLong)
    const bare = host.querySelector('[data-image-send-bare]') as HTMLButtonElement
    expect(bare).not.toBeNull()
    await act(async () => bare.click())
    await act(async () => {})
    expect(sendMessageImage).toHaveBeenLastCalledWith({ messageId: 'm1', fileName: '0123456789abcdef.png', withoutCaption: true })
  })

  it('says "image only" in the success line, and drops the bare action after it is used', async () => {
    const sendMessageImage = vi.fn()
      .mockResolvedValueOnce({ ok: false, state: 'failed', code: 'delivery-caption-too-long', channels: [{ channelId: 'c1', channelName: 'Telegram', state: 'failed', code: 'delivery-caption-too-long' }] })
      .mockResolvedValueOnce({ ok: true, state: 'sent-accepted', code: null, channels: [{ channelId: 'c1', channelName: 'Telegram', state: 'sent-accepted' }] })
    ;(globalThis as { window?: unknown }).window = Object.assign(globalThis.window ?? {}, {
      platform: { channels: { imageTarget: vi.fn(async () => ({ channels: [{ channelId: 'c1', channelName: 'Telegram', supportsImage: true }] })), sendMessageImage } }
    })
    const host = await mountCard({ messageId: 'm1', caption: 'x'.repeat(1500) })
    await act(async () => (host.querySelector('[data-image-send-action]') as HTMLButtonElement).click())
    await act(async () => {})
    await act(async () => (host.querySelector('[data-image-send-bare]') as HTMLButtonElement).click())
    await act(async () => {})
    expect(host.querySelector('[data-image-send-result="sent"]')?.textContent)
      .toContain(labels.imageSentBare.replace('{channel}', 'Telegram'))
    expect(host.querySelector('[data-image-send-bare]')).toBeNull()
  })

  it('#4c: after a remount (the equivalent of a restart) the image-only action is gone and nothing is stored', async () => {
    // 口径 B：跨重启不提供「只发图片」。动作依赖的是**这次会话里的失败状态**，重建调用点后状态归零；
    // 主进程侧也不留 payload（见 ChannelDeliveryService 的「stores no fileName」用例），所以没有可点的地方。
    const { sendMessageImage } = installChannels(
      { channels: [{ channelId: 'c1', channelName: 'Telegram', supportsImage: true }] },
      { ok: false, state: 'failed', code: 'delivery-caption-too-long', channels: [{ channelId: 'c1', channelName: 'Telegram', state: 'failed', code: 'delivery-caption-too-long' }] }
    )
    const host = await mountCard({ messageId: 'm1', caption: 'x'.repeat(1500) })
    await act(async () => (host.querySelector('[data-image-send-action]') as HTMLButtonElement).click())
    await act(async () => {})
    expect(host.querySelector('[data-image-send-bare]')).not.toBeNull()

    // 重建：卸载旧卡片、重新挂载（与「重启后重新打开这条消息」同一形状）。
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    const remounted = await mountCard({ messageId: 'm1', caption: 'x'.repeat(1500) })
    expect(remounted.querySelector('[data-image-send-bare]')).toBeNull()
    expect(remounted.querySelector('[data-image-send-result]')).toBeNull()
    // 也没有偷偷替读者发一次。
    expect(sendMessageImage).toHaveBeenCalledOnce()
  })

  it('does not draw any action without a message id or without image capability', async () => {
    installChannels({ channels: [{ channelId: 'c1', channelName: 'Telegram', supportsImage: true }] }, { ok: true, state: 'sent-accepted', code: null, channels: [{ channelId: 'c1', channelName: 'Telegram', state: 'sent-accepted' }] })
    expect((await mountCard({ caption: 'hi' })).querySelector('[data-image-send-action]')).toBeNull()

    installChannels({ channels: [{ channelId: 'c1', channelName: 'Telegram', supportsImage: false }] }, { ok: true, state: 'sent-accepted', code: null, channels: [{ channelId: 'c1', channelName: 'Telegram', state: 'sent-accepted' }] })
    expect((await mountCard({ messageId: 'm1', caption: 'hi' })).querySelector('[data-image-send-action]')).toBeNull()
  })
})

describe('MessageImageCard', () => {
  it('points img src at the app-image protocol instead of a data: payload', async () => {
    const container = await mount(images)

    const rendered = [...container.querySelectorAll('img')].map((node) => node.getAttribute('src'))
    expect(rendered).toEqual([
      'app-image://generated-images/0123456789abcdef.png',
      'app-image://generated-images/fedcba9876543210.webp'
    ])
    for (const src of rendered) expect(src?.startsWith('data:')).toBe(false)
    expect(container.innerHTML).not.toContain('data:')
    expect(container.querySelectorAll('[data-generated-image-card]')).toHaveLength(1)
  })

  it('offers a download target that keeps the referenced extension', async () => {
    const container = await mount(images)

    const downloads = [...container.querySelectorAll<HTMLAnchorElement>('[data-image-download]')]
    expect(downloads.map((node) => node.getAttribute('download'))).toEqual([
      'generated-1700000000000.png',
      'generated-1700000000000-2.webp'
    ])
    expect(downloads[0]?.getAttribute('href')).toBe('app-image://generated-images/0123456789abcdef.png')
    expect(downloads[0]?.textContent).toContain(labels.imageDownload)
  })

  it('drops references whose file name is not a generated hash', async () => {
    const container = await mount([
      { type: 'image', kind: 'image', mime: 'image/png', fileName: '../../etc/passwd.png', byteLength: 1 }
    ])

    expect(container.querySelectorAll('img')).toHaveLength(0)
  })
})
