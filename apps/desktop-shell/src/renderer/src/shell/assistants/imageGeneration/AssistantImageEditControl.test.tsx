// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssistantImageMessagePart } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import { platformText } from '../../../i18n/platformText'
import { AssistantImageEditControl } from './AssistantImageEditControl'
import type { AssistantImageGenerationView, ImageEditDraft } from './imageGenerationModel'

/**
 * T3：composer 的「编辑图片」入口。
 * 未配置 imageEdit ⇒ 禁用 + tooltip；原图来源①会话图片（只传文件名）②上传（只传字节）；
 * 派发交给 hook，组件本身不碰 base64、不碰网络。
 */
vi.mock('antd', () => ({
  Button: ({ children, icon, onClick, ...props }: Record<string, unknown> & { onClick?: () => void }) =>
    createElement(
      'button',
      { ...props, onClick } as never,
      icon as never,
      children as never
    ),
  Input: {
    TextArea: ({ value = '', onChange, ...props }: { value?: string; onChange?: (event: { target: { value: string } }) => void }) =>
      createElement('textarea', { ...props, value, onChange })
  },
  Select: ({ value, options, onChange }: { value?: string; options?: Array<{ value: string; label: string }>; onChange?: (value: string) => void }) =>
    createElement(
      'select',
      { value, onChange: (event: { target: { value: string } }) => onChange?.(event.target.value) },
      (options ?? []).map((option) => createElement('option', { key: option.value, value: option.value }, option.label))
    )
}))

const labels = platformText['en-US'].assistants
const target = { providerId: 'acme', providerName: 'Acme', modelId: 'acme-image' }
const sessionImage: AssistantImageMessagePart = {
  type: 'image',
  kind: 'image',
  mime: 'image/png',
  fileName: '0123456789abcdef.png',
  byteLength: 128
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined

function view(overrides: Partial<AssistantImageGenerationView> = {}): AssistantImageGenerationView {
  return {
    target,
    editTarget: target,
    isGenerating: false,
    errorText: null,
    onGenerate: vi.fn(async () => true),
    onEdit: vi.fn(async () => true),
    ...overrides
  }
}

async function mount(
  next: AssistantImageGenerationView,
  availableImages: readonly AssistantImageMessagePart[] = [sessionImage]
): Promise<HTMLElement> {
  document.body.replaceChildren()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(AssistantImageEditControl, { labels, view: next, availableImages }))
  })
  return container
}

function button(container: HTMLElement): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>('[data-image-edit]')
  if (!element) throw new Error('Expected the edit entry.')
  return element
}

async function typePrompt(value: string): Promise<void> {
  const textarea = document.querySelector<HTMLTextAreaElement>('[data-image-edit-panel] textarea')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, value)
    textarea?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('AssistantImageEditControl', () => {
  it('disables the entry and explains why when no image edit endpoint is configured', async () => {
    const container = await mount(view({ editTarget: null }))

    expect(button(container).disabled).toBe(true)
    expect(button(container).getAttribute('title')).toBe(labels.imageEditTooltipDisabled)
    expect(button(container).getAttribute('aria-label')).toBe(labels.imageEdit)
  })

  it('edits a session image by reference and closes the panel', async () => {
    const onEdit = vi.fn(async (_draft: ImageEditDraft) => true)
    const container = await mount(view({ onEdit }))
    await act(async () => button(container).click())

    const source = document.querySelector<HTMLButtonElement>('[data-image-edit-source="0123456789abcdef.png"]')
    expect(source?.querySelector('img')?.getAttribute('src')).toBe(
      'app-image://generated-images/0123456789abcdef.png'
    )
    await act(async () => source?.click())
    expect(source?.getAttribute('aria-pressed')).toBe('true')

    await typePrompt('make it blue')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-image-edit-submit]')?.click()
      await Promise.resolve()
    })

    expect(onEdit).toHaveBeenCalledWith({
      prompt: 'make it blue',
      size: '1024x1024',
      source: { fileName: '0123456789abcdef.png' }
    })
    expect(document.querySelector('[data-image-edit-panel]')).toBeNull()
  })

  it('uploads a local png as bytes and shows a human error for a rejected file', async () => {
    const onEdit = vi.fn(async (_draft: ImageEditDraft) => true)
    const container = await mount(view({ onEdit }), [])
    await act(async () => button(container).click())
    const input = document.querySelector<HTMLInputElement>('[data-image-edit-upload]')
    if (!input) throw new Error('Expected the upload input')

    const tooBig = new File([new Uint8Array([1, 2, 3])], 'big.png', { type: 'image/png' })
    Object.defineProperty(tooBig, 'size', { value: 5 * 1024 * 1024 })
    Object.defineProperty(input, 'files', { configurable: true, value: [tooBig] })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    expect(document.querySelector('[data-image-edit-error]')?.textContent).toBe(
      labels.imageFailureSourceTooLarge
    )

    const png = new File([new Uint8Array([1, 2, 3])], 'small.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { configurable: true, value: [png] })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    await typePrompt('make it blue')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-image-edit-submit]')?.click()
      await Promise.resolve()
    })

    const draft = onEdit.mock.calls[0]?.[0]
    expect(draft?.source).toMatchObject({ mime: 'image/png' })
    if (!draft || !('bytes' in draft.source)) throw new Error('expected inline bytes')
    expect([...draft.source.bytes]).toEqual([1, 2, 3])
  })

  it('refuses to submit without a source image', async () => {
    const onEdit = vi.fn(async () => true)
    const container = await mount(view({ onEdit }), [])
    await act(async () => button(container).click())

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-image-edit-submit]')?.click()
      await Promise.resolve()
    })

    expect(onEdit).not.toHaveBeenCalled()
    expect(document.querySelector('[data-image-edit-error]')?.textContent).toBe(labels.imageEditSourceRequired)
  })

  it('shows the error coming from the hook when dispatch is rejected', async () => {
    const container = await mount(view({ onEdit: vi.fn(async () => false), errorText: labels.imageFailureSourceMissing }))
    await act(async () => button(container).click())
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-image-edit-source="0123456789abcdef.png"]')?.click()
    )
    await typePrompt('make it blue')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-image-edit-submit]')?.click()
      await Promise.resolve()
    })

    expect(document.querySelector('[data-image-edit-panel]')).not.toBeNull()
    expect(document.querySelector('[data-image-edit-error]')?.textContent).toBe(labels.imageFailureSourceMissing)
  })
})
