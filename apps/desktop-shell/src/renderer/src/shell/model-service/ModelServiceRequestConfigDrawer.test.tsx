// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProviderChatEndpoint, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import {
  buildChatCompletionsUrl,
  buildGeminiGenerateUrl,
  buildMessagesUrl,
  buildResponsesUrl
} from '@platform/ai/providers/providerEndpoints'

import { platformText } from '../../i18n/platformText'
import { ModelServiceRequestConfigDrawer } from './ModelServiceRequestConfigDrawer'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const labels = platformText['en-US'].models
const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
let root: Root | undefined

/** 取某个选择器的**最后一条**规则（后写的覆盖前面的）。 */
function rule(selector: string): string {
  const index = css.lastIndexOf(`\n${selector} {`)
  if (index < 0) throw new Error(`missing rule ${selector}`)
  return css.slice(index + 1, css.indexOf('}', index))
}

/** 抽屉的默认 fixture：chat（默认）+ responses + messages。 */
const defaultEndpoints: ProviderChatEndpoint[] = [
  { protocol: 'chat-completions', baseUrl: 'https://example.com' },
  { protocol: 'responses', baseUrl: 'https://responses.example.com' },
  { protocol: 'messages', baseUrl: 'https://anthropic.example.com' }
]

const provider = {
  id: 'custom',
  name: 'Custom',
  endpoints: defaultEndpoints,
  enabled: true,
  baseUrl: 'https://example.com',
  hasApiKey: true,
  apiKeyPreview: 'sk-...',
  models: []
} as unknown as SafeModelProvider

function setValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function blur(input: HTMLElement): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await Promise.resolve()
  })
}

type MountHandles = {
  onSaveEndpoints: ReturnType<typeof vi.fn>
  onSaveImageEndpoint: ReturnType<typeof vi.fn>
}

async function mount(options: { provider?: SafeModelProvider } = {}): Promise<MountHandles> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const onSaveEndpoints = vi.fn(async () => undefined)
  const onSaveImageEndpoint = vi.fn(async () => undefined)
  await act(async () => {
    root?.render(createElement(ModelServiceRequestConfigDrawer, {
      open: true,
      labels,
      provider: options.provider ?? provider,
      onClose: () => undefined,
      onSaveEndpoints,
      onSaveImageEndpoint
    }))
  })
  return { onSaveEndpoints, onSaveImageEndpoint }
}

function addMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-request-config-add-menu]')
}

