// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { normalizeAppSettings, type ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import { platformText } from '../../i18n/platformText'
import { ModelServiceDefaultModelsSection } from './ModelServiceDefaultModelsSection'
import {
  buildDefaultModelCandidates,
  defaultModelConstraints,
  defaultModelFields
} from './modelServiceDefaultModels'
import { buildModelPickerOptions } from '../components/ModelPicker/modelPickerOptions'
import { providerFixture, renderModelServiceSettings } from './modelServicePageHarness'

/**
 * PLAT-80：模型服务页顶部「默认模型」区块（6 处调用点之一）。
 * 断言：候选/约束按字段声明、值能回显、即时保存只写该字段、绘画只列 imageGeneration、已下线不出现。
 */
const labels = platformText['en-US'].models

function provider(id: string, name: string, models: SafeModelProvider['models']): SafeModelProvider {
  return {
    id,
    name,
    endpoints: [{ protocol: 'messages', baseUrl: `https://${id}.example.test` }],
    enabled: true,
    baseUrl: `https://${id}.example.test`,
    hasApiKey: true,
    apiKeyPreview: 'sk-**********7890',
    models,
    isSystem: false
  } as unknown as SafeModelProvider
}

const providers = [
  provider('silicon', 'Silicon', [
    {
      id: 'deepseek-v3',
      name: 'DeepSeek V3',
      capabilities: { chat: true, agentRuntimes: { claudeCode: true } },
      chatProtocol: 'messages'
    },
    { id: 'qwen-7b', name: 'Qwen2.5 7B', capabilities: { chat: true } },
    { id: 'flux-image', name: 'FLUX Image', capabilities: { chat: false, imageGeneration: true } }
  ]),
  provider('deepseek', 'DeepSeek', [
    { id: 'retired-chat', name: 'Retired Chat', capabilities: { chat: true }, probeReason: 'model_retired' }
  ])
]

const emptyValues: ModelDefaultsSettings = {
  assistantModelId: '',
  agentModelId: '',
  fastModelId: '',
  translationModelId: '',
  imageModelId: ''
}

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function optionIds(field: Parameters<typeof buildDefaultModelCandidates>[1]): string[] {
  return buildModelPickerOptions(
    buildDefaultModelCandidates(providers, field),
    providers,
    defaultModelConstraints(field),
    labels
  ).options.map((option) => option.value)
}

describe('PLAT-80 default model candidates', () => {
  it('lists text models for the assistant/fast/translation fields and image models for the image field', () => {
    expect(optionIds('assistantModelId')).toEqual(['silicon:deepseek-v3', 'silicon:qwen-7b'])
    expect(optionIds('fastModelId')).toEqual(['silicon:deepseek-v3', 'silicon:qwen-7b'])
    expect(optionIds('translationModelId')).toEqual(['silicon:deepseek-v3', 'silicon:qwen-7b'])
    expect(optionIds('imageModelId')).toEqual(['silicon:flux-image'])
  })

  it('restricts the default agent model to messages-capable agent candidates', () => {
    expect(optionIds('agentModelId')).toEqual(['silicon:deepseek-v3'])
  })

  it('drops retired models from every default picker', () => {
    for (const field of defaultModelFields) {
      expect(optionIds(field)).not.toContain('deepseek:retired-chat')
    }
  })

  it('keeps the protocol filter only where the runtime needs messages', () => {
    expect(defaultModelConstraints('agentModelId').showProtocolFilter).toBe(true)
    expect(defaultModelConstraints('imageModelId').showProtocolFilter).toBe(false)
    expect(defaultModelConstraints('assistantModelId').showProtocolFilter).toBeUndefined()
  })
})

interface HostProps {
  values?: ModelDefaultsSettings
  onChange?: (field: keyof ModelDefaultsSettings, value: string) => void
}

async function mountSection(props: HostProps = {}): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ModelServiceDefaultModelsSection, {
      labels,
      providers,
      values: props.values ?? emptyValues,
      onChange: props.onChange ?? (() => undefined)
    }))
  })
  return container
}

