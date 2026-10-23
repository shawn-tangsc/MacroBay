// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelProviderInput } from '@platform/ai/providers/modelProviderTypes'

import {
  apiKeyFixture,
  apiKeyInput,
  blurElement,
  openProviderMoreMenu,
  pageLabels as labels,
  pageStatusText,
  providerFixture,
  renderModelServiceSettings,
  typeInto
} from './modelServicePageHarness'

/**
 * PLAT-61：改动即存的**边界**判据（布局判据在 `ModelServiceProviderPage.test.tsx`）。
 *
 *  - 启用开关失败 ⇒ 回滚到原值 + 行内错误（不回退整页、不弹整页提示）；
 *  - 端点默认只读，点「覆盖」才可编辑并显示风险提示，失焦保存走既有 upsert 且只改被覆盖的地址。
 */

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

/** R3：端点编辑只在请求配置抽屉里 —— 点齿轮打开，抽屉里才有 data-endpoint-input。 */
async function openRequestConfig(container: HTMLElement): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-request-config-open]')?.click()
    await Promise.resolve()
  })
  await vi.waitFor(() => expect(document.querySelector('[data-endpoint-input]')).not.toBeNull())
}

describe('PLAT-61 改动即存边界', () => {
  it('启用开关保存失败时回滚开关并给行内错误', async () => {
    const page = await renderModelServiceSettings({ setEnabledError: new Error('provider-enable-write-failed') })
    const api = page.api

    const switchButton = page.container.querySelector<HTMLButtonElement>('[data-provider-switch] button[role="switch"]')
    expect(switchButton?.getAttribute('aria-checked')).toBe('true')
    await act(async () => {
      switchButton?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(api.setEnabled).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => {
      expect(page.container.querySelector('[data-provider-enable-error]')?.textContent).toContain(pageStatusText.failed)
    })
    // 回滚到原值（仍为启用），整页其它区域不回退。
    expect(
      page.container.querySelector('[data-provider-switch] button[role="switch"]')?.getAttribute('aria-checked')
    ).toBe('true')
    expect(api.list).toHaveBeenCalledTimes(1)
    expect(page.container.querySelector('[data-model-service-page]')).not.toBeNull()
    expect(apiKeyInput(page.container)).toBeTruthy()

    await act(async () => page.root.unmount())
  })

  it('摘要态没有可编辑端点；抽屉里改 base 只覆盖该地址', async () => {
    const page = await renderModelServiceSettings()
    const api = page.api
    // R3：页面上（摘要）没有任何端点输入框。
    expect(page.container.querySelectorAll('[data-endpoint-input]')).toHaveLength(0)

    await openRequestConfig(page.container)
    const input = document.querySelector<HTMLInputElement>('[data-endpoint-input="chat-completions"]')
    if (!input) throw new Error('Expected endpoint input in the drawer.')
    expect(input.value).toBe(providerFixture.baseUrl)

    const nextBaseUrl = 'https://api.example.test/proxy'
    await typeInto(input, nextBaseUrl)
    await blurElement(input)

    await vi.waitFor(() => expect(api.upsert).toHaveBeenCalledTimes(1))
    const saved = api.upsert.mock.calls[0]?.[0] as ModelProviderInput
    // 写入的是整份端点清单：只改了 chat/completions 那一条，messages 原样保留。
    expect(saved.endpoints).toEqual([
      { protocol: 'chat-completions', baseUrl: nextBaseUrl },
      { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
    ])

    await act(async () => page.root.unmount())
  })

  it('点击掩码框即可替换：清空为草稿、可输入、不触发 reveal；失焦保存一次', async () => {
    const page = await renderModelServiceSettings()
    const api = page.api
    const input = apiKeyInput(page.container)
    expect(input.value).toBe(providerFixture.apiKeyPreview)

    await act(async () => {
      input.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(apiKeyInput(page.container).value).toBe('')
    expect(apiKeyInput(page.container).readOnly).toBe(false)
    expect(api.revealApiKey).not.toHaveBeenCalled()

    await typeInto(apiKeyInput(page.container), apiKeyFixture)
    await blurElement(apiKeyInput(page.container))

    await vi.waitFor(() => expect(api.upsert).toHaveBeenCalledTimes(1))
    expect((api.upsert.mock.calls[0]?.[0] as ModelProviderInput).apiKey).toBe(apiKeyFixture)
  })

  it('Escape 取消替换：回掩码且不写入', async () => {
    const page = await renderModelServiceSettings()
    const api = page.api
    const input = apiKeyInput(page.container)

    await act(async () => {
      input.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    await typeInto(apiKeyInput(page.container), 'sk-cancelled-123456')
    await act(async () => {
      apiKeyInput(page.container).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(apiKeyInput(page.container).value).toBe(providerFixture.apiKeyPreview)
    expect(apiKeyInput(page.container).readOnly).toBe(true)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(api.upsert).not.toHaveBeenCalled()
  })

  it('常驻只有一行替换提示；系统供应商的删除入口只在品牌块 ⋯ 菜单里且禁用', async () => {
    const page = await renderModelServiceSettings()

    const hint = page.container.querySelector('[data-key-replace-hint]')
    expect(hint?.textContent?.trim()).toBe(labels.savedApiKeyMaskHint)
    expect(page.container.textContent).not.toContain(labels.systemProviderHint)
    // PLAT-81：密钥分区不再有 ⚙ 高级面板。
    expect(page.container.querySelector('[data-key-advanced]')).toBeNull()
    expect(page.container.querySelector('[data-remove-provider]')).toBeNull()

    await openProviderMoreMenu(page.container)
    const menu = page.container.querySelector('[data-provider-more-menu]')
    expect(menu?.textContent).toContain(labels.systemProviderCannotDelete)
    expect(page.container.querySelector<HTMLButtonElement>('[data-remove-provider]')?.disabled).toBe(true)
    expect(page.container.querySelectorAll('[data-key-replace-hint]')).toHaveLength(1)
  })

  it('清空地址后失焦：端点仍然保留（空串 = 已声明未配置），不做隐式回落', async () => {
    const page = await renderModelServiceSettings()
    const api = page.api
    await openRequestConfig(page.container)

    const input = document.querySelector<HTMLInputElement>('[data-endpoint-input="chat-completions"]')
    if (!input) throw new Error('Expected endpoint input.')
    await typeInto(input, '   ')
    await blurElement(input)

    // 空地址是合法状态（端点已声明、还没配地址）：落库时保留空串，重启后行还在。
    await vi.waitFor(() => expect(api.upsert).toHaveBeenCalledTimes(1))
    const saved = api.upsert.mock.calls[0]?.[0] as ModelProviderInput
    expect(saved.endpoints).toEqual([
      { protocol: 'chat-completions', baseUrl: '' },
      { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
    ])

    await act(async () => page.root.unmount())
  })

/**
 * PLAT-69：每行就是**一个端点**（协议名即行 id）—— 编辑哪一行就只改那一条，
 * 端点清单是唯一事实源，不再有"主行 + 镜像字段"两份。
 */
describe('PLAT-69 端点行直接写回端点清单', () => {
  async function editEndpoint(
    page: Awaited<ReturnType<typeof renderModelServiceSettings>>,
    protocol: string,
    value: string
  ): Promise<void> {
    await openRequestConfig(page.container)
    const input = document.querySelector<HTMLInputElement>(`[data-endpoint-input="${protocol}"]`)
    if (!input) throw new Error(`Expected the ${protocol} input in the drawer.`)
    await typeInto(input, value)
    await blurElement(input)
  }

  it('writes the Anthropic messages row back into the endpoint list', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        id: 'anthropic',
        name: 'Anthropic',
        endpoints: [
          { protocol: 'messages', baseUrl: 'https://api.anthropic.com' }
        ]
      }
    })

    // 纯 Anthropic 供应商只有 messages 端点 ⇒ 摘要里只有一个标签。
    const tags = [...page.container.querySelectorAll('[data-endpoint-summary-tag]')]
      .map((node) => node.getAttribute('data-endpoint-summary-tag'))
    expect(tags).toEqual(['messages'])

    await editEndpoint(page, 'messages', 'https://anthropic-proxy.example.test')
    await vi.waitFor(() => expect(page.api.upsert).toHaveBeenCalledTimes(1))
    const saved = page.api.upsert.mock.calls[0]?.[0] as ModelProviderInput
    expect(saved.endpoints).toEqual([{ protocol: 'messages', baseUrl: 'https://anthropic-proxy.example.test' }])
    await act(async () => page.root.unmount())
  })

  it('writes the Gemini main row into the native endpoint', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        id: 'gemini',
        name: 'Gemini',
        endpoints: [
          { protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' }
        ]
      }
    })

    await editEndpoint(page, 'gemini', 'https://gemini-proxy.example.test')
    await vi.waitFor(() => expect(page.api.upsert).toHaveBeenCalledTimes(1))
    const saved = page.api.upsert.mock.calls[0]?.[0] as ModelProviderInput
    expect(saved.endpoints).toEqual([{ protocol: 'gemini', baseUrl: 'https://gemini-proxy.example.test' }])
    await act(async () => page.root.unmount())
  })
})
})