function addTrigger(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-request-config-add]')
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('PLAT-62 request configuration drawer', () => {
  it('is the only place with editable endpoint inputs and shows the saved addresses', async () => {
    await mount()
    expect(document.querySelector<HTMLInputElement>('[data-endpoint-input="chat-completions"]')?.value)
      .toBe('https://example.com')
    expect(document.querySelector<HTMLInputElement>('[data-endpoint-input="messages"]')?.value)
      .toBe('https://anthropic.example.com')
    expect(document.querySelector<HTMLInputElement>('[data-endpoint-input="responses"]')?.value)
      .toBe('https://responses.example.com')
  })

  it('stacks each endpoint as a name line + a full-width input, without any 测试 button', async () => {
    await mount()

    const chatBlock = document.querySelector<HTMLElement>('[data-request-config-endpoint="chat-completions"]')
    expect(chatBlock).not.toBeNull()
    const head = chatBlock?.querySelector('.request-config-endpoint-head')
    expect(head?.textContent).toContain(labels.endpointKindChat)
    // 上下结构：名字行在输入框之前。
    const input = chatBlock?.querySelector('[data-endpoint-input="chat-completions"]')
    expect(head).not.toBeNull()
    expect(input).not.toBeNull()
    expect(head?.nextElementSibling).toBe(input)
    // 测试按钮彻底移除（聊天端点 / 图像端点都没有）。
    expect(document.querySelector('[data-endpoint-test]')).toBeNull()
    expect(document.querySelector('[data-endpoint-test-result]')).toBeNull()
    // 自定义请求头整块不暴露。
    expect(document.querySelector('[data-request-config-header]')).toBeNull()
    expect(document.querySelector('[data-request-config-add-header]')).toBeNull()
  })

  it('keeps the drawer narrow with the close button outside the scrolling body', async () => {
    await mount()

    const wrapper = document.querySelector<HTMLElement>('.ant-drawer-content-wrapper')
    // 440px 宽的窄抽屉，小屏时最多占 92vw（响应式上限）。
    expect(wrapper?.style.width).toBe('440px')
    expect(wrapper?.style.maxWidth).toBe('92vw')
    expect(document.querySelector('.ant-drawer-footer [data-request-config-close]')).not.toBeNull()
    expect(document.querySelector('.ant-drawer-body [data-request-config-close]')).toBeNull()
  })

  it('marks the default endpoint and offers 设为默认 on the other configured endpoints', async () => {
    const { onSaveEndpoints } = await mount()

    // 默认端点 = 清单第一条：灰色「默认」徽章（不可点，没有按钮）。
    expect(document.querySelector('[data-endpoint-default-badge="chat-completions"]')?.textContent)
      .toBe(labels.endpointDefaultBadge)
    expect(document.querySelector('[data-endpoint-set-default="chat-completions"]')).toBeNull()

    // 其余**已配置**的端点：可点的「设为默认」。
    for (const protocol of ['messages', 'responses']) {
      const button = document.querySelector<HTMLButtonElement>(`[data-endpoint-set-default="${protocol}"]`)
      expect(button?.textContent, protocol).toBe(labels.endpointSetDefault)
      expect(button?.disabled).toBe(false)
    }

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-endpoint-set-default="responses"]')?.click()
      await Promise.resolve()
    })
    // 「设为默认」= 把该端点移到清单头部，其余顺序不变。
    expect(onSaveEndpoints).toHaveBeenCalledWith([
      { protocol: 'responses', baseUrl: 'https://responses.example.com' },
      { protocol: 'chat-completions', baseUrl: 'https://example.com' },
      { protocol: 'messages', baseUrl: 'https://anthropic.example.com' }
    ])
  })

  it('styles the default badge and the set-default button from theme tokens only', async () => {
    await mount()

    // 徽章：强调色文字 + 强调色透明底 + 同色边框（不硬编码颜色）。
    const badge = document.querySelector('[data-endpoint-default-badge]')
    expect(badge?.className).toContain('request-config-default-badge')
    const badgeRule = rule('.request-config-default-badge')
    expect(badgeRule).toContain('color: var(--accent)')
    expect(badgeRule).toContain('background: color-mix(in srgb, var(--accent)')
    expect(badgeRule).toContain('border: 1px solid color-mix(in srgb, var(--accent)')
    expect(rule('.request-config-default-badge')).not.toMatch(/#[0-9a-f]{3,8}/i)

    // 非默认端点：是真的按钮（边框 / hover / 焦点环 / cursor）。
    const button = document.querySelector('[data-endpoint-set-default]')
    expect(button?.className).toContain('request-config-set-default')
    const buttonRule = rule('.request-config-set-default')
    expect(buttonRule).toContain('border: 1px solid var(--border-strong)')
    expect(buttonRule).toContain('cursor: pointer')
    expect(rule('.request-config-set-default:hover')).toContain('border-color: color-mix(in srgb, var(--accent)')
    expect(rule('.request-config-set-default:focus-visible')).toContain('box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent)')
    expect(rule('.request-config-set-default')).not.toMatch(/#[0-9a-f]{3,8}/i)

    // 上下结构：名字行 + 整行输入框，端点行之间统一 12px 间距。
    const blockRule = rule('.request-config-endpoint-block')
    expect(blockRule).toContain('flex-direction: column')
    expect(blockRule).toContain('margin-top: 12px')
    expect(rule('.request-config-endpoint-head')).toContain('align-items: center')
    // 删除图标：24×24 点击区、14px 图标、固定在该行最右；hover 用危险色、focus-visible 有焦点环。
    const deleteRule = rule('.request-config-endpoint-head .request-config-delete')
    expect(deleteRule).toContain('width: 24px')
    expect(deleteRule).toContain('height: 24px')
    expect(deleteRule).toContain('margin-left: auto')
    expect(deleteRule).toContain('cursor: pointer')
    expect(rule('.request-config-endpoint-head .request-config-delete:hover')).toContain('var(--danger)')
    expect(rule('.request-config-endpoint-head .request-config-delete:focus-visible')).toContain('box-shadow')
  })

  it('lists endpoints in list order no matter which one is the default', async () => {
    for (const order of [
      ['chat-completions', 'responses', 'messages'],
      ['messages', 'chat-completions', 'responses'],
      ['responses', 'messages', 'chat-completions']
    ] as const) {
      const endpoints = order.map((protocol) => ({
        protocol,
        baseUrl: protocol === 'messages' ? 'https://anthropic.example.com' : `https://${protocol}.example.com`
      }))
      await mount({ provider: { ...provider, endpoints } as SafeModelProvider })
      const rows = [...document.querySelectorAll<HTMLElement>('[data-request-config-endpoint]')]
        .map((row) => row.getAttribute('data-request-config-endpoint'))
      expect(rows, `order=${order.join('>')}`).toEqual([...order])
      // 默认标记只有一个，并且落在第一条上。
      expect(document.querySelectorAll('[data-endpoint-default-badge]')).toHaveLength(1)
      expect(document.querySelector(`[data-endpoint-default-badge="${order[0]}"]`)).not.toBeNull()
      await act(async () => root?.unmount())
      root = undefined
      document.body.replaceChildren()
    }
  })

  it('does not show a set-default button or badge on an unconfigured endpoint', async () => {
    await mount({
      provider: {
        ...provider,
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.com' },
          { protocol: 'responses', baseUrl: '' }
        ]
      } as SafeModelProvider
    })

    // 已声明但没地址：行还在（不会被丢掉），但没有「默认」徽章，也不能设为默认。
    expect(document.querySelector('[data-request-config-endpoint="responses"]')).not.toBeNull()
    expect(document.querySelector('[data-endpoint-default-badge="responses"]')).toBeNull()
    expect(document.querySelector('[data-endpoint-set-default="responses"]')).toBeNull()
  })

  it('keeps the add-endpoint menu collapsed on open and only expands on the trigger', async () => {
    await mount()

    // 抽屉打开时**收起**（不会压住下面的图像区块）。
    expect(addMenu()).toBeNull()
    expect(addTrigger()?.getAttribute('aria-expanded')).toBe('false')

    await act(async () => {
      addTrigger()?.click()
      await Promise.resolve()
    })
    expect(addMenu()).not.toBeNull()
    expect(addTrigger()?.getAttribute('aria-expanded')).toBe('true')
    // 浮层：绝对定位 + z-index + 阴影，不挤动/覆盖下方区块。
    const menuStyle = addMenu()?.getAttribute('style') ?? ''
    expect(menuStyle).toContain('position: absolute')
    expect(menuStyle).toMatch(/z-index:\s*30/)
    expect(menuStyle).toContain('box-shadow')
  })

  it('closes the menu on outside click and on Escape', async () => {
    await mount()

    for (const close of [
      async () => {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      },
      async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      }
    ]) {
      await act(async () => {
        addTrigger()?.click()
        await Promise.resolve()
      })
      expect(addMenu()).not.toBeNull()
      await act(async () => {
        await close()
        await Promise.resolve()
      })
      expect(addMenu()).toBeNull()
    }
  })

  it('only lists protocols that are not declared yet', async () => {
    await mount({
      provider: {
        ...provider,
        endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://example.com' }]
      } as SafeModelProvider
    })

    await act(async () => {
      addTrigger()?.click()
      await Promise.resolve()
    })
    const options = [...document.querySelectorAll<HTMLElement>('[data-request-config-add-option]')]
    expect(options.map((option) => option.getAttribute('data-request-config-add-option')))
      .toEqual(['responses', 'messages', 'gemini'])
  })

  it('prefills a newly added responses endpoint with the provider base url and its preview', async () => {
    const { onSaveEndpoints } = await mount({
      provider: {
        ...provider,
        endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn/' }]
      } as SafeModelProvider
    })

    await act(async () => {
      addTrigger()?.click()
      await Promise.resolve()
    })
    await act(async () => {
      document.querySelector<HTMLElement>('[data-request-config-add-option="responses"]')?.click()
      await Promise.resolve()
    })

    // 预填 = 供应商主地址（trim + 去尾部 `/`）；预填后立即视为已配置。
    const input = document.querySelector<HTMLInputElement>('[data-endpoint-input="responses"]')
    expect(input?.value).toBe('https://api.siliconflow.cn')
    // 落库前归一（trim + 去尾斜杠）：chat 端点 base 与主地址同一份值。
    expect(onSaveEndpoints).toHaveBeenCalledWith([
      { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
      { protocol: 'responses', baseUrl: 'https://api.siliconflow.cn' }
    ])
    expect(document.querySelector('[data-endpoint-set-default="responses"]')).not.toBeNull()
    // 预览行 = 既有派生函数算出的真实请求 URL。
    expect(document.querySelector('[data-endpoint-preview="responses"]')?.textContent)
      .toBe(labels.endpointActualRequestLabel(buildResponsesUrl('https://api.siliconflow.cn')))
  })

  it('does not prefill the gemini endpoint with a relay base url', async () => {
    const { onSaveEndpoints } = await mount({
      provider: {
        ...provider,
        endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn/' }]
      } as SafeModelProvider
    })

    await act(async () => {
      addTrigger()?.click()
      await Promise.resolve()
    })
    await act(async () => {
      document.querySelector<HTMLElement>('[data-request-config-add-option="gemini"]')?.click()
      await Promise.resolve()
    })

    // 没有声明 gemini 原生主机 ⇒ 留空（中转站 base 会拼出不存在的路径）。
    const input = document.querySelector<HTMLInputElement>('[data-endpoint-input="gemini"]')
    expect(input?.value).toBe('')
    expect(input?.getAttribute('placeholder')).toBe(labels.endpointGeminiHostPlaceholder)
    expect(onSaveEndpoints).toHaveBeenCalledWith([
      { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
      { protocol: 'gemini', baseUrl: '' }
    ])
    expect(document.querySelector('[data-endpoint-set-default="gemini"]')).toBeNull()
    expect(document.querySelector('[data-endpoint-gemini-hint]')?.textContent)
      .toBe(labels.endpointGeminiHostHint)
  })

  it('shows the declared gemini native host with its real request preview', async () => {
    await mount({
      provider: {
        ...provider,
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn/' },
          { protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' }
        ]
      } as SafeModelProvider
    })

    const input = document.querySelector<HTMLInputElement>('[data-endpoint-input="gemini"]')
    expect(input?.value).toBe('https://generativelanguage.googleapis.com')
    expect(document.querySelector('[data-endpoint-preview="gemini"]')?.textContent)
      .toBe(labels.endpointActualRequestLabel(buildGeminiGenerateUrl('https://generativelanguage.googleapis.com', '{model}')))
  })

  it('shows the derived request preview for chat and messages endpoints', async () => {
    await mount()

    expect(document.querySelector('[data-endpoint-preview="chat-completions"]')?.textContent)
      .toBe(labels.endpointActualRequestLabel(buildChatCompletionsUrl('https://example.com')))
    expect(document.querySelector('[data-endpoint-preview="messages"]')?.textContent)
      .toBe(labels.endpointActualRequestLabel(buildMessagesUrl('https://anthropic.example.com')))
  })

  it('adds an endpoint from the menu and focuses its address input', async () => {
    const { onSaveEndpoints } = await mount()

    await act(async () => {
      addTrigger()?.click()
      await Promise.resolve()
    })
    // 已声明的三条协议不再出现在下拉里，只剩 gemini。
    const options = [...document.querySelectorAll<HTMLElement>('[data-request-config-add-option]')]
    expect(options.map((option) => option.getAttribute('data-request-config-add-option'))).toEqual(['gemini'])
    expect(options[0]?.textContent).toBe(labels.endpointKindGemini)

    await act(async () => {
      options[0]?.click()
      await Promise.resolve()
    })
    expect(addMenu()).toBeNull()
    expect(document.querySelector('[data-request-config-endpoint="gemini"]')).not.toBeNull()
    expect(onSaveEndpoints).toHaveBeenCalledWith([
      ...defaultEndpoints,
      { protocol: 'gemini', baseUrl: '' }
    ])
    // 焦点落到新行的地址输入框。
    expect(document.activeElement).toBe(document.querySelector('[data-endpoint-input="gemini"]'))
  })

  it('separates chat endpoints and image base URLs into two titled sections with the same hairlines', async () => {
    await mount({
      provider: {
        ...provider,
        imageEndpoints: { generation: 'https://images.example.com/gen' }
      } as SafeModelProvider
    })

    const titles = [...document.querySelectorAll<HTMLElement>('[data-request-config-section-title]')]
    expect(titles.map((title) => title.textContent)).toEqual([
      labels.requestConfigChatEndpoints,
      labels.requestConfigImageEndpoints
    ])
    // 第一个区块不画上方细线，第二个区块有 1px 细线（一致的区块分隔）。
    expect(titles[0]?.getAttribute('style')).toContain('border-top-width: 0')
    expect(titles[1]?.getAttribute('style')).toContain('border-top-width: 1px')

    // 图像两个字段固定展示、两列排版、是独立的 Base URL，不参与默认端点。
    for (const kind of ['generation', 'edit']) {
      const row = document.querySelector(`[data-request-config-image-endpoint="${kind}"]`)
      expect(row, kind).not.toBeNull()
      const rowLabel = kind === 'generation' ? labels.requestConfigImageGeneration : labels.requestConfigImageEdit
      expect(row?.textContent, kind).toContain(rowLabel)
      expect(document.querySelector(`[data-endpoint-set-default="${kind}"]`)).toBeNull()
      expect(document.querySelector(`[data-endpoint-default-badge="${kind}"]`)).toBeNull()
    }
    expect(document.querySelector<HTMLInputElement>('[data-endpoint-input="edit"]')?.getAttribute('placeholder'))
      .toBe(labels.requestConfigImageBasePlaceholder)
    expect(document.querySelector('[data-endpoint-image-hint="generation"]')?.textContent)
      .toBe(labels.requestConfigImageGenerationHint)
  })

  it('saves the whole endpoint list on blur', async () => {
    const { onSaveEndpoints } = await mount()
    const input = document.querySelector<HTMLInputElement>('[data-endpoint-input="chat-completions"]')
    if (!input) throw new Error('Expected the chat input.')
    await act(async () => {
      setValue(input, 'https://proxy.example.test')
      await Promise.resolve()
    })
    await blur(input)

    expect(onSaveEndpoints).toHaveBeenCalledWith([
      { protocol: 'chat-completions', baseUrl: 'https://proxy.example.test' },
      { protocol: 'responses', baseUrl: 'https://responses.example.com' },
      { protocol: 'messages', baseUrl: 'https://anthropic.example.com' }
    ])
  })

  it('saves the image endpoint on blur and clears it when emptied', async () => {
    const { onSaveImageEndpoint } = await mount()
    const input = document.querySelector<HTMLInputElement>('[data-endpoint-input="generation"]')
    if (!input) throw new Error('Expected the image generation input.')
    await act(async () => {
      setValue(input, 'https://images.example.com/gen')
      await Promise.resolve()
    })
    await blur(input)
    expect(onSaveImageEndpoint).toHaveBeenCalledWith('generation', 'https://images.example.com/gen')
  })

  it('deletes an endpoint immediately (responses) and keeps the others', async () => {
    const { onSaveEndpoints } = await mount()
    const remove = document.querySelector<HTMLButtonElement>('[data-endpoint-delete="responses"]')
    expect(remove?.disabled).toBe(false)
    // 图标与端点名字号一致（14px），可点击区域 24×24。
    expect(remove?.getAttribute('aria-label')).toBe(labels.endpointDelete)
    expect(remove?.querySelector('svg')?.getAttribute('width')).toBe('14')
    await act(async () => {
      remove?.click()
      await Promise.resolve()
    })
    expect(onSaveEndpoints).toHaveBeenCalledWith([
      { protocol: 'chat-completions', baseUrl: 'https://example.com' },
      { protocol: 'messages', baseUrl: 'https://anthropic.example.com' }
    ])
  })

  it('disables deletion when only one endpoint is left', async () => {
    await mount({
      provider: {
        ...provider,
        endpoints: [{ protocol: 'responses', baseUrl: 'https://responses.example.com' }]
      } as SafeModelProvider
    })

    const remove = document.querySelector<HTMLButtonElement>('[data-endpoint-delete="responses"]')
    expect(remove).not.toBeNull()
    expect(remove?.disabled).toBe(true)
    expect(remove?.getAttribute('title')).toBe(labels.endpointKeepAtLeastOne)
    // 禁用态视觉上降到 40% 不透明度。
    expect(rule('.request-config-endpoint-head .request-config-delete:disabled')).toContain('opacity: 0.4')
  })
})
