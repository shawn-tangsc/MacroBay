// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { platformText } from '../../../i18n/platformText'
import { AssistantImagePendingRow } from './AssistantImagePendingRow'

/**
 * T2：生成/编辑进行中的本地占位只是一行状态，不渲染任何图片、不持有图片数据；
 * settle 后由消息列表里的同一条消息接管。
 */
const labels = platformText['en-US'].assistants
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined

async function mount(entry: Parameters<typeof AssistantImagePendingRow>[0]['entry']): Promise<HTMLElement> {
  document.body.replaceChildren()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(AssistantImagePendingRow, { labels, entry }))
  })
  return container
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('AssistantImagePendingRow', () => {
  it('renders nothing without a pending entry', async () => {
    const container = await mount(null)
    expect(container.textContent).toBe('')
  })

  it('shows the generation status and no image while generating', async () => {
    const container = await mount({ id: 'g-1', createdAt: 1, kind: 'generate', prompt: 'a red fox' })

    const row = container.querySelector('[data-generated-image-status="pending"]')
    expect(row?.textContent).toContain(labels.imageGenerating)
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('data:')
  })

  it('uses the edit wording while an edit is running', async () => {
    const container = await mount({ id: 'e-1', createdAt: 1, kind: 'edit', prompt: 'make it blue' })

    expect(container.textContent).toContain(labels.imageEditGenerating)
    expect(container.textContent).not.toContain(labels.imageGenerating)
  })
})
