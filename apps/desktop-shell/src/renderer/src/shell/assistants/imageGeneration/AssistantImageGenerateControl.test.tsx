// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../../i18n/platformText'
import { AssistantImageGenerateControl } from './AssistantImageGenerateControl'
import type { AssistantImageGenerationView } from './imageGenerationModel'

/**
 * PLAT-63 第二阶段 B：composer 里的「生成图片」入口 + 小面板。
 * 未配置端点 ⇒ 按钮禁用且 tooltip 说明；面板给出 prompt / 尺寸 / 数量 / 生成。
 */
const labels = platformText['en-US'].assistants
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined

const target = { providerId: 'acme', providerName: 'Acme', modelId: 'acme-image' }

function view(overrides: Partial<AssistantImageGenerationView> = {}): AssistantImageGenerationView {
  return {
    target,
    editTarget: null,
    isGenerating: false,
    errorText: null,
    onGenerate: vi.fn(async () => true),
    onEdit: vi.fn(async () => true),
    ...overrides
  }
}

async function mount(next: AssistantImageGenerationView): Promise<HTMLElement> {
  document.body.replaceChildren()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(AssistantImageGenerateControl, { labels, view: next }))
  })
  return container
}

function button(container: HTMLElement): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>('[data-image-generate]')
  if (!element) throw new Error('Expected the image generation button.')
  return element
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('AssistantImageGenerateControl', () => {
  it('disables the entry and explains why when no image endpoint is configured', async () => {
    const container = await mount(view({ target: null }))

    expect(button(container).disabled).toBe(true)
    expect(button(container).getAttribute('title')).toBe(labels.imageGenerateTooltipDisabled)
    expect(button(container).getAttribute('aria-label')).toBe(labels.imageGenerate)
  })

  it('opens a panel with prompt, size, count and a generate action', async () => {
    const container = await mount(view())

    expect(button(container).disabled).toBe(false)
    await act(async () => button(container).click())

    const panel = document.querySelector<HTMLElement>('[data-image-panel]')
    expect(panel).not.toBeNull()
    expect(panel?.querySelector('textarea')).not.toBeNull()
    expect(panel?.querySelector('[data-image-size]')).not.toBeNull()
    expect(panel?.querySelector('[data-image-count]')).not.toBeNull()
    expect(panel?.querySelector('[data-image-submit]')?.textContent).toContain(labels.imageGenerateAction)
  })

  it('submits the typed prompt with the default size and count, then closes', async () => {
    const onGenerate = vi.fn(async () => true)
    const container = await mount(view({ onGenerate }))
    await act(async () => button(container).click())

    const textarea = document.querySelector<HTMLTextAreaElement>('[data-image-panel] textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, 'a red fox')
      textarea?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-image-submit]')?.click()
      await Promise.resolve()
    })

    expect(onGenerate).toHaveBeenCalledWith({ prompt: 'a red fox', size: '1024x1024', count: 1 })
    expect(document.querySelector('[data-image-panel]')).toBeNull()
  })

  it('keeps the panel open and shows the error when the request is rejected locally', async () => {
    const onGenerate = vi.fn(async () => false)
    const container = await mount(view({ onGenerate, errorText: labels.imagePromptRequired }))
    await act(async () => button(container).click())

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-image-submit]')?.click()
      await Promise.resolve()
    })

    expect(document.querySelector('[data-image-panel]')).not.toBeNull()
    expect(document.querySelector('[data-image-generation-error]')?.textContent).toBe(labels.imagePromptRequired)
  })

  it('shows a loading entry while an image is being generated', async () => {
    const container = await mount(view({ isGenerating: true }))

    expect(button(container).className).toContain('ant-btn-loading')
  })
})
