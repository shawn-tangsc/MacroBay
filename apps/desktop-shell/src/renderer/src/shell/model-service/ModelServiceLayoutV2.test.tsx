// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'
import { apiKeyFixture, providerFixture, renderModelServiceSettings } from './modelServicePageHarness'

/**
 * PLAT-81 验收：模型服务页的 4 项界面收尾（R1/R2/R3/R4）。
 *
 * happy-dom 没有布局引擎，所以「用户看得见」用两条互补断言：
 *  ① 真实 DOM：pill 数量 / 文案 / 高度规则来自 styles.css 的具体声明；
 *  ② styles.css 规则：高度 ≥26、品牌块 ≤48、整页只有 2 个 overflow-y 滚动容器。
 */
const labels = platformText['en-US'].models
const zhLabels = platformText['zh-CN'].models
const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

/** 取某个选择器的**最后一条**规则（后写的覆盖前面的）。 */
function rule(selector: string): string {
  const index = css.lastIndexOf(`\n${selector} {`)
  if (index < 0) throw new Error(`missing rule ${selector}`)
  return css.slice(index + 1, css.indexOf('}', index))
}

function px(value: string, property: string): number {
  const match = new RegExp(`${property}:\\s*(-?\\d+(?:\\.\\d+)?)px`).exec(value)
  if (!match) throw new Error(`missing ${property} in: ${value}`)
  return Number(match[1])
}

function model(overrides: Partial<ModelDefinition> & { id: string }): ModelDefinition {
  return { name: overrides.id, capabilities: { chat: true }, ...overrides }
}

function providerWithModels(models: ModelDefinition[]): SafeModelProvider {
  return {
    ...providerFixture,
    id: 'acme',
    name: 'Acme',
    baseUrl: 'https://acme.test',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://acme.test' },
      { protocol: 'messages', baseUrl: 'https://anthropic.acme.test' }
    ],
    hasApiKey: true,
    models,
    defaultChatModelId: models[0]?.id ?? ''
  } as SafeModelProvider
}

describe('R1 模型类型筛选 pill 行（看得见）', () => {
  it('renders 11 type pills with 全部 first and a ≥26px tall row', async () => {
    const page = await renderModelServiceSettings({ language: 'zh-CN' })

    const pills = [...page.container.querySelectorAll<HTMLElement>('[data-model-type-filter] button')]
    expect(pills).toHaveLength(11)
    expect(pills[0]?.textContent).toContain('全部')
    // 智能体不是模型类型（它由协议表达）⇒ 类型行里没有它。
    expect(pills.map((pill) => pill.textContent ?? '').join('|')).not.toContain('智能体')

    // 容器高度规则 ≥26（24px pill + 2px 滚动条余量），且 pill 自身 24px。
    const row = rule('.model-service-type-pills')
    expect(px(row, 'height')).toBeGreaterThanOrEqual(26)
    expect(px(row, 'min-height')).toBeGreaterThanOrEqual(26)
    expect(px(rule('.model-service-type-pill'), 'height')).toBe(24)
    // 选中态是 accent 描边（不是 accent 实底）。
    expect(rule(".model-service-type-pill[data-active='true']")).toMatch(/border-color:\s*var\(--accent\)/)

    await act(async () => page.root.unmount())
  })

  it('keeps both pill rows in one container with 8px / 6px / 10px spacing and no residual frame', () => {
    const container = rule('.model-service-filter-rows')
    expect(container).toMatch(/margin:\s*8px 0 10px/)
    expect(container).toMatch(/gap:\s*6px/)
    // 收起时整块 display:none，且容器自身没有 padding/border（不再残留一条细线）。
    expect(rule('.model-service-filter-rows[hidden]')).toMatch(/display:\s*none/)
    expect(container).toMatch(/padding:\s*0/)
    expect(container).toMatch(/border:\s*0/)
    expect(rule('.model-service-type-pills')).toMatch(/border:\s*0/)
  })
})

