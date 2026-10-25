// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { modelAvailabilityFingerprint } from '@platform/ai/providers/modelAvailability'

import { platformText } from '../../../i18n/platformText'
import { ModelPicker } from './ModelPicker'
import type { ModelPickerCandidate } from './modelPickerOptions'

/**
 * 标准化模型选择器：触发器布局 + 面板（分组/搜索/分类/协议/空态/底部跳转）。
 * 数据层规则由 `modelPickerOptions.test.ts` 覆盖，这里只断言可见性与接线。
 */
const labels = platformText['en-US'].models
const zhLabels = platformText['zh-CN'].models

function provider(
  id: string,
  name: string,
  protocol: SafeModelProvider['endpoints'][number]['protocol'],
  models: ModelDefinition[]
): SafeModelProvider {
  return {
    id,
    name,
    endpoints: [{ protocol, baseUrl: `https://${id}.example.test` }],
    enabled: true,
    baseUrl: `https://${id}.example.test`,
    hasApiKey: true,
    apiKeyPreview: 'sk-**********test',
    isSystem: false,
    models
  }
}

const silicon = provider('silicon', 'SiliconCloud', 'chat-completions', [
  { id: 'deepseek-v3', name: 'DeepSeek V3', capabilities: { chat: true, tools: true }, pricing: { currency: 'USD', promptPerMillion: 0, completionPerMillion: 0 } },
  { id: 'alpha-lite', name: 'Qwen 2.5 7B', capabilities: { chat: true, vision: true } }
])
const beta = provider('beta', 'Beta Lab', 'messages', [
  { id: 'beta-msg', name: 'Beta Messages', capabilities: { chat: true }, chatProtocol: 'messages' },
  { id: 'beta-retired', name: 'Beta Retired', capabilities: { chat: true }, chatProtocol: 'messages', probeReason: 'model_retired' }
])

const providers = [silicon, beta]
const candidates: ModelPickerCandidate[] = [
  { providerId: 'silicon', model: silicon.models[0] },
  { providerId: 'silicon', model: silicon.models[1] },
  { providerId: 'beta', model: beta.models[0] }
]

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

/** 供应商展示名走 i18n（`resolveProviderDisplayName`），不收录的品牌回退持久化 name。 */
function providerDisplayName(providerId: string): string {
  const entry = providers.find((item) => item.id === providerId)
  return labels.providerNames[providerId] ?? entry?.name ?? providerId
}

function markup(value: string | null): string {
  return renderToStaticMarkup(
    createElement(ModelPicker, {
      value,
      onChange: () => undefined,
      models: candidates,
      providers,
      labels
    })
  )
}

describe('ModelPicker trigger', () => {
  it('shows the provider logo, the model name, the provider name and a chevron when a model is selected', () => {
    const output = markup('silicon:deepseek-v3')

    expect(output).toContain('<img')
    expect(output).toContain('model-picker-trigger-logo')
    expect(output).toContain('DeepSeek V3')
    expect(output).toContain(providerDisplayName('silicon'))
    expect(output).toContain('lucide-chevron-down')
    // 省略号只裁显示：tooltip 给出完整 `providerId:modelId`。
    expect(output).toContain('title="DeepSeek V3 · SiliconFlow · silicon:deepseek-v3"')
  })

  it('shows only the placeholder without a logo when nothing is selected', () => {
    const output = markup(null)

    expect(output).not.toContain('<img')
    expect(output).toContain(labels.pickerSelectModel)
    expect(output).toContain('lucide-chevron-down')
  })

  it('keeps a saved value that is no longer offered (retired) visible in the trigger', () => {
    const output = markup('beta:beta-retired')

    expect(output).toContain('Beta Retired')
    expect(output).toContain('Beta Lab')
  })

  it('shows the availability verdict right after the selected model', () => {
    const models: ModelDefinition[] = [
      { id: 'ok', name: 'Available Model', capabilities: { chat: true } },
      { id: 'bad', name: 'Failed Model', capabilities: { chat: true } },
      { id: 'pending', name: 'Pending Model', capabilities: { chat: true } }
    ]
    const base = provider('gamma', 'Gamma', 'chat-completions', models)
    const config = { endpoints: base.endpoints, apiKeyPreview: base.apiKeyPreview }
    const withVerdict: SafeModelProvider = {
      ...base,
      models: models.map((model) => {
        if (model.id === 'pending') return model
        return {
          ...model,
          availability: {
            status: model.id === 'ok' ? 'ok' as const : 'failed' as const,
            ...(model.id === 'bad' ? { reasonCode: 'http_401' } : {}),
            checkedAt: '2026-10-25T05:00:00.000Z',
            fingerprint: modelAvailabilityFingerprint(config, model)
          }
        }
      })
    }
    const render = (value: string): string => renderToStaticMarkup(
      createElement(ModelPicker, {
        value,
        onChange: () => undefined,
        models: withVerdict.models.map((model) => ({ providerId: 'gamma', model })),
        providers: [withVerdict],
        labels
      })
    )

    const available = render('gamma:ok')
    expect(available).toContain('data-model-availability-icon="ok"')
    expect(available).toContain('is-ok')

    const failed = render('gamma:bad')
    expect(failed).toContain('data-model-availability-icon="failed"')
    expect(failed).toContain(labels.probeReasonAuth)

    expect(render('gamma:pending')).toContain('data-model-availability-icon="pending"')
    expect(markup('silicon:deepseek-v3')).toContain('data-model-availability-icon="pending"')
  })
})

