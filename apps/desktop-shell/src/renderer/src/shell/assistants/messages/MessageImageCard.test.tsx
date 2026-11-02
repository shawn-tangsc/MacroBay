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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
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