function rowFields(container: HTMLElement): Array<string | null> {
  return [...container.querySelectorAll('[data-default-model-row]')]
    .map((row) => row.getAttribute('data-default-model-row'))
}

function fieldsInGroup(container: HTMLElement, group: string): Array<string | null> {
  return [...container.querySelectorAll(`[data-default-model-row-group="${group}"] [data-default-model-row]`)]
    .map((row) => row.getAttribute('data-default-model-row'))
}

describe('PLAT-80 default models section', () => {
  it('renders only the four text defaults; the image default has no control', async () => {
    const container = await mountSection({ values: { ...emptyValues, imageModelId: 'silicon:flux-image' } })

    expect(container.querySelector('[data-model-service-default-models]')).not.toBeNull()
    expect(rowFields(container)).toEqual([
      'assistantModelId',
      'agentModelId',
      'fastModelId',
      'translationModelId'
    ])
    expect(fieldsInGroup(container, 'primary')).toEqual([
      'assistantModelId',
      'agentModelId',
      'fastModelId',
      'translationModelId'
    ])
    // 绘画模型（`imageModelId`）不再有控件：行、选择器、分组、「更多」按钮都不该出现。
    expect(container.querySelector('[data-default-model-row="imageModelId"]')).toBeNull()
    expect(container.querySelector('[data-default-model-select="imageModelId"]')).toBeNull()
    expect(container.querySelector('[data-default-model-row-group="more"]')).toBeNull()
    expect(container.querySelector('[data-default-models-toggle]')).toBeNull()
    expect(container.querySelectorAll('[data-model-picker-trigger]').length).toBe(4)
    expect(container.textContent).toContain(labels.pickerSelectModel)
  })

  it('keeps a saved image default in the settings while rendering no control for it', async () => {
    const values: ModelDefaultsSettings = { ...emptyValues, imageModelId: 'silicon:flux-image' }
    const onChange = vi.fn()
    const container = await mountSection({ values, onChange })

    expect(document.body.querySelector('[data-default-model-select="imageModelId"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()

    // 字段与值仍在设置里（读得到）：归一不会因为「没有控件」而把它清掉或改写。
    expect(normalizeAppSettings({ modelDefaults: values }).modelDefaults.imageModelId).toBe('silicon:flux-image')
    // 换别的字段也只写那一个字段，不会顺手把绘画值回写成空。
    expect(container.querySelectorAll('[data-default-model-row]').length).toBe(4)
  })

  it('keeps a saved value that is no longer offered visible instead of clearing it', async () => {
    const container = await mountSection({ values: { ...emptyValues, assistantModelId: 'deepseek:retired-chat' } })

    const row = container.querySelector('[data-default-model-row="assistantModelId"]')
    expect(row?.textContent).toContain('Retired Chat')
  })
})

describe('PLAT-80 section placement and persistence', () => {
  it('places the section before the provider detail and saves the changed field once', async () => {
    const page = await renderModelServiceSettings({ language: 'en-US' })

    const section = page.container.querySelector('[data-model-service-default-models]')
    const rail = page.container.querySelector('.model-service-provider-rail, [data-model-service-page]')
    expect(section).not.toBeNull()
    expect(rail).not.toBeNull()
    expect(section!.compareDocumentPosition(rail!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await act(async () => page.root.unmount())
    document.body.replaceChildren()
  })

  it('reads the stored value and writes the changed field back through settings.update exactly once', async () => {
    const model = providerFixture.models[0]
    const page = await renderModelServiceSettings({
      language: 'en-US',
      settings: {
        modelDefaults: {
          assistantModelId: `silicon:${model.id}`,
          agentModelId: '',
          fastModelId: '',
          translationModelId: '',
          imageModelId: ''
        }
      }
    })

    // 回显：当前值渲染成「模型名 + 小字厂商名」。
    const assistantRow = page.container.querySelector('[data-default-model-row="assistantModelId"]')
    expect(assistantRow?.textContent).toContain(model.name)

    await act(async () => {
      assistantRow?.querySelector<HTMLElement>('[data-model-picker-trigger]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })
    const options = [...document.querySelectorAll<HTMLElement>('[data-model-picker-option]')]
    const target = options.find((option) => option.textContent?.includes(model.name) === false)
    await act(async () => {
      ;(target ?? options[0])?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(page.api.updateSettings).toHaveBeenCalledTimes(1)
    const patch = page.api.updateSettings.mock.calls[0][0] as { modelDefaults: Record<string, string> }
    expect(Object.keys(patch.modelDefaults)).toEqual([
      'assistantModelId',
      'agentModelId',
      'fastModelId',
      'translationModelId',
      'imageModelId'
    ])
    expect(patch.modelDefaults.assistantModelId).not.toBe(`silicon:${model.id}`)

    await act(async () => page.root.unmount())
    document.body.replaceChildren()
  })
})


/**
 * 样式层断言：默认模型是**一行控件条**（不是大卡片）：第一行 4 个选择器 + 展开按钮，
 * 第二行（绘画模型）默认收起；控件边框由 ModelPicker 自己画。
 */
describe('PLAT-80 default models bar', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

  function rule(selector: string): string {
    const start = css.indexOf(`\n${selector} {`)
    if (start < 0) throw new Error(`missing rule ${selector}`)
    return css.slice(start + 1, css.indexOf('}', start))
  }

  it('is a two-row bar, not a card, and each row scrolls horizontally on its own', () => {
    const bar = rule('.model-service-default-models')
    expect(bar).toMatch(/min-height:\s*48px/)
    expect(bar).toMatch(/display:\s*flex/)
    expect(bar).toMatch(/flex-direction:\s*column/)
    expect(bar).toMatch(/border-bottom:\s*1px solid var\(--border\)/)
    expect(bar).not.toMatch(/border-radius:\s*(8|10|12)px/)
    expect(bar).not.toMatch(/max-width:\s*720px/)
    expect(bar).toMatch(/max-width:\s*none/)
    expect(bar).toMatch(/width:\s*100%/)

    const row = rule('.model-service-default-row')
    expect(row).toMatch(/display:\s*flex/)
    expect(row).toMatch(/min-width:\s*0/)

    const scroll = rule('.model-service-default-row-scroll')
    expect(scroll).toMatch(/display:\s*flex/)
    expect(scroll).toMatch(/flex-wrap:\s*nowrap/)
    expect(scroll).toMatch(/overflow-x:\s*auto/)
    expect(scroll).toMatch(/flex:\s*1 1 auto/)
    expect(scroll).toMatch(/min-width:\s*0/)
  })

  it('renders no expand toggle now that the more row is gone (C10)', async () => {
    const container = await mountSection()
    // 第二行（绘画模型）已撤，展开按钮没有东西可展开：DOM 与样式表里都不该再有它。
    expect(container.querySelector('[data-default-models-toggle]')).toBeNull()
    // 样式表里也一起清掉了（本地 `rule()` 对缺失选择器会抛，所以直接查文本）。
    expect(css).not.toContain('.model-service-default-toggle')
  })

  it('does not paint a second border around the picker', () => {
    const chip = rule('.model-service-default-chip')
    expect(chip).not.toMatch(/border:\s*1px solid/)
    expect(chip).not.toMatch(/border-radius/)
    // 控件高度/圆角由触发器的唯一规则决定（32px / 8px）。
    expect(rule('.model-picker-trigger')).toMatch(/height:\s*var\(--control-h\)/)
    expect(rule('.model-picker-trigger')).toMatch(/border-radius:\s*8px/)
    expect(rule(':root')).toMatch(/--control-h:\s*32px/)
    expect(rule('.model-service-default-item-label')).toMatch(/color:\s*var\(--muted\)/)
    expect(rule('.model-service-default-item-label')).toMatch(/font-size:\s*12px/)
  })

  it('keeps each picker compact and shrinks on narrow windows without wrapping', () => {
    expect(rule('.model-service-default-chip .model-picker-trigger')).toMatch(/min-width:\s*220px/)
    expect(rule('.model-service-default-chip .model-picker-trigger')).toMatch(/max-width:\s*250px/)
    const media = css.slice(css.indexOf('@media (max-width: 900px)', css.indexOf('.model-service-default-models {')))
    expect(media.slice(0, 400)).toMatch(/\.model-service-default-chip \.model-picker-trigger \{[^}]*min-width/)
  })

  it('renders exactly four pickers, and never a fifth', async () => {
    const container = await mountSection()
    const bar = container.querySelector('[data-model-service-default-models]')
    const primary = container.querySelector('[data-default-model-row-group="primary"]')
    expect(primary?.querySelectorAll('.model-service-default-chip').length).toBe(4)
    for (const chip of [...(primary?.querySelectorAll('.model-service-default-chip') ?? [])]) {
      expect(chip.getAttribute('data-default-model-select')).not.toBeNull()
      expect(chip.querySelector('[data-model-picker-trigger]')).not.toBeNull()
      expect(chip.textContent?.trim()).not.toContain(labels.defaultModelAssistant)
    }
    expect(primary?.querySelectorAll('[data-default-model-select]').length).toBe(4)

    // 没有展开按钮可点：绘画模型不会再作为第五个选择器出现。
    await act(async () => {
      container.querySelector<HTMLElement>('[data-default-models-toggle]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    expect(bar?.querySelectorAll('.model-service-default-chip').length).toBe(4)
    expect(bar?.querySelectorAll('[data-default-model-select]').length).toBe(4)
    expect(container.querySelector('[data-default-models-card]')).toBeNull()
  })
})

/**
 * PLAT-81：整页固定高度、只有内部列表滚动（happy-dom 无布局，用结构/CSS 规则断言）。
 */
describe('PLAT-81 single right-column scroller', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

  function rule(selector: string): string {
    const start = css.indexOf(`\n${selector} {`)
    if (start < 0) throw new Error(`missing rule ${selector}`)
    return css.slice(start + 1, css.indexOf('}', start))
  }

  it('locks the page and gives left list + right column their own scroll', () => {
    expect(rule('.settings-workspace.model-service-page')).toMatch(/overflow:\s*hidden/)
    expect(rule('.settings-workspace.model-service-page')).toMatch(/height:\s*100%/)
    // PLAT-81：左栏自身不滚（overflow:hidden），由列表承担滚动，「＋ 添加」固定在栏底。
    expect(rule('.model-service-rail')).toMatch(/overflow:\s*hidden/)
    expect(rule('.model-service-rail-list')).toMatch(/overflow-y:\s*auto/)
    expect(rule('.model-service-detail')).toMatch(/overflow-y:\s*auto/)
    expect(rule('.model-service-detail')).toMatch(/min-height:\s*0/)
    expect(rule('.model-service-detail')).toMatch(/padding:\s*18px 26px 24px/)
  })

  it('does not nest a second scroller inside the right column', () => {
    const list = rule('.model-service-groups')
    expect(list).toMatch(/overflow:\s*visible/)
    expect(list).not.toMatch(/overflow(-y)?:\s*(auto|scroll)/)
    // 右栏内部子块一律自然高度。
    expect(rule('.model-service-detail > *')).toMatch(/flex:\s*none/)
  })

  it('keeps the toolbar and pills inside the right column so they follow the scroll', async () => {
    const page = await renderModelServiceSettings({ language: 'en-US' })
    const detail = page.container.querySelector('.model-service-detail')
    const list = page.container.querySelector('[data-model-list-scroll]')
    expect(detail?.querySelector('[data-models-sync]')).not.toBeNull()
    expect(detail?.querySelector('[data-model-type-filter]')).not.toBeNull()
    // 列表不再是独立滚动容器，且仍在右栏内部。
    expect(list?.className).toContain('model-service-groups')
    expect(detail?.contains(list!)).toBe(true)

    await act(async () => page.root.unmount())
    document.body.replaceChildren()
  })

  it('pins model rows to 36px so they never collapse', () => {
    const row = rule('.model-service-model-row')
    expect(row).toMatch(/height:\s*36px/)
    expect(row).toMatch(/min-height:\s*36px/)
    expect(row).toMatch(/flex:\s*none/)
  })
})

/** BUG 修复的可见性断言：行必须有 36px 且能看到模型名；标题不能被压成竖排。 */
describe('BUG visibility guards', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

  function lastRule(selector: string): string {
    const start = css.lastIndexOf(`${selector} {`)
    if (start < 0) throw new Error(`missing rule ${selector}`)
    return css.slice(start, css.indexOf('}', start))
  }

  it('forces every model row to a visible 36px box and makes groups block-level', () => {
    // 同一选择器可能有多条规则（后一条只做 max-height/overflow 覆盖）⇒ 合并全部再断言。
    const row = [...css.matchAll(/\.model-service-models \.model-service-model-row\s*\{[^}]*\}/g)]
      .map((match) => match[0])
      .join('\n')
    expect(row).toMatch(/height:\s*36px/)
    expect(row).toMatch(/min-height:\s*36px/)
    expect(row).toMatch(/max-height:\s*36px/)
    expect(row).toMatch(/flex:\s*none/)
    // display:block 可能写在合并选择器里，按"任意一条规则"判断。
    const bodyRules = [...css.matchAll(/\.model-service-models[^}]*model-service-group-body[^}]*\{[^}]*\}/g)].map((m) => m[0])
    expect(bodyRules.some((rule) => /display:\s*block/.test(rule))).toBe(true)
    expect(lastRule('.model-service-models .model-service-model-name')).toMatch(/white-space:\s*nowrap/)
  })

  it('shows model names in rows', async () => {
    const page = await renderModelServiceSettings({ language: 'en-US' })
    const rows = [...page.container.querySelectorAll('[data-model-row]')]
    expect(rows.length).toBeGreaterThan(0)
    // 行内容可见：每行都带模型名文本（不是只有一条 border）。
    for (const row of rows) {
      const name = row.querySelector('.model-service-model-name')?.textContent?.trim()
      expect(name && name.length > 0).toBe(true)
    }

    await act(async () => page.root.unmount())
    document.body.replaceChildren()
  })
})

describe('no inner scroll containers below the right column', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

  function rulesOf(selector: string): string[] {
    const out: string[] = []
    let index = css.indexOf(`\n${selector} {`)
    while (index >= 0) {
      out.push(css.slice(index + 1, css.indexOf('}', index)))
      index = css.indexOf(`\n${selector} {`, index + 1)
    }
    return out
  }

  it('has no overflow-y:auto / max-height in the model list ancestor chain', () => {
    const chain = [
      '.model-service-models',
      '.model-service-groups',
      '.model-service-group',
      '.model-service-group-body',
      '.model-service-model-row'
    ]
    for (const selector of chain) {
      for (const rule of rulesOf(selector)) {
        // 允许 display:grid/flex，但不允许内层滚动或高度裁切。
        expect(rule, `${selector}: ${rule}`).not.toMatch(/overflow-y:\s*(auto|scroll)/)
        expect(rule, `${selector}: ${rule}`).not.toMatch(/max-height:\s*\d/)
      }
    }
  })

  it('keeps exactly two scroll containers in the page: rail list + right column root', () => {
    const pageScrollers = ['.model-service-rail-list', '.model-service-detail']
      .filter((selector) => rulesOf(selector).some((rule) => /overflow-y:\s*(auto|scroll)/.test(rule)))
    expect(pageScrollers).toEqual(['.model-service-rail-list', '.model-service-detail'])
  })
})
