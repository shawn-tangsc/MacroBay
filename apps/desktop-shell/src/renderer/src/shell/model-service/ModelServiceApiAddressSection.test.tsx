// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildChatCompletionsUrl,
  buildGeminiGenerateUrl,
  buildMessagesUrl,
  buildResponsesUrl
} from '@platform/ai/providers/providerEndpoints'
import { platformText } from '../../i18n/platformText'
import { renderModelServiceSettings } from './modelServicePageHarness'

/**
 * PLAT-81（R3 第二阶段）：API 地址区块**只剩摘要**。
 *
 * - 标题行：`API 地址` + `添加端点`（同一行）；
 * - 一个只读地址框显示主 base + 齿轮；
 * - 端点标签列**端点种类**（`Chat` / `Responses` / `Anthropic Messages` / `Gemini 原生`），
 *   顺序 = `provider.endpoints` 顺序，`[0]` 就是默认端点；
 * - 只列已配置（base 非空）的端点，默认端点带「默认」徽章；
 * - **编辑只在「请求配置」抽屉里**：地址框 / 齿轮 / 添加端点 三个入口都打开同一个抽屉。
 */
const labels = platformText['en-US'].models

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

const drawer = (): HTMLElement | null => document.querySelector<HTMLElement>('.request-config-drawer')
/** 抽屉当前是否真的处于打开态：只看 DOM 里有没有残留节点会被关闭动画干扰。 */
const isDrawerOpen = (): boolean =>
  drawer()?.closest('.ant-drawer')?.classList.contains('ant-drawer-open') ?? false
const drawerInputs = (): NodeListOf<HTMLInputElement> => document.querySelectorAll<HTMLInputElement>('[data-endpoint-input]')
const tagsOf = (container: HTMLElement): HTMLSpanElement[] =>
  [...container.querySelectorAll<HTMLSpanElement>('[data-endpoint-summary-tag]')]

