// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SafeWebSearchProviderView } from '@platform/ai/web-search/contracts/webSearchContracts'

import { platformText } from '../../../i18n/platformText'
import { WebSearchProviderDrawer } from './WebSearchProviderDrawer'

/** PLAT-60 · 供应商抽屉：语义沿用 PLAT-55（开关只提交 enabled、Key 掩码/揭示/移除、检查文案）。 */

const labels = platformText['zh-CN'].webSearch
let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

type TestProviderId = 'tavily' | 'jina' | 'searxng' | 'fetch'

function provider(id: TestProviderId): SafeWebSearchProviderView {
  const apiHost =
    id === 'tavily'
      ? 'https://api.tavily.com'
      : id === 'searxng'
        ? 'http://localhost:8080'
        : id === 'jina'
          ? 'https://s.jina.ai'
          : undefined
  const capabilities: SafeWebSearchProviderView['capabilities'] =
    id === 'jina'
      ? [
          { feature: 'searchKeywords', apiHost: 'https://s.jina.ai' },
          { feature: 'fetchUrls', apiHost: 'https://r.jina.ai' }
        ]
      : id === 'fetch'
        ? [{ feature: 'fetchUrls' }]
        : [{ feature: 'searchKeywords', apiHost }]
  return {
    id,
    name: id === 'tavily' ? 'Tavily' : id === 'jina' ? 'Jina' : id === 'searxng' ? 'Searxng' : 'Fetch',
    type: 'api',
    capabilities,
    enabled: true,
    apiHostByCapability:
      id === 'jina'
        ? { searchKeywords: 'https://s.jina.ai', fetchUrls: 'https://r.jina.ai' }
        : apiHost
          ? { searchKeywords: apiHost }
          : {},
    hasApiKey: false,
    apiKeyPreview: '',
    hasBasicAuth: false,
    defaultForCapabilities: [],
    phase: 0,
    implemented: true
  }
}

type SaveFn = (input: Record<string, unknown>) => Promise<void>

async function mount(
  target: SafeWebSearchProviderView,
  onSave: SaveFn = vi.fn(async () => undefined),
  onCheck: (input: unknown) => Promise<unknown> = vi.fn(async () => ({ valid: true }))
): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(WebSearchProviderDrawer, {
        labels,
        provider: target,
        onClose: vi.fn(),
        onSave: onSave as never,
        onCheck: onCheck as never,
        onRevealApiKey: vi.fn(async () => 'revealed-key')
      })
    )
  })
  return container
}

async function clickButton(text: string, scope: ParentNode = document): Promise<void> {
  const button = [...scope.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes(text))
  if (!button) throw new Error(`button not found: ${text}`)
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await settle()
}

async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function drawer(): HTMLElement {
  const element = document.querySelector('.web-search-provider-drawer')
  if (!element) throw new Error('drawer not found')
  return element as HTMLElement
}