describe('R1 漏斗按钮折叠/展开两行 pill', () => {
  it('replaces the old gear with a funnel toggle that hides both pill rows', async () => {
    const page = await renderModelServiceSettings({ language: 'zh-CN' })

    // 齿轮按钮彻底消失，漏斗在它旁边。
    expect(page.container.querySelector('[data-models-settings]')).toBeNull()
    const toggle = page.container.querySelector<HTMLButtonElement>('[data-models-filter-toggle]')
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(toggle?.getAttribute('title')).toBe(zhLabels.hideModelFilters)

    const toolbar = page.container.querySelector('[data-model-service-models] .model-service-section-head')
    const filterContainer = page.container.querySelector('[data-model-filters]')
    expect(toolbar).not.toBeNull()
    expect(filterContainer).not.toBeNull()
    // 工具条在筛选容器之前（折叠不会移动工具条）。
    expect(toolbar?.nextElementSibling).toBe(filterContainer)

    const before = page.container.querySelectorAll('[data-model-type-filter] button').length
    expect(before).toBe(11)
    expect(page.container.querySelectorAll('[data-model-protocol-filter] button')).toHaveLength(4)

    await act(async () => {
      toggle?.click()
      await Promise.resolve()
    })

    // 折叠：pill 数量 0，容器 hidden（display:none），工具条仍是同一个兄弟位置。
    expect(page.container.querySelectorAll('[data-model-type-filter] button')).toHaveLength(0)
    expect(page.container.querySelectorAll('[data-model-protocol-filter] button')).toHaveLength(0)
    expect(page.container.querySelector('[data-model-filters]')?.hasAttribute('hidden')).toBe(true)
    expect(page.container.querySelector('[data-model-service-models] .model-service-section-head')?.nextElementSibling)
      .toBe(page.container.querySelector('[data-model-filters]'))
    expect(page.container.querySelector('[data-models-count]')?.textContent).toBe('3')
    expect(page.container.querySelector<HTMLButtonElement>('[data-models-filter-toggle]')?.getAttribute('aria-expanded'))
      .toBe('false')

    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('[data-models-filter-toggle]')?.click()
      await Promise.resolve()
    })
    expect(page.container.querySelectorAll('[data-model-type-filter] button')).toHaveLength(11)

    await act(async () => page.root.unmount())
  })
})