describe('PLAT-81 API 地址摘要', () => {
  it('renders endpoint kinds (Chat + Anthropic Messages) instead of the generic OpenAI protocol name', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
          { protocol: 'messages', baseUrl: 'https://anthropic.example.com' }
        ]
      }
    })

    const section = page.container.querySelector('[data-api-address-section]')
    expect(section).not.toBeNull()
    expect(section?.querySelector('.model-service-api-address-title')?.textContent).toBe(labels.apiAddress)
    expect(section?.querySelector('[data-add-endpoint]')).not.toBeNull()
    expect(section?.querySelector('[data-request-config-open]')).not.toBeNull()

    // 折叠态：没有任何可编辑端点输入框（摘要框是另一个 data 属性）。
    expect(page.container.querySelectorAll('[data-endpoint-input]')).toHaveLength(0)
    const summaryInput = section?.querySelector<HTMLInputElement>('[data-endpoint-summary-input]')
    expect(summaryInput?.readOnly).toBe(true)
    // 主地址 = chat/completions 端点 base（由端点清单派生）。
    expect(summaryInput?.value).toBe('https://api.siliconflow.cn')

    // 标签是端点种类：Chat（默认）+ Anthropic Messages。
    const tags = tagsOf(page.container)
    expect(tags.map((tag) => tag.getAttribute('data-endpoint-summary-tag'))).toEqual(['chat-completions', 'messages'])
    expect(tags[0]?.textContent).toBe(`${labels.endpointKindChat}${labels.endpointDefaultBadge}`)
    expect(tags[1]?.textContent).toBe(labels.endpointKindMessages)
    // 默认标记只在默认端点那一个标签上。
    expect(tags[0]?.getAttribute('data-endpoint-summary-default')).toBe('true')
    expect(tags[1]?.hasAttribute('data-endpoint-summary-default')).toBe(false)
    // 不再出现笼统的 `OpenAI` 协议标签（会把 chat 与 responses 混为一谈）。
    expect(tags.map((tag) => tag.textContent ?? '').join('|')).not.toContain('OpenAI')

    await act(async () => page.root.unmount())
  })

  it('shows 未配置端点 when the provider has no endpoint', async () => {
    const page = await renderModelServiceSettings({ provider: { endpoints: [] } })

    expect(page.container.querySelectorAll('[data-endpoint-input]')).toHaveLength(0)
    expect(page.container.querySelector('[data-endpoint-summary-tag]')).toBeNull()
    expect(page.container.querySelector('[data-endpoint-summary-empty]')?.textContent)
      .toBe(labels.endpointNotConfigured)

    await act(async () => page.root.unmount())
  })

  it('opens the same single drawer from the address box, the gear and 添加端点', async () => {
    const page = await renderModelServiceSettings()

    for (const selector of ['[data-endpoint-summary-input]', '[data-request-config-open]', '[data-add-endpoint]']) {
      await act(async () => {
        page.container.querySelector<HTMLElement>(selector)?.click()
        await Promise.resolve()
      })
      expect(drawer(), `${selector} should open the request config drawer`).not.toBeNull()
      // 三个入口共用一个抽屉实例。
      expect(document.querySelectorAll('.request-config-drawer')).toHaveLength(1)
      // 抽屉里才有可编辑端点输入框，且值等于已保存地址。
      expect(drawerInputs().length).toBeGreaterThan(0)
      expect(document.querySelector<HTMLInputElement>('[data-endpoint-input="chat-completions"]')?.value)
        .toBe('https://api.siliconflow.cn')

      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-request-config-close]')?.click()
        await Promise.resolve()
      })
    }

    await act(async () => page.root.unmount())
  })

  it('does not reopen the drawer when focus returns to the summary box after closing', async () => {
    const page = await renderModelServiceSettings()
    const summaryInput = page.container.querySelector<HTMLInputElement>('[data-endpoint-summary-input]')
    expect(summaryInput).not.toBeNull()

    // 1. 从摘要地址框打开抽屉。
    await act(async () => {
      summaryInput?.click()
      await Promise.resolve()
    })
    expect(drawer()).not.toBeNull()
    expect(isDrawerOpen()).toBe(true)

    // 2. 关闭抽屉：antd Drawer 关闭后会把焦点还给打开它的元素（= 这个只读地址框）。
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-request-config-close]')?.click()
      await Promise.resolve()
    })
    expect(isDrawerOpen()).toBe(false)

    // 3. 焦点回到摘要框不得再打开抽屉（回归：onFocus 曾是第二个打开入口）。
    await act(async () => {
      summaryInput?.focus()
      await Promise.resolve()
    })
    expect(isDrawerOpen(), 'focusing the summary box must not reopen the request config drawer').toBe(false)

    await act(async () => page.root.unmount())
  })

  it('lists only configured chat endpoints and resolves each tag URL through platform helpers', async () => {
    const base = 'https://x.test'
    const page = await renderModelServiceSettings({
      provider: {
        endpoints: [
          { protocol: 'chat-completions', baseUrl: base },
          { protocol: 'responses', baseUrl: base },
          { protocol: 'messages', baseUrl: `${base}/anthropic` },
          { protocol: 'gemini', baseUrl: base }
        ],
        imageEndpoints: { generation: base, edit: base }
      }
    })

    // 四种聊天端点都配置了 ⇒ 四个标签；图像端点属于另一维度，不出现在这里。
    expect(tagsOf(page.container).map((tag) => tag.getAttribute('data-endpoint-summary-tag')))
      .toEqual(['chat-completions', 'responses', 'messages', 'gemini'])

    const urlOf = (protocol: string): string | null =>
      page.container.querySelector(`[data-endpoint-summary-tag="${protocol}"]`)?.getAttribute('title') ?? null
    // 拼接一律来自 @platform/ai/providers/providerEndpoints（不在前端另写一份）。
    expect(urlOf('chat-completions')).toBe(buildChatCompletionsUrl(base))
    expect(urlOf('responses')).toBe(buildResponsesUrl(base))
    expect(urlOf('messages')).toBe(buildMessagesUrl(`${base}/anthropic`))
    expect(urlOf('gemini')).toBe(buildGeminiGenerateUrl(base, '{model}'))
    expect(page.container.querySelector('[data-endpoint-summary-tag="generation"]')).toBeNull()
    expect(page.container.querySelector('[data-endpoint-summary-tag="edit"]')).toBeNull()

    await act(async () => page.root.unmount())
  })

  it('does not list endpoints that have no address yet', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
          { protocol: 'responses', baseUrl: '' },
          { protocol: 'gemini', baseUrl: '' }
        ]
      }
    })

    expect(tagsOf(page.container).map((tag) => tag.getAttribute('data-endpoint-summary-tag')))
      .toEqual(['chat-completions'])

    await act(async () => page.root.unmount())
  })

  it('marks the provider default endpoint with the 默认 badge', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        endpoints: [
          { protocol: 'responses', baseUrl: 'https://r.test' },
          { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
          { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
        ]
      }
    })

    const tags = tagsOf(page.container)
    // 标签顺序 = 端点清单顺序，默认端点（`endpoints[0]`）在前。
    expect(tags.map((tag) => tag.getAttribute('data-endpoint-summary-tag')))
      .toEqual(['responses', 'chat-completions', 'messages'])
    const defaultTag = page.container.querySelector('[data-endpoint-summary-tag="responses"]')
    expect(defaultTag?.getAttribute('data-endpoint-summary-default')).toBe('true')
    expect(defaultTag?.querySelector('[data-endpoint-summary-default-badge]')?.textContent)
      .toBe(labels.endpointDefaultBadge)
    expect(page.container.querySelector('[data-endpoint-summary-tag="chat-completions"]')
      ?.hasAttribute('data-endpoint-summary-default')).toBe(false)

    await act(async () => page.root.unmount())
  })

  it('opens the drawer from 添加端点 with the add-endpoint menu collapsed', async () => {
    const page = await renderModelServiceSettings()

    await act(async () => {
      page.container.querySelector<HTMLElement>('[data-add-endpoint]')?.click()
      await Promise.resolve()
    })
    expect(drawer()).not.toBeNull()
    // 抽屉打开时下拉必须收起：只有点触发按钮才展开（浮层，不挤动下方区块）。
    expect(document.querySelector('[data-request-config-add-menu]')).toBeNull()
    expect(document.querySelector('[data-request-config-add]')?.getAttribute('aria-expanded')).toBe('false')

    await act(async () => page.root.unmount())
  })
})