describe('ModelPicker trigger styles', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

  function rule(selector: string): string {
    const start = css.indexOf(`\n${selector} {`)
    if (start < 0) throw new Error(`missing rule ${selector}`)
    return css.slice(start + 1, css.indexOf('}', start))
  }

  it('is a 32px tall 8px-radius control, not a pill', () => {
    const trigger = rule('.model-picker-trigger')
    expect(trigger).toMatch(/height:\s*var\(--control-h\)/)
    expect(trigger).toMatch(/border-radius:\s*8px/)
    expect(trigger).toMatch(/border:\s*1px solid var\(--border-strong\)/)
    expect(trigger).toMatch(/padding:\s*0 10px/)
    expect(trigger).toMatch(/min-width:\s*260px/)
    expect(trigger).toMatch(/max-width:\s*420px/)
    expect(rule('.model-picker-trigger-name')).toMatch(/font-size:\s*12px/)
    expect(rule('.model-picker-trigger-provider')).toMatch(/font-size:\s*11px/)
    expect(css).toMatch(/--control-h:\s*32px/)
  })

  it('darkens the border on hover and uses the accent border on focus without glow', () => {
    expect(rule('.model-picker-trigger:hover:not(:disabled)')).toMatch(/var\(--muted-strong\)/)
    const focus = rule('.model-picker-trigger:focus-visible')
    expect(focus).toMatch(/var\(--accent\)/)
    expect(focus).not.toMatch(/box-shadow:\s*0 0/) 
  })

  it('truncates the model name with an ellipsis and keeps the chevron', () => {
    expect(rule('.model-picker-trigger-name')).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('.model-picker-trigger-provider')).toMatch(/text-overflow:\s*ellipsis/)
  })

  it('keeps the panel list compact, scrollable and pinned to the footer', () => {
    expect(rule('.model-picker-panel')).toMatch(/max-height:\s*360px/)
    expect(rule('.model-picker-list')).toMatch(/overflow-y:\s*auto/)
    expect(rule('.model-picker-footer')).toMatch(/flex:\s*none/)
    expect(rule('.model-picker-option')).toMatch(/height:\s*34px/)
    expect(rule('.model-picker-option')).toMatch(/padding:\s*0 10px/)
    expect(rule('.model-picker-option')).toMatch(/gap:\s*8px/)
    expect(rule('.model-picker-option')).toMatch(/font-size:\s*12px/)
    expect(rule('.model-picker-option-name')).toMatch(/font-size:\s*12px/)
    expect(rule('.model-picker-option small')).toMatch(/font-size:\s*11px/)
    expect(rule('.model-picker-group header')).toMatch(/font-size:\s*12px/)
    expect(rule('.model-picker-group header')).toMatch(/color:\s*var\(--muted\)/)
  })
})

async function mountPicker(props: Partial<Parameters<typeof ModelPicker>[0]> = {}): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ModelPicker, {
      value: null,
      onChange: () => undefined,
      models: candidates,
      providers,
      labels,
      ...props
    }))
  })
  return container
}

