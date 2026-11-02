// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { maskSecret as modelMaskSecret } from '@platform/ai/providers/providerStore'
import { maskSecret as webSearchMaskSecret } from '@platform/ai/web-search/runtime/WebSearchCredentialStore'

import { platformText } from '../../../i18n/platformText'
import { API_KEY_REVEAL_TIMEOUT_MS, WebSearchApiKeyField } from './WebSearchApiKeyField'

const labels = platformText['zh-CN'].webSearch

/** 迁移后眼睛不再有私有类名：按读屏名（显示/隐藏密钥）找。 */
const eyeSelector = `button[aria-label="${labels.showApiKey}"],button[aria-label="${labels.hideApiKey}"]`
const savedKey = 'tvly-1234567890-HcHz'
const preview = 'tvly**********HcHz'

let root: Root | undefined

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

/** 复制入口按读屏名找：迁移后不再有私有类名。 */
function copyButton(container: HTMLElement): HTMLElement | null {
  return [...container.querySelectorAll<HTMLElement>('button')].find(
    (button) => button.getAttribute('aria-label') === labels.copyApiKey
  ) ?? null
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

    await click(container, eyeSelector)
    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(inputOf(container).value).toBe(savedKey)
    expect(container.innerHTML).toContain(savedKey)

    await click(container, eyeSelector)
    expect(inputOf(container).value).toBe(preview)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('copies the revealed key and takes the copy affordance away with the mask', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const container = await mount()

    // 掩码态没有复制：看不到就不该能复制。
    expect(copyButton(container)).toBeNull()

    await click(container, eyeSelector)
    await click(container, `[aria-label="${labels.copyApiKey}"]`)
    expect(writeText).toHaveBeenCalledWith(savedKey)

    await click(container, eyeSelector)
    expect(copyButton(container)).toBeNull()
  })

  it('auto-hides the revealed key after 30 seconds', async () => {
    vi.useFakeTimers()
    const container = await mount()
    await click(container, eyeSelector)
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
    await click(container, eyeSelector)
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
    await click(container, eyeSelector)
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

    await click(container, eyeSelector)

    expect(onReveal).not.toHaveBeenCalled()
    expect(inputOf(container).value).toBe(preview)
    expect(container.textContent).toContain(labels.revealApiKeyUnavailable)
    // 确定性失败：桥不会自己出现，重试永远得到同一结果——给按钮只会让人以为是自己点法不对。
    expect(container.textContent).not.toContain(labels.retry)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('classifies a rejected main-process call', async () => {
    const container = await mount({
      onReveal: async () => {
        throw new Error('vault-down')
      }
    })

    await click(container, eyeSelector)

    expect(inputOf(container).value).toBe(preview)
    expect(container.textContent).toContain(labels.revealApiKeyBridgeFailed)
    // 瞬时失败：重试可能改变结果，动作必须在——但它是**句子里的文字动作**，不是第二个按钮。
    expect(container.textContent).toContain(labels.retry)
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === labels.retry)
    // 颜色、字号、焦点环都由共享类给；调用点不许自带走一套（antd 链接色不在 token 里）。
    expect(retry?.className).toContain('text-action')
    expect(retry?.getAttribute('style')).toBeNull()
    expect(container.querySelector('.ant-btn-link')).toBeNull()
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('classifies a null result as a missing saved key', async () => {
    const container = await mount({ onReveal: async () => null })

    await click(container, eyeSelector)

    expect(inputOf(container).value).toBe(preview)
    expect(container.textContent).toContain(labels.revealApiKeyMissing)
    expect(container.innerHTML).not.toContain(savedKey)
  })

  it('succeeds on the next eye click once the bridge is there (no retry button to click)', async () => {
    const onReveal = vi.fn(async () => savedKey)
    const container = await mount({ onReveal, bridge: false })
    await click(container, eyeSelector)
    expect(container.textContent).toContain(labels.revealApiKeyUnavailable)

    // 确定性失败没有重试按钮：用户能做的就是让桥回来（重启应用）之后再点一次眼睛。
    installBridge(true)
    await click(container, eyeSelector)

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

    await click(container, eyeSelector)
    expect(input.type).toBe('text')
    await click(container, eyeSelector)
    expect(input.type).toBe('password')

    // 失焦取消：回到掩码且不写入草稿。
    await act(async () => {
      input.focus()
      input.blur()
    })
    expect(input.value).toBe(preview)
    expect(container.innerHTML).not.toContain(savedKey)

    // 铅笔同样进入编辑态。迁移到 IconButton 后不再有私有类名，按读屏名找。
    await click(container, `[aria-label="${labels.editApiKey}"]`)
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

  it('disables the eye when no key is saved and nothing is typed', async () => {
    const container = await mount({ hasApiKey: false })
    const eye = container.querySelector(eyeSelector) as HTMLButtonElement

    expect(eye.disabled).toBe(true)
    // `IconButton` 在类型上禁止「禁用 + Tooltip」并存：禁用的按钮接不到焦点，
    // 提示就只剩鼠标能看见，键盘用户只得到一个没有理由的灰按钮。
    // 迁移后这条理由改由字段自身的占位与提示承担，不再挂在这颗按钮上。
    expect(eye.getAttribute('title')).toBeNull()
    expect(inputOf(container).getAttribute('placeholder')).toBe(labels.apiKeyPlaceholder)
    // 原因必须看得见：字段下方的提示行给出「尚无 Key」，不是悬停才有。
    expect(container.textContent).toContain(labels.noApiKeyHint)
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