describe('R4 协议筛选（4 个 pill，可叠加）', () => {
  // T4/T5：每个聊天模型自带协议（不再跟随供应商默认端点）。
  const models = [
    model({ id: 'plain-chat', name: 'Plain', chatProtocol: 'chat-completions' }),
    model({ id: 'claude-only', name: 'Claude', chatProtocol: 'chat-completions', messagesSupport: 'yes' }),
    model({ id: 'gemini-only', name: 'Gemini', chatProtocol: 'gemini' }),
    model({ id: 'embedding-only', name: 'Embed', capabilities: { chat: false, embedding: true } })
  ]

  it('renders exactly four protocol pills without any 全部协议 item', async () => {
    const page = await renderModelServiceSettings({ providers: [providerWithModels(models)], language: 'zh-CN' })

    const pills = [...page.container.querySelectorAll<HTMLElement>('[data-model-protocol-filter] button')]
    expect(pills).toHaveLength(4)
    // 有效协议 = 模型声明 ?? 供应商默认端点：gemini-only 的有效协议是 gemini ⇒ 不计入 Chat。
    expect(pills.map((pill) => pill.textContent)).toEqual([
      `${zhLabels.protocolFilterChat}2`,
      `${zhLabels.protocolFilterResponses}0`,
      `${zhLabels.protocolFilterMessages}1`,
      `${zhLabels.protocolFilterGemini}1`
    ])
    // 每个 pill 带图标（lucide 的 <svg> 或供应商品牌图标）。
    expect(pills.every((pill) => pill.querySelector('svg, img, .visual-avatar') !== null)).toBe(true)
    expect(page.container.querySelector('[data-model-protocol-filter]')?.textContent).not.toContain('全部协议')
    expect(pills[0]?.getAttribute('aria-label')).toBe(zhLabels.protocolFilterChat)

    await act(async () => page.root.unmount())
  })

  it('keeps a gemini-default provider inside the Gemini pill only', async () => {
    // Gemini 预设的默认端点是 gemini；同步/预设模型不再写死 chatProtocol ⇒ 全部跟随默认端点。
    const geminiProvider = {
      ...providerWithModels([
        model({ id: 'gemini-3.5-flash', chatProtocol: 'gemini' }),
        model({ id: 'gemini-2.5-pro', chatProtocol: 'gemini' })
      ]),
      id: 'gemini',
      name: 'Gemini',
      defaultChatProtocol: 'gemini'
    } as SafeModelProvider
    const page = await renderModelServiceSettings({ providers: [geminiProvider], language: 'zh-CN' })

    const pills = [...page.container.querySelectorAll<HTMLElement>('[data-model-protocol-filter] button')]
    expect(pills.map((pill) => pill.textContent)).toEqual([
      `${zhLabels.protocolFilterChat}0`,
      `${zhLabels.protocolFilterResponses}0`,
      `${zhLabels.protocolFilterMessages}0`,
      `${zhLabels.protocolFilterGemini}2`
    ])

    await act(async () => page.root.unmount())
  })

  it('keeps pill counts unchanged when the provider default endpoint changes', async () => {
    const page = await renderModelServiceSettings({ providers: [providerWithModels(models)], language: 'zh-CN' })
    const counts = (): Array<string | null> =>
      [...page.container.querySelectorAll<HTMLElement>('[data-model-protocol-filter] button')]
        .map((pill) => pill.textContent)
    const before = counts()

    // 改供应商默认端点（抽屉「设为默认」）：协议 pill 只读模型自身，计数必须不变。
    await act(async () => {
      page.container.querySelector<HTMLElement>('[data-request-config-open]')?.click()
      await Promise.resolve()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-endpoint-set-default="messages"]')?.click()
      await Promise.resolve()
    })
    expect(counts()).toEqual(before)

    await act(async () => page.root.unmount())
  })

  it('filters by Anthropic Messages, stacks with the type filter and restores when unchecked', async () => {
    const page = await renderModelServiceSettings({ providers: [providerWithModels(models)] })
    const rowIds = (): string[] =>
      [...page.container.querySelectorAll<HTMLElement>('[data-model-row]')]
        .map((row) => row.getAttribute('data-model-row') ?? '')

    expect(rowIds().sort()).toEqual(['claude-only', 'embedding-only', 'gemini-only', 'plain-chat'])

    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('[data-model-protocol-tab="messages"]')?.click()
      await Promise.resolve()
    })
    expect(rowIds()).toEqual(['claude-only'])

    // 取消选中 = 不按协议过滤。
    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('[data-model-protocol-tab="messages"]')?.click()
      await Promise.resolve()
    })
    expect(rowIds()).toHaveLength(4)

    // 类型 + 协议叠加（AND）：文本 + Gemini 原生。
    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('[data-model-type-tab="text"]')?.click()
      page.container.querySelector<HTMLButtonElement>('[data-model-protocol-tab="gemini"]')?.click()
      await Promise.resolve()
    })
    expect(rowIds()).toEqual(['gemini-only'])

    // 换成「嵌入」类型后与 Gemini 无交集。
    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('[data-model-type-tab="embedding"]')?.click()
      await Promise.resolve()
    })
    expect(page.container.querySelectorAll('[data-model-row]')).toHaveLength(0)

    await act(async () => page.root.unmount())
  })
})

