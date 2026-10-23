// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../../i18n/platformText'

import {
  MODEL_PROVIDER_API_KEY_AUTO_HIDE_MS,
  ModelProviderApiKeyField,
  type RevealModelProviderApiKey
} from './ModelProviderApiKeyField'

const labels = platformText['zh-CN'].models
const savedKey = 'sk-live-1234567890-abcdef'
const preview = 'sk-l**********cdef'
const otherPreview = 'deep...seek'

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.useRealTimers()
})

type HarnessProps = {
  providerId?: string
  hasApiKey?: boolean
  apiKeyPreview?: string
  revealApiKey?: RevealModelProviderApiKey
}

/** 受控草稿外壳：把 `value/onChange` 接成真实受控输入（组件本身不持有草稿）。 */
function Harness(props: HarnessProps): React.ReactElement {
  const [value, setValue] = useState('')
  return createElement(
    'div',
    null,
    createElement('output', { 'data-draft': value }),
    createElement(ModelProviderApiKeyField, {
      labels,
      providerId: props.providerId ?? 'openai',
      hasApiKey: props.hasApiKey ?? true,
      apiKeyPreview: props.apiKeyPreview ?? preview,
      value,
      onChange: setValue,
      revealApiKey: props.revealApiKey ?? (async () => ({ apiKey: savedKey }))
    })
  )
}

function draftOf(container: HTMLElement): string {
  return container.querySelector('output')?.getAttribute('data-draft') ?? ''
}

async function mount(props: HarnessProps = {}): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(Harness, props))
  })
  return container
}

async function rerender(props: HarnessProps): Promise<void> {
  await act(async () => {
    root?.render(createElement(Harness, props))
  })
}

function apiKeyInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.provider-api-key-input input')
  if (!input) throw new Error('Expected API Key input.')
  return input
}

/** R5：眼睛是 antd `Input.Password` **自带**的图标（`span.ant-input-password-icon`），不是自绘按钮。 */
function eyeButton(container: HTMLElement): HTMLElement {
  const eye = container.querySelector<HTMLElement>('.provider-api-key-eye')
  if (!eye) throw new Error('Expected the built-in antd password toggle icon.')
  return eye
}

function eyeButtonOrNull(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.provider-api-key-eye')
}

async function clickEye(container: HTMLElement): Promise<void> {
  await act(async () => {
    eyeButton(container).click()
    await Promise.resolve()
  })
}

