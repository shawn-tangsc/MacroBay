// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { maskSecret as modelMaskSecret } from '@platform/ai/providers/providerStore'
import { maskSecret as webSearchMaskSecret } from '@platform/ai/web-search/runtime/WebSearchCredentialStore'

import { platformText } from '../../../i18n/platformText'
import { API_KEY_REVEAL_TIMEOUT_MS, WebSearchApiKeyField } from './WebSearchApiKeyField'

const labels = platformText['zh-CN'].webSearch
const savedKey = 'tvly-1234567890-HcHz'
const preview = 'tvly**********HcHz'

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  delete (window as unknown as BridgeWindow).platform
  vi.useRealTimers()
})

type MountOptions = {
  hasApiKey?: boolean
  apiKeyPreview?: string
  onReveal?: () => Promise<string | null>
  onRemove?: () => Promise<void>
  bridge?: boolean
}

type BridgeWindow = { platform?: { webSearch?: { revealApiKey?: () => Promise<unknown> } } }

function installBridge(present: boolean): void {
  const target = window as unknown as BridgeWindow
  if (!present) {
    delete target.platform
    return
  }
  target.platform = { webSearch: { revealApiKey: async () => ({ apiKey: null }) } }
}

async function mount(options: MountOptions = {}): Promise<HTMLElement> {
  installBridge(options.bridge ?? true)
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(WebSearchApiKeyField, {
        labels,
        hasApiKey: options.hasApiKey ?? true,
        apiKeyPreview: options.apiKeyPreview ?? preview,
        value: '',
        disabled: false,
        onChange: vi.fn(),
        onReveal: options.onReveal ?? vi.fn(async () => savedKey),
        onRemove: options.onRemove ?? vi.fn(async () => undefined),
        apiKeyLength: savedKey.length
      })
    )
  })
  return container
}

function inputOf(container: HTMLElement): HTMLInputElement {
  return container.querySelector('.web-search-api-key-control input') as HTMLInputElement
}