describe('R5 API Key 是普通输入框 + 框内自绘眼睛', () => {
  it('renders a plain text input with the masked preview and a custom eye', async () => {
    const page = await renderModelServiceSettings({ language: 'zh-CN' })

    const wrapper = page.container.querySelector<HTMLElement>('.provider-api-key-input')
    const input = wrapper?.querySelector('input')
    expect(wrapper).not.toBeNull()
    expect(wrapper?.className).toContain('ant-input-affix-wrapper')
    expect(wrapper?.className).not.toContain('ant-input-password')
    expect(input?.type).toBe('text')
    expect(input?.value).toBe('sk-s**********7890')
    // 眼睛是输入框 suffix 里的自绘按钮；没有额外的自绘边框容器。
    expect(page.container.querySelector('.provider-api-key-eye')).not.toBeNull()
    expect(page.container.querySelector('.provider-api-key-control')).toBeNull()

    // 高度/边框全部交给主题 token，CSS 里没有为 Key 框单独写的边框规则。
    expect(css).not.toContain('.provider-api-key-control')
    // 单行按钮与输入框同高（同一变量）。
    expect(rule('.model-service-pill')).toMatch(/height:\s*var\(--control-h\)/)

    // 根因回归：全局 min-height 绝不能落在 `.ant-input` **本体**上（affix 包裹层会被撑到 44px，
    // 这正是「API Key 比地址框高 / 眼睛处边框缺口」的成因）。只允许给包裹层/选择器兜底。
    const minHeightSelectors = [...css.matchAll(/([^{}]+)\{[^}]*min-height[^}]*\}/g)]
      .flatMap((match) => match[1].split(','))
      .map((selector) => selector.trim())
      .filter((selector) => selector === '.ant-input')
    expect(minHeightSelectors).toEqual([])
    const affixBlock = [...css.matchAll(/([^{}]+)\{[^}]*min-height:\s*var\(--control-h\)[^}]*\}/g)]
      .map((match) => match[1])
      .join('|')
    expect(affixBlock).toContain('.ant-input-affix-wrapper')

    await act(async () => page.root.unmount())
  })

  it('reveals through exactly one IPC call when the custom eye is clicked', async () => {
    const page = await renderModelServiceSettings()

    expect(page.api.revealApiKey).not.toHaveBeenCalled()
    await act(async () => {
      page.container.querySelector<HTMLElement>('.provider-api-key-eye')?.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(page.api.revealApiKey).toHaveBeenCalledTimes(1))
    expect(page.api.revealApiKey).toHaveBeenCalledWith('silicon')
    await vi.waitFor(() => {
      expect(page.container.querySelector<HTMLInputElement>('.provider-api-key-input input')?.value)
        .toBe(apiKeyFixture)
    })

    await act(async () => page.root.unmount())
  })
})

describe('R2 品牌块压成一行（≤48px）', () => {
  it('keeps the brand row under 48px and shows name, meta, console and switch', async () => {
    const page = await renderModelServiceSettings({ language: 'zh-CN' })

    const brand = page.container.querySelector('[data-model-service-brand]')
    expect(brand).not.toBeNull()
    expect(brand?.querySelector('.model-service-title')?.textContent).toBe('硅基流动')
    const meta = brand?.querySelector('[data-provider-source]')?.textContent ?? ''
    expect(meta).toContain('api.siliconflow.cn')
    expect(meta).toContain(zhLabels.providerCategories.relay)
    // 模型数量与可达性不在这行重复（分别在「模型 N」与「需代理」徽章里）。
    expect(meta).not.toContain('个模型')
    expect(brand?.querySelector('[data-provider-console]')).not.toBeNull()
    expect(brand?.querySelector('[data-provider-switch]')).not.toBeNull()
    expect(brand?.querySelector('[data-provider-more]')).not.toBeNull()

    const brandRule = rule('.model-service-brand')
    expect(px(brandRule, 'height')).toBeLessThanOrEqual(48)
    expect(px(brandRule, 'min-height')).toBeLessThanOrEqual(48)
    expect(px(brandRule, 'max-height')).toBeLessThanOrEqual(48)

    await act(async () => page.root.unmount())
  })

  it('moves destructive actions into the ⋯ menu', async () => {
    const page = await renderModelServiceSettings({ provider: { id: 'custom', name: 'Custom', isSystem: false } })

    // 页面上不再有常驻的删除按钮。
    expect(page.container.querySelector('[data-remove-provider]')).toBeNull()
    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('[data-provider-more]')?.click()
      await Promise.resolve()
    })
    const item = page.container.querySelector<HTMLButtonElement>('[data-remove-provider]')
    expect(item).not.toBeNull()
    expect(item?.disabled).toBe(false)
    expect(item?.textContent).toContain(labels.removeProvider)

    await act(async () => page.root.unmount())
  })
})