describe('PLAT-60 provider drawer', () => {
  it('opens as a right-side masked drawer with hints below the control cell', async () => {
    await mount(provider('jina'))
    const root = document.querySelector('.web-search-provider-drawer-root')
    expect(root?.className).toContain('ant-drawer-right')
    expect(document.querySelector('.ant-drawer-mask')).not.toBeNull()

    const rows = [...drawer().querySelectorAll('.web-search-drawer-body .web-search-form-row')]
    expect(rows.length).toBeGreaterThanOrEqual(3)
    for (const row of rows) {
      const [label, control, hint] = [...row.children]
      expect(label.className).toContain('web-search-form-label')
      expect(control.className).toContain('web-search-form-control')
      expect(hint.className).toContain('web-search-form-hint')
    }
  })

  it('toggle auto-saves only providerId + enabled and never carries drafts', async () => {
    const onSave = vi.fn(async (_input: Record<string, unknown>) => undefined)
    await mount({ ...provider('tavily'), enabled: false }, onSave)

    const input = drawer().querySelector('.web-search-api-key-control input') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'draft-key-123')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const switchEl = drawer().querySelector('[data-web-search-provider-enable]') as HTMLElement
    await act(async () => switchEl.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await settle()

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toEqual({ providerId: 'tavily', enabled: true })
  })

  it('rolls the toggle back and shows an inline error when auto-save fails', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('save-down')
    })
    await mount({ ...provider('tavily'), enabled: false }, onSave)

    const switchEl = drawer().querySelector('[data-web-search-provider-enable]') as HTMLElement
    await act(async () => switchEl.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await settle()

    expect(switchEl.getAttribute('aria-checked')).toBe('false')
    expect(drawer().textContent).toContain(labels.toggleSaveFailed)
  })

  it('saves key + advanced fields without auto-save fields', async () => {
    const onSave = vi.fn(async (_input: Record<string, unknown>) => undefined)
    await mount(provider('tavily'), onSave)
    const input = drawer().querySelector('.web-search-api-key-control input') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'new-key-123456')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await clickButton(labels.saveKeyAndAdvanced, drawer())

    const payload = onSave.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({ providerId: 'tavily', apiKeys: ['new-key-123456'] })
    expect(payload).not.toHaveProperty('enabled')
    expect(payload).not.toHaveProperty('defaultForCapabilities')
  })

  it('renders a saved key as a silent in-control mask with pencil and no persistent length copy', async () => {
    await mount({ ...provider('jina'), hasApiKey: true, apiKeyPreview: 'jina**********3fJG', apiKeyLength: 65 })
    const input = drawer().querySelector('.web-search-api-key-control input') as HTMLInputElement
    const pencil = drawer().querySelector(`[aria-label="${labels.editApiKey}"]`)

    expect(input.value).toBe('jina**********3fJG')
    expect(pencil).not.toBeNull()
    expect(pencil?.getAttribute('title')).toBeNull()
    expect(drawer().textContent).not.toContain(labels.savedKeyLength(65))
    expect(drawer().textContent).not.toContain('位')
    expect(drawer().textContent).not.toContain('jina-secret-key')
    expect([...drawer().querySelectorAll('button')].some((item) => (item.textContent ?? '').includes(labels.replaceApiKey))).toBe(false)
  })

  it('keeps the empty state to placeholder + disabled eye with no extra copy', async () => {
    await mount(provider('tavily'))
    const text = drawer().textContent ?? ''
    const input = drawer().querySelector('.web-search-api-key-control input') as HTMLInputElement
    const eye = drawer().querySelector('.web-search-api-key-eye') as HTMLButtonElement

    expect(input.placeholder).toBe(labels.apiKeyPlaceholder)
    expect(input.placeholder).toContain('必填')
    expect(eye.disabled).toBe(true)
    expect(text).not.toContain(labels.clickToReplace)
    expect(text).not.toContain(labels.toggleImmediateHint)
    expect(text).not.toContain(labels.apiKeyRequiredHint)
    expect(text).not.toContain('已保存（')
    expect(text).not.toContain('位')
    expect(drawer().querySelector('.web-search-api-key-remove-link')).toBeNull()
  })

  it('renders built-in endpoints as read-only text and only searxng as an editable input', async () => {
    await mount(provider('jina'))
    const endpoints = [...drawer().querySelectorAll('[data-web-search-endpoint]')] as HTMLElement[]
    expect(endpoints).toHaveLength(2)
    expect(endpoints.every((endpoint) => endpoint.tagName === 'CODE')).toBe(true)
    expect(drawer().querySelector('[data-web-search-endpoint] input')).toBeNull()
    expect(drawer().textContent).toContain(labels.builtinApiHost)
    expect(drawer().textContent).not.toContain(labels.basicAuthUsername)

    await act(async () => root?.unmount())
    document.body.replaceChildren()
    await mount(provider('searxng'))
    const searxngEndpoint = drawer().querySelector('[data-web-search-endpoint]') as HTMLInputElement
    expect(searxngEndpoint.tagName).toBe('INPUT')
    expect(searxngEndpoint.readOnly).toBe(false)
    expect(drawer().textContent).toContain(labels.basicAuthUsername)
    expect(drawer().textContent).toContain(labels.basicAuthPassword)
    expect(drawer().textContent).toContain(labels.engines)
  })

  it('shows API key only for tavily/jina', async () => {
    for (const id of ['tavily', 'jina'] as const) {
      await act(async () => root?.unmount())
      document.body.replaceChildren()
      await mount(provider(id))
      expect(drawer().querySelector('.web-search-api-key-control')).not.toBeNull()
    }
    for (const id of ['searxng', 'fetch'] as const) {
      await act(async () => root?.unmount())
      document.body.replaceChildren()
      await mount(provider(id))
      expect(drawer().querySelector('.web-search-api-key-control')).toBeNull()
    }
  })

  it('maps missing/unauthorized/invalid-response check failures to readable copy', async () => {
    await mount(provider('jina'), undefined, async () => ({ valid: false, errorCode: 'missing_api_key' }))
    await clickButton(labels.checkProvider, drawer())
    expect(drawer().textContent).toContain(labels.missingApiKey)
    expect(drawer().textContent).toContain('[missing_api_key]')

    await act(async () => root?.unmount())
    document.body.replaceChildren()
    await mount(
      { ...provider('tavily'), hasApiKey: true, apiKeyPreview: 'tvly**********7890', apiKeyLength: 58 },
      undefined,
      async () => ({
        valid: false,
        errorCode: 'provider_unauthorized',
        status: 401,
        message: 'API key is invalid or expired (401).'
      })
    )
    await clickButton(labels.checkProvider, drawer())
    expect(drawer().textContent).toContain(labels.invalidApiKeyWithLength(401, 58))
    expect(drawer().textContent).toContain('当前已保存 58 位')
    expect(drawer().querySelector('.web-search-form-control .web-search-drawer-error')).not.toBeNull()
    expect(drawer().textContent).not.toContain('Bearer')

    await act(async () => root?.unmount())
    document.body.replaceChildren()
    await mount(provider('jina'), undefined, async () => ({
      valid: false,
      errorCode: 'provider_response_invalid',
      message: 'Unexpected non-whitespace character after JSON at position 4'
    }))
    await clickButton(labels.checkProvider, drawer())
    expect(drawer().textContent).toContain(labels.providerResponseInvalid)
    expect(drawer().textContent).toContain('[provider_response_invalid]')
    expect(drawer().textContent).not.toContain('Unexpected non-whitespace')
  })
})