async function click(container: HTMLElement, selector: string): Promise<void> {
  const element = container.querySelector(selector) as HTMLElement | null
  if (!element) throw new Error(`not found: ${selector}`)
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

async function clickText(container: HTMLElement, text: string): Promise<void> {
  const element = [...container.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes(text))
  if (!element) throw new Error(`button not found: ${text}`)
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

async function setInput(container: HTMLElement, value: string): Promise<void> {
  const input = inputOf(container)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('PLAT-55 masked API key field', () => {
  it('uses the same maskSecret rule as model providers', () => {
    expect(webSearchMaskSecret(savedKey)).toBe(preview)
    expect(modelMaskSecret(savedKey)).toBe(webSearchMaskSecret(savedKey))
    expect(webSearchMaskSecret('short')).toBe('*****')
  })

  it('keeps the mask value byte-identical across hover, focus and blur', async () => {
    const container = await mount()
    const input = inputOf(container)
    expect(input.value).toBe(preview)

    for (const type of ['mouseover', 'mouseenter', 'focus', 'blur']) {
      await act(async () => input.dispatchEvent(new Event(type, { bubbles: true })))
      expect(input.value).toBe(preview)
      expect(input.style.display).not.toBe('none')
    }
  })

  it('reveals the full key on explicit eye click and hides it again', async () => {
    const onReveal = vi.fn(async () => savedKey)
    const container = await mount({ onReveal })

    await click(container, '.web-search-api-key-eye')
    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(inputOf(container).value).toBe(savedKey)
    expect(container.innerHTML).toContain(savedKey)

    await click(container, '.web-search-api-key-eye')
    expect(inputOf(container).value).toBe(preview)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('auto-hides the revealed key after 30 seconds', async () => {
    vi.useFakeTimers()
    const container = await mount()
    await click(container, '.web-search-api-key-eye')
    expect(inputOf(container).value).toBe(savedKey)

    await act(async () => {
      vi.advanceTimersByTime(API_KEY_REVEAL_TIMEOUT_MS)
    })

    expect(inputOf(container).value).toBe(preview)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('hides the revealed key on blur', async () => {
    const container = await mount()
    const input = inputOf(container)
    await click(container, '.web-search-api-key-eye')
    expect(input.value).toBe(savedKey)

    await act(async () => {
      input.focus()
      input.blur()
    })

    expect(input.value).toBe(preview)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('clears a revealed key when switching provider and on unmount', async () => {
    const container = await mount()
    await click(container, '.web-search-api-key-eye')
    expect(inputOf(container).value).toBe(savedKey)

    await act(async () => {
      root?.render(
        createElement(WebSearchApiKeyField, {
          labels,
          hasApiKey: true,
          apiKeyPreview: 'jina**********ABCD',
          value: '',
          disabled: false,
          onChange: vi.fn(),
          onReveal: vi.fn(async () => savedKey),
          onRemove: vi.fn(async () => undefined)
        })
      )
    })
    expect(inputOf(container).value).toBe('jina**********ABCD')
    expect(container.innerHTML).not.toContain(savedKey)

    await act(async () => root?.unmount())
    root = undefined
    expect(document.body.innerHTML).not.toContain(savedKey)
  })

  it('classifies a missing preload bridge without calling reveal', async () => {
    const onReveal = vi.fn(async () => savedKey)
    const container = await mount({ onReveal, bridge: false })

    await click(container, '.web-search-api-key-eye')

    expect(onReveal).not.toHaveBeenCalled()
    expect(inputOf(container).value).toBe(preview)
    expect(container.textContent).toContain(labels.revealApiKeyUnavailable)
    expect(container.textContent).toContain(labels.retry)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('classifies a rejected main-process call', async () => {
    const container = await mount({
      onReveal: async () => {
        throw new Error('vault-down')
      }
    })

    await click(container, '.web-search-api-key-eye')

    expect(inputOf(container).value).toBe(preview)
    expect(container.textContent).toContain(labels.revealApiKeyBridgeFailed)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('classifies a null result as a missing saved key', async () => {
    const container = await mount({ onReveal: async () => null })

    await click(container, '.web-search-api-key-eye')

    expect(inputOf(container).value).toBe(preview)
    expect(container.textContent).toContain(labels.revealApiKeyMissing)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('retries successfully once the bridge is available again', async () => {
    const onReveal = vi.fn(async () => savedKey)
    const container = await mount({ onReveal, bridge: false })
    await click(container, '.web-search-api-key-eye')
    expect(container.textContent).toContain(labels.revealApiKeyUnavailable)

    installBridge(true)
    await clickText(container, labels.retry)

    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(inputOf(container).value).toBe(savedKey)
    expect(container.innerHTML).toContain(savedKey)
  })

  it('enters edit mode by clicking the mask or the pencil, then the eye toggles the draft visibility', async () => {
    const container = await mount()
    const input = inputOf(container)
    await click(container, '.web-search-api-key-control input')
    expect(input.value).toBe('')
    expect(input.placeholder).toBe(labels.apiKeyPlaceholder)

    await setInput(container, 'new-key-123456')
    expect(input.type).toBe('password')
    expect(container.innerHTML).not.toContain(savedKey)

    await click(container, '.web-search-api-key-eye')
    expect(input.type).toBe('text')
    await click(container, '.web-search-api-key-eye')
    expect(input.type).toBe('password')

    // 失焦取消：回到掩码且不写入草稿。
    await act(async () => {
      input.focus()
      input.blur()
    })
    expect(input.value).toBe(preview)
    expect(container.innerHTML).not.toContain(savedKey)

    // 铅笔同样进入编辑态。
    await click(container, '.web-search-api-key-pencil')
    expect(input.value).toBe('')
  })

  it('cancels editing with Escape without submitting the draft', async () => {
    const container = await mount()
    const input = inputOf(container)
    await click(container, '.web-search-api-key-control input')
    await setInput(container, 'draft-key-123456')
    expect(container.innerHTML).not.toContain(savedKey)

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(input.value).toBe(preview)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('disables the eye with a tooltip when no key is saved and nothing is typed', async () => {
    const container = await mount({ hasApiKey: false })
    const eye = container.querySelector('.web-search-api-key-eye') as HTMLButtonElement

    expect(eye.disabled).toBe(true)
    expect(eye.getAttribute('title')).toBe(labels.noApiKeyHint)
  })

  it('removes a saved key only after an inline second confirmation', async () => {
    const onRemove = vi.fn(async () => undefined)
    const container = await mount({ onRemove })

    await clickText(container, labels.removeApiKey)
    expect(container.textContent).toContain(labels.removeApiKeyConfirm)
    expect(onRemove).not.toHaveBeenCalled()

    await clickText(container, labels.removeApiKeyConfirmAction)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain(labels.removeApiKeyConfirm)
  })
})