describe('全局：整页只有 2 个滚动容器', () => {
  it('has exactly the rail list and the right column as vertical scrollers', () => {
    // 只看模型服务页自己的规则（抽屉在 portal 里，不计入页面子树）。
    const blocks = [...css.matchAll(/([^{}]+)\{[^}]*\}/g)]
      .filter((match) => /overflow-y:\s*(auto|scroll)/.test(match[0]))
      .map((match) => match[1].trim())
      .filter((selector) => selector.split(',').some((part) => part.trim().startsWith('.model-service-')))
    expect(blocks).toEqual(['.model-service-rail-list', '.model-service-detail'])
    // 模型列表容器不滚动、不裁切。
    expect(rule('.model-service-models')).toMatch(/overflow:\s*visible/)
    const groupRules = [...css.matchAll(/\n\.model-service-groups[^{]*\{[^}]*\}/g)].map((match) => match[0]).join('\n')
    expect(groupRules).toMatch(/overflow:\s*visible/)
    expect(groupRules).not.toMatch(/overflow-y:\s*(auto|scroll)/)
  })
})

describe('左栏「＋ 添加」固定在栏底（不再叠在列表项上）', () => {
  it('puts the button after the list in DOM order, non-positioned and non-shrinking', async () => {
    const page = await renderModelServiceSettings()

    const rail = page.container.querySelector<HTMLElement>('[data-model-provider-rail]')
    const list = rail?.querySelector<HTMLElement>('.model-service-rail-list')
    const add = rail?.querySelector<HTMLElement>('[data-provider-add]')
    expect(list).not.toBeNull()
    expect(add).not.toBeNull()
    // DOM 顺序：列表 → 按钮（按钮是列表的后一个兄弟）。
    expect(list?.nextElementSibling).toBe(add)

    // CSS：左栏不滚、列表滚、按钮固定高度且不参与伸缩；按钮不是绝对/浮动定位。
    expect(rule('.model-service-rail')).toMatch(/overflow:\s*hidden/)
    expect(rule('.model-service-rail')).toMatch(/display:\s*flex/)
    expect(rule('.model-service-rail')).toMatch(/flex-direction:\s*column/)
    const listRule = rule('.model-service-rail-list')
    expect(listRule).toMatch(/flex:\s*1/)
    expect(listRule).toMatch(/min-height:\s*0/)
    expect(listRule).toMatch(/overflow-y:\s*auto/)
    expect(listRule).toMatch(/padding-bottom:\s*8px/)
    const addRule = rule('.model-service-rail-add')
    expect(addRule).toMatch(/flex:\s*none/)
    expect(px(addRule, 'height')).toBe(40)
    expect(addRule).toMatch(/margin-top:\s*6px/)
    expect(addRule).toMatch(/border-top:\s*1px solid var\(--border\)/)
    expect(addRule).not.toMatch(/position:\s*(absolute|fixed|sticky)/)
    expect(addRule).not.toMatch(/float:/)
    expect(addRule).not.toMatch(/border-radius/)

    await act(async () => page.root.unmount())
  })
})