async function clickField(container: HTMLElement): Promise<void> {
  await act(async () => {
    apiKeyInput(container).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
}

async function pressEscape(container: HTMLElement): Promise<void> {
  await act(async () => {
    apiKeyInput(container).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

async function blurField(container: HTMLElement): Promise<void> {
  await act(async () => {
    apiKeyInput(container).dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

function writeDraft(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('PLAT-58 model provider API key reveal field', () => {
  it('shows the existing masked preview by default and never renders the saved key', async () => {
    const reveal = vi.fn(async () => ({ apiKey: savedKey }))
    const container = await mount({ revealApiKey: reveal })

    expect(apiKeyInput(container).value).toBe(preview)
    expect(apiKeyInput(container).readOnly).toBe(true)
    // 普通输入框（type=text）+ 框内自绘眼睛；掩码态显示头尾省略的预览。
    expect(apiKeyInput(container).type).toBe('text')
    expect(container.querySelector('.ant-input-password')).toBeNull()
    expect(container.querySelector('.provider-api-key-eye')).not.toBeNull()
    expect(container.innerHTML).not.toContain(savedKey)
    expect(reveal).not.toHaveBeenCalled()
  })

  it('reveals the full saved key through exactly one reveal call', async () => {
    const reveal = vi.fn(async () => ({ apiKey: savedKey }))
    const container = await mount({ revealApiKey: reveal })

    await clickEye(container)

    expect(reveal).toHaveBeenCalledTimes(1)
    expect(reveal).toHaveBeenCalledWith('openai')
    expect(apiKeyInput(container).value).toBe(savedKey)
    // 明文态显示"隐藏密钥"（再点一次收起）。
    expect(eyeButton(container).getAttribute('aria-label')).toBe(labels.hideApiKey)
  })

  it('returns to the mask after the named 30s auto-hide window and drops the key from the DOM', async () => {
    vi.useFakeTimers()
    const container = await mount()

    await clickEye(container)
    expect(apiKeyInput(container).value).toBe(savedKey)

    await act(async () => {
      vi.advanceTimersByTime(MODEL_PROVIDER_API_KEY_AUTO_HIDE_MS)
    })

    expect(MODEL_PROVIDER_API_KEY_AUTO_HIDE_MS).toBe(30_000)
    expect(apiKeyInput(container).value).toBe(preview)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('hides the revealed key immediately on blur', async () => {
    const container = await mount()

    await clickEye(container)
    expect(apiKeyInput(container).value).toBe(savedKey)

    await blurField(container)

    expect(apiKeyInput(container).value).toBe(preview)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('clears a revealed key when switching providers', async () => {
    const container = await mount({ providerId: 'openai' })

    await clickEye(container)
    expect(apiKeyInput(container).value).toBe(savedKey)

    await rerender({ providerId: 'deepseek', apiKeyPreview: otherPreview })

    expect(apiKeyInput(container).value).toBe(otherPreview)
    expect(container.innerHTML).not.toContain(savedKey)
    // 切换后回到掩码态：眼睛提示"显示密钥"。
    expect(eyeButton(container).getAttribute('aria-label')).toBe(labels.showApiKey)
  })

  it('drops the revealed key from the DOM on unmount without firing the auto-hide timer', async () => {
    vi.useFakeTimers()
    const container = await mount()

    await clickEye(container)
    expect(apiKeyInput(container).value).toBe(savedKey)

    await act(async () => {
      root?.unmount()
      root = undefined
    })

    expect(container.innerHTML).not.toContain(savedKey)
    await act(async () => {
      vi.advanceTimersByTime(MODEL_PROVIDER_API_KEY_AUTO_HIDE_MS)
    })
  })

  it('keeps the mask and shows an inline error when reveal fails', async () => {
    const container = await mount({
      revealApiKey: async () => {
        throw new Error('provider-secret-vault-unavailable')
      }
    })

    await clickEye(container)

    expect(apiKeyInput(container).value).toBe(preview)
    expect(container.textContent).toContain(labels.revealApiKeyFailed)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('keeps the mask and shows an inline error when nothing can be revealed', async () => {
    const container = await mount({ revealApiKey: async () => ({ apiKey: null }) })

    await clickEye(container)

    expect(apiKeyInput(container).value).toBe(preview)
    expect(container.textContent).toContain(labels.revealApiKeyFailed)
  })

  it('does not change the displayed value or call reveal on hover or focus', async () => {
    const reveal = vi.fn(async () => ({ apiKey: savedKey }))
    const container = await mount({ revealApiKey: reveal })
    const input = apiKeyInput(container)

    await act(async () => {
      input.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      input.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })

    expect(input.value).toBe(preview)
    expect(reveal).not.toHaveBeenCalled()
    expect(container.innerHTML).not.toContain(savedKey)
  })


  it('enters replace mode by clicking the masked field without revealing the saved key', async () => {
    const reveal = vi.fn(async () => ({ apiKey: savedKey }))
    const container = await mount({ revealApiKey: reveal })

    await clickField(container)

    const input = apiKeyInput(container)
    expect(input.value).toBe('')
    expect(input.readOnly).toBe(false)
    expect(input.placeholder).toBe(labels.apiKeyPlaceholder)
    expect(reveal).not.toHaveBeenCalled()

    await act(async () => {
      writeDraft(input, 'new-key-123456')
    })
    expect(apiKeyInput(container).value).toBe('new-key-123456')
    expect(apiKeyInput(container).type).toBe('text')
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('cancels replace mode with Escape without writing the draft', async () => {
    const reveal = vi.fn(async () => ({ apiKey: savedKey }))
    const container = await mount({ revealApiKey: reveal })

    await clickField(container)
    await act(async () => {
      writeDraft(apiKeyInput(container), 'draft-key-123456')
    })
    expect(draftOf(container)).toBe('draft-key-123456')

    await pressEscape(container)

    expect(apiKeyInput(container).value).toBe(preview)
    expect(apiKeyInput(container).readOnly).toBe(true)
    expect(draftOf(container)).toBe('')
    expect(reveal).not.toHaveBeenCalled()
  })

  it('returns to the mask on blur when the draft is empty, without writing', async () => {
    const container = await mount()

    await clickField(container)
    expect(apiKeyInput(container).value).toBe('')

    await blurField(container)

    expect(apiKeyInput(container).value).toBe(preview)
    expect(draftOf(container)).toBe('')
  })

  it('keeps a non-empty draft on blur so the outer blur-save can persist it', async () => {
    const container = await mount()

    await clickField(container)
    await act(async () => {
      writeDraft(apiKeyInput(container), 'replacement-key-123456')
    })

    await blurField(container)

    // 输入框回到掩码（编辑态结束），草稿仍由外层持有（失焦即存）。
    expect(apiKeyInput(container).value).toBe(preview)
    expect(draftOf(container)).toBe('replacement-key-123456')
  })

  it('disables the eye when no key is saved and nothing is typed', async () => {
    const reveal = vi.fn(async () => ({ apiKey: savedKey }))
    const container = await mount({ hasApiKey: false, apiKeyPreview: '', revealApiKey: reveal })

    // 没有可显示内容时眼睛仍在，但被禁用（避免"点了没反应"）。
    expect(eyeButtonOrNull(container)?.hasAttribute('disabled')).toBe(true)
    expect(apiKeyInput(container).placeholder).toBe(labels.apiKeyPlaceholder)
  })

  it('keeps the eye as a plain text toggle for a typed draft', async () => {
    const reveal = vi.fn(async () => ({ apiKey: savedKey }))
    const container = await mount({ hasApiKey: false, apiKeyPreview: '', revealApiKey: reveal })
    const input = apiKeyInput(container)

    await act(async () => {
      writeDraft(input, 'new-key-123456')
    })
    expect(input.type).toBe('text')

    await clickEye(container)
    expect(input.type).toBe('text')

    await clickEye(container)
    expect(input.type).toBe('text')
    expect(reveal).not.toHaveBeenCalled()
  })
})
