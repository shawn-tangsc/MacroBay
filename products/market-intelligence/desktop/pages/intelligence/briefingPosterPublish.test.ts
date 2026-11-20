// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { MAX_CHANNEL_IMAGE_CAPTION_CHARS } from '@platform/ai/agent-platform/channels/channelImageDelivery'
import { MAX_CHANNEL_POSTER_BYTES } from '@platform/storage/channelPosterOutbox'

import {
  BRIEFING_PUBLISH_CAPTION_MAX_CHARS,
  BRIEFING_PUBLISH_POSTER_MAX_BYTES,
  prepareBriefingPublish,
  renderBriefingPosterPng
} from './briefingPosterPublish'

vi.mock('html-to-image', () => ({ toPng: vi.fn(async () => `data:image/png;base64,${btoa('poster-bytes')}`) }))
const { toPng } = await import('html-to-image')
/** vitest 把上面的模块换成了 mock；类型仍是原函数，所以这里显式收窄成「可断言调用的那个」。 */
const toPngMock = toPng as unknown as { mockClear: () => void; mock: { calls: unknown[][] }; toHaveBeenCalledTimes: (n: number) => void }

const bytes = (length: number): Uint8Array => new Uint8Array(length).fill(1)

describe('preparing a poster before publishing', () => {
  it('refuses a caption over the limit before rendering anything, and never truncates it', async () => {
    const render = vi.fn(async () => undefined)
    const prepared = await prepareBriefingPublish({
      caption: 'a'.repeat(BRIEFING_PUBLISH_CAPTION_MAX_CHARS + 1),
      posterRoot: document.createElement('div'),
      render
    })
    expect(prepared).toEqual({ kind: 'caption-too-long', chars: BRIEFING_PUBLISH_CAPTION_MAX_CHARS + 1 })
    // 便宜的先判：超长时不渲染，省一次出图。
    expect(render).not.toHaveBeenCalled()
    // 也不截断：整段导读原样不进去，调用方拿到的是「不发」。
    expect(JSON.stringify(prepared)).not.toContain('a'.repeat(BRIEFING_PUBLISH_CAPTION_MAX_CHARS + 1))
  })

  it('counts the caption by code point, the same way the main process does', async () => {
    const emoji = '🙂'.repeat(BRIEFING_PUBLISH_CAPTION_MAX_CHARS + 1)
    const prepared = await prepareBriefingPublish({ caption: emoji, posterRoot: null })
    expect(prepared).toEqual({ kind: 'caption-too-long', chars: BRIEFING_PUBLISH_CAPTION_MAX_CHARS + 1 })
  })

  it('sends text only when the screen has no poster to read', async () => {
    const render = vi.fn(async () => undefined)
    expect(await prepareBriefingPublish({ caption: 'short', posterRoot: null, render })).toEqual({ kind: 'ready' })
    expect(render).not.toHaveBeenCalled()
  })

  it('refuses the whole publish when the poster cannot be rendered', async () => {
    const root = document.createElement('div')
    expect(await prepareBriefingPublish({ caption: 'short', posterRoot: root, render: async () => undefined }))
      .toEqual({ kind: 'poster-render-failed' })
    expect(await prepareBriefingPublish({ caption: 'short', posterRoot: root, render: async () => { throw new Error('boom') } }))
      .toEqual({ kind: 'poster-render-failed' })
    // 空字节也算没渲染出来：不能拿一个空数组冒充「有海报」。
    expect(await prepareBriefingPublish({ caption: 'short', posterRoot: root, render: async () => ({ bytes: new Uint8Array(0), mime: 'image/png' }) }))
      .toEqual({ kind: 'poster-render-failed' })
  })

  it('refuses a poster over the byte cap and says how big it was', async () => {
    const root = document.createElement('div')
    const prepared = await prepareBriefingPublish({
      caption: 'short',
      posterRoot: root,
      render: async () => ({ bytes: bytes(BRIEFING_PUBLISH_POSTER_MAX_BYTES + 1), mime: 'image/png' })
    })
    expect(prepared).toEqual({ kind: 'poster-too-large', byteLength: BRIEFING_PUBLISH_POSTER_MAX_BYTES + 1 })
  })

  it('hands the bytes over when everything fits', async () => {
    const root = document.createElement('div')
    const prepared = await prepareBriefingPublish({
      caption: 'short',
      posterRoot: root,
      render: async () => ({ bytes: bytes(64), mime: 'image/png' })
    })
    expect(prepared.kind).toBe('ready-with-poster')
    if (prepared.kind === 'ready-with-poster') expect(prepared.poster.bytes.byteLength).toBe(64)
  })

  it('keeps the two limits equal to the ones the channel layer enforces', () => {
    // 这两条是「同一个数两处写」的守卫：改了一边忘了另一边，主进程会收下或拒掉另一批图。
    expect(BRIEFING_PUBLISH_POSTER_MAX_BYTES).toBe(MAX_CHANNEL_POSTER_BYTES)
    expect(BRIEFING_PUBLISH_CAPTION_MAX_CHARS).toBe(MAX_CHANNEL_IMAGE_CAPTION_CHARS)
  })
})

describe('rendering the publish poster', () => {
  it('renders at the paper width and 1x, not the 2x download parameters', async () => {
    toPngMock.mockClear()
    const root = document.createElement('div')
    const poster = document.createElement('article')
    poster.className = 'mi-brief-poster'
    root.append(poster)

    const rendered = await renderBriefingPosterPng(root)

    expect(toPngMock.mock.calls.length).toBe(1)
    const options = toPngMock.mock.calls[0]![1] as Record<string, unknown>
    expect(options.width).toBe(1080)
    // 下载版是 2x；发布版必须 1x——两个用途不共用参数。
    expect(options.pixelRatio).toBe(1)
    expect(rendered?.mime).toBe('image/png')
    expect(new TextDecoder().decode(rendered!.bytes)).toBe('poster-bytes')
  })

  it('refuses a poster measured at some other width instead of sending a wrong-sized image', async () => {
    toPngMock.mockClear()
    const root = document.createElement('div')
    const poster = document.createElement('article')
    poster.className = 'mi-brief-poster'
    poster.getBoundingClientRect = () => ({ width: 720 } as DOMRect)
    root.append(poster)

    expect(await renderBriefingPosterPng(root)).toBeUndefined()
    expect(toPngMock.mock.calls.length).toBe(0)
  })
})