describe('ModelPicker placeholder', () => {
  it('shows the caller placeholder instead of the generic label when nothing is selected', async () => {
    const container = await mountPicker({ value: null, placeholder: 'Following default: SiliconCloud / DeepSeek V3' })

    expect(container.querySelector('[data-model-picker-name]')?.textContent).toBe(
      'Following default: SiliconCloud / DeepSeek V3'
    )
    expect(container.querySelector('[data-model-picker-trigger]')?.getAttribute('data-selected')).toBe('false')
  })

  it('keeps the generic label when no placeholder is given', async () => {
    const container = await mountPicker({ value: null })

    expect(container.querySelector('[data-model-picker-name]')?.textContent).toBe(labels.pickerSelectModel)
  })
})

async function openPanel(container: HTMLElement): Promise<void> {
  const trigger = container.querySelector<HTMLElement>('[data-model-picker-trigger]')
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-model-picker-panel]')
}

function optionValues(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-model-picker-option]')]
    .map((option) => option.getAttribute('data-model-picker-option') ?? '')
}

function typeSearch(value: string): void {
  const input = document.querySelector<HTMLInputElement>('[data-model-picker-search] input')
  if (!input) throw new Error('missing search input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ModelPicker panel', () => {
  it('groups models by provider display name and hides retired models', async () => {
    const container = await mountPicker()
    await openPanel(container)

    expect(panel()).not.toBeNull()
    const groupLabels = [...document.querySelectorAll<HTMLElement>('[data-model-picker-group]')]
      .map((group) => group.querySelector('header')?.textContent)
    expect(groupLabels).toEqual([providerDisplayName('silicon'), 'Beta Lab'])
    expect(optionValues()).not.toContain('beta:beta-retired')
    expect(optionValues()).toHaveLength(3)
  })

  it('tags discounted and free options before the model name', async () => {
    const priced = provider('priced', 'Priced Cloud', 'chat-completions', [
      {
        id: 'deal-model',
        name: 'Deal Model',
        capabilities: { chat: true },
        pricing: { currency: 'USD', promptPerMillion: 8, completionPerMillion: 28, hasDiscount: true }
      },
      { id: 'free-model', name: 'Free Model', capabilities: { chat: true }, freeOverride: true },
      {
        id: 'paid-model',
        name: 'Paid Model',
        capabilities: { chat: true },
        pricing: { currency: 'USD', promptPerMillion: 8, completionPerMillion: 28 }
      }
    ])
    const container = await mountPicker({
      models: priced.models.map((model) => ({ providerId: 'priced', model })),
      providers: [priced]
    })
    await openPanel(container)

    const tagOf = (value: string): string | null | undefined =>
      document.querySelector<HTMLElement>(
        `[data-model-picker-option="${value}"] [data-model-picker-price-tag]`
      )?.textContent
    expect(tagOf('priced:deal-model')).toBe(labels.pickerTagDiscount)
    expect(tagOf('priced:free-model')).toBe(labels.modelFreeTag)
    expect(tagOf('priced:paid-model')).toBeUndefined()
    expect(document.querySelector('[data-model-picker-category="deal"]')?.textContent)
      .toContain(labels.pickerCategoryDeal)
  })

  it('finds DeepSeek-V3 from a compact keyword', async () => {
    const container = await mountPicker()
    await openPanel(container)
    await act(async () => {
      typeSearch('dsv3')
      await Promise.resolve()
    })

    expect(optionValues()).toEqual(['silicon:deepseek-v3'])
  })

  it('filters by category and protocol chips', async () => {
    const container = await mountPicker({ constraints: { showProtocolFilter: true } })
    await openPanel(container)

    await act(async () => {
      document.querySelector<HTMLElement>('[data-model-picker-category="tools"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })
    expect(optionValues()).toEqual(['silicon:deepseek-v3'])

    await act(async () => {
      document.querySelector<HTMLElement>('[data-model-picker-category="tools"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      document.querySelector<HTMLElement>('[data-model-picker-protocol="messages"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })
    expect(optionValues()).toEqual(['beta:beta-msg'])
  })

  it('shows the two empty states', async () => {
    const emptyContainer = await mountPicker({ models: [] })
    await openPanel(emptyContainer)
    expect(document.querySelector('[data-model-picker-empty]')?.textContent).toBe(labels.pickerEmptyNoModels)
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    const container = await mountPicker()
    await openPanel(container)
    await act(async () => {
      typeSearch('zzz')
      await Promise.resolve()
    })
    expect(document.querySelector('[data-model-picker-empty]')?.textContent).toBe(labels.pickerEmptyNoMatch)
  })

  it('explains the empty state from the call-site constraints', async () => {
    const chatOnly = provider('only-chat', 'Only Chat', 'chat-completions', [
      { id: 'only-chat-1', name: 'Only Chat', capabilities: { chat: true } }
    ])
    const chatCandidates: ModelPickerCandidate[] = [
      { providerId: 'only-chat', model: chatOnly.models[0] }
    ]

    const agentContainer = await mountPicker({
      pickerId: 'empty-agent',
      models: chatCandidates,
      providers: [chatOnly],
      constraints: { requireCapabilities: ['chat'], protocols: ['messages'] }
    })
    await openPanel(agentContainer)
    expect(document.querySelector('[data-model-picker-empty]')?.textContent)
      .toContain(labels.pickerEmptyNoMessages)
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    const imageContainer = await mountPicker({
      pickerId: 'empty-image',
      models: chatCandidates,
      providers: [chatOnly],
      constraints: { requireCapabilities: ['imageGeneration'], showProtocolFilter: false }
    })
    await openPanel(imageContainer)
    expect(document.querySelector('[data-model-picker-empty]')?.textContent)
      .toContain(labels.pickerEmptyNoImage)
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    const genericContainer = await mountPicker({ pickerId: 'empty-generic', models: [] })
    await openPanel(genericContainer)
    expect(document.querySelector('[data-model-picker-empty]')?.textContent)
      .toBe(labels.pickerEmptyNoModels)
  })

  it('keeps the stale-value notice next to the agent empty state', async () => {
    const chatOnly = provider('only-chat', 'Only Chat', 'chat-completions', [
      { id: 'only-chat-1', name: 'Only Chat', capabilities: { chat: true } }
    ])
    const container = await mountPicker({
      pickerId: 'empty-agent-with-stale',
      value: 'only-chat:only-chat-1',
      models: [{ providerId: 'only-chat', model: chatOnly.models[0] }],
      providers: [chatOnly],
      constraints: { requireCapabilities: ['chat'], protocols: ['messages'] }
    })
    await openPanel(container)

    expect(document.querySelector('[data-model-picker-notice]')?.textContent)
      .toBe(labels.pickerMessagesHint('Only Chat'))
    expect(document.querySelector('[data-model-picker-empty]')?.textContent)
      .toContain(labels.pickerEmptyNoMessages)
    expect(document.querySelector('[data-model-picker-footer]')).not.toBeNull()
  })

  it('offers one-click filter clearing when filters empty the list', async () => {
    const container = await mountPicker({ pickerId: 'empty-filtered' })
    await openPanel(container)
    await act(async () => {
      document.querySelector<HTMLElement>('[data-model-picker-category="tools"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      document.querySelector<HTMLElement>('[data-model-picker-category="deal"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      document.querySelector<HTMLElement>('[data-model-picker-protocol="gemini"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })

    expect(document.querySelector('[data-model-picker-empty]')?.textContent).toContain(labels.pickerEmptyNoMatch)
    await act(async () => {
      document.querySelector<HTMLElement>('[data-model-picker-empty-clear]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })
    expect(optionValues()).toHaveLength(3)
  })

  it('warns when the saved value belongs to a disabled provider', async () => {
    const stopped = { ...beta, enabled: false }
    const container = await mountPicker({
      pickerId: 'disabled-provider',
      value: 'beta:beta-msg',
      providers: [silicon, stopped]
    })
    await openPanel(container)

    expect(document.querySelector('[data-model-picker-notice]')?.textContent)
      .toBe(labels.pickerProviderDisabledHint('Beta Messages'))
    // 已停用厂商的模型不出现在候选里。
    expect(optionValues()).not.toContain('beta:beta-msg')
  })

  it('warns about a saved value that the constraints no longer allow instead of clearing it', async () => {
    const container = await mountPicker({
      value: 'beta:beta-retired',
      constraints: { requireCapabilities: ['chat'], protocols: ['messages'] }
    })
    await openPanel(container)

    expect(document.querySelector('[data-model-picker-notice]')?.textContent)
      .toBe(labels.pickerMessagesHint('Beta Retired'))
  })

  it('calls onChange with providerId:modelId and closes', async () => {
    const onChange = vi.fn()
    const container = await mountPicker({ onChange })
    await openPanel(container)

    await act(async () => {
      document.querySelector<HTMLElement>('[data-model-picker-option="beta:beta-msg"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })
    expect(onChange).toHaveBeenCalledWith('beta:beta-msg')
    // 关闭态由触发器声明（antd 的销毁动画在 happy-dom 里不会跑完）。
    expect(container.querySelector('[data-model-picker-trigger]')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the filter chips collapsed by default and toggles them from the funnel', async () => {
    const container = await mountPicker({ pickerId: 'toggle-default' })
    await openPanel(container)
    const filters = (): HTMLElement | null =>
      document.querySelector<HTMLElement>('[data-model-picker-filters]')

    expect(filters()?.style.display).toBe('none')

    await act(async () => {
      document.querySelector<HTMLElement>('[data-model-picker-filter-toggle]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })
    expect(filters()?.style.display).toBe('flex')

    await act(async () => {
      document.querySelector<HTMLElement>('[data-model-picker-filter-toggle]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })
    expect(filters()?.style.display).toBe('none')
  })

  it('remembers the filter panel state for the same call site only', async () => {
    const container = await mountPicker({ pickerId: 'memory-a', models: [] })
    await openPanel(container)
    await act(async () => {
      document.querySelector<HTMLElement>('[data-model-picker-filter-toggle]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })
    await act(async () => {
      container.querySelector<HTMLElement>('[data-model-picker-trigger]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })
    await openPanel(container)
    expect(document.querySelector<HTMLElement>('[data-model-picker-filters]')?.style.display).toBe('flex')
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    // 另一个调用点保持默认收起。
    const other = await mountPicker({ pickerId: 'memory-b' })
    await openPanel(other)
    expect(document.querySelector<HTMLElement>('[data-model-picker-filters]')?.style.display).toBe('none')
  })

  it('highlights the funnel and summarises the filtered count while filters are active and collapsed', async () => {
    const container = await mountPicker({ pickerId: 'summary' })
    await openPanel(container)

    await act(async () => {
      document.querySelector<HTMLElement>('[data-model-picker-category="tools"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })

    expect(document.querySelector('[data-model-picker-filter-toggle]')?.getAttribute('data-active')).toBe('true')
    expect(document.querySelector('[data-model-picker-filter-dot]')).not.toBeNull()
    expect(document.querySelector('[data-model-picker-filter-summary]')?.textContent)
      .toBe(labels.pickerFilteredCount(1))
    expect(document.querySelector<HTMLElement>('[data-model-picker-filters]')?.style.display).toBe('none')

    await act(async () => {
      document.querySelector<HTMLElement>('[data-model-picker-clear-filters]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })
    expect(document.querySelector('[data-model-picker-filter-toggle]')?.getAttribute('data-active')).toBe('false')
    expect(document.querySelector('[data-model-picker-filter-summary]')).toBeNull()
    expect(optionValues()).toHaveLength(3)
  })

  it('navigates to Settings → Model service from the footer, without provider parameters', async () => {
    const events: CustomEvent[] = []
    const listener = (event: Event): void => {
      events.push(event as CustomEvent)
    }
    window.addEventListener('app-shell:navigate', listener)
    const container = await mountPicker()
    await openPanel(container)

    await act(async () => {
      document.querySelector<HTMLElement>('[data-model-picker-footer]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })
    window.removeEventListener('app-shell:navigate', listener)

    expect(document.querySelector('[data-model-picker-footer]')?.textContent).toBe(labels.pickerConfigureCustomModel)
    expect(events).toHaveLength(1)
    expect(events[0].detail).toEqual({ navKey: 'settings', settingsPanelKey: 'models' })
  })

  it('uses the Chinese provider display name', async () => {
    const container = await mountPicker({ labels: zhLabels })
    await openPanel(container)

    const groupLabels = [...document.querySelectorAll<HTMLElement>('[data-model-picker-group]')]
      .map((group) => group.querySelector('header')?.textContent)
    expect(groupLabels).toEqual([zhLabels.providerNames.silicon ?? 'SiliconCloud', 'Beta Lab'])
  })
})
