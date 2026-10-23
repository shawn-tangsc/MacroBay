// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'
import type { ModelGroup } from '../modelGrouping'

import { ModelServiceModelsSection } from './ModelServiceModelsSection'
import { resetModelDetectionControllerForTests } from './modelDetectionController'

/**
 * PLAT-82：模型区只保留**能力 chip** 与本会话检测结果；
 * 持久化的「未验证 / 已验证」与 `data-model-probe-icon` 已删除。
 */
const labels = platformText['en-US'].models

type Fixture = Pick<
  ModelDefinition,
  'id' | 'name' | 'capabilities' | 'contextLength' | 'maxCompletionTokens' | 'pricing' | 'freeOverride'
>

function model(
  id: string,
  capabilities: ModelDefinition['capabilities'],
  extra?: Partial<Pick<ModelDefinition, 'messagesSupport' | 'probeStatus' | 'probeReason'>>
): Fixture {
  return { id, name: id, capabilities, ...extra }
}

const groups: ModelGroup[] = [
  {
    name: 'Models',
    models: [
      model('BAAI/bge-m3', { chat: false, embedding: true }),
      model('Qwen2-VL-72B', { chat: true, vision: true }),
      model('deepseek-r1-0528', { chat: true, reasoning: true }),
      model('deepseek-v3.2', { chat: true }),
      model('doubao-seedream-3-0-t2i', { chat: false, imageGeneration: true }),
      model('T2V-01-Director', { chat: false, videoGeneration: true }),
      model('Doubao-tts01', { chat: false, audio: true }),
      model('tool-model', { chat: true, tools: true }),
      model('wan2.7-image', { chat: true }),
      {
        id: 'priced',
        name: 'Priced',
        capabilities: { chat: true },
        contextLength: 200000,
        pricing: { currency: 'CNY', promptPerMillion: 8, completionPerMillion: 28, cacheReadPerMillion: 2, hasDiscount: true }
      }
    ]
  },
  {
    name: 'Probed',
    models: [
      model('legacy-unsupported', { chat: true }, { messagesSupport: 'no', probeStatus: 'unsupported', probeReason: 'protocol_unsupported' }),
      model('legacy-passed', { chat: true }, { messagesSupport: 'yes', probeStatus: 'passed' }),
      model('legacy-failed', { chat: true }, { messagesSupport: 'unknown', probeStatus: 'failed', probeReason: 'timeout' })
    ]
  }
]

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  resetModelDetectionControllerForTests()
})

async function mountGroups(value: ModelGroup[] = groups): Promise<HTMLElement> {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  resetModelDetectionControllerForTests()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ModelServiceModelsSection, {
      labels,
      providerId: 'aionly',
      groups: value,
      modelCount: value.reduce((total, group) => total + group.models.length, 0),
      staleModelCount: 0,
      collapsedGroups: new Set<string>(),
      onToggleGroup: () => undefined,
      onSyncModels: () => undefined,
      onClearModels: async () => true,
      isSyncing: false,
      canSyncModels: true,
      canAddModel: true,
      onAddModel: () => undefined,
      onEditModel: () => undefined,
      onRemoveModel: async () => true,
      isRemovingModel: false,
      modelError: null,
      notice: null,
      syncErrorText: null,
      syncErrorDetail: null
    }))
  })
  return container
}

function row(container: HTMLElement, modelId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-model-row="${modelId}"]`)
}

async function clickType(container: HTMLElement, tab: string): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(`[data-model-type-tab="${tab}"]`)?.click()
    await Promise.resolve()
  })
}

function chipIds(container: HTMLElement, modelId: string): string[] {
  return [...(row(container, modelId)?.querySelectorAll('[data-model-chip]') ?? [])]
    .map((chip) => chip.getAttribute('data-model-chip') ?? '')
}

describe('PLAT-82 模型行：能力 chip + 本会话检测结果', () => {
  it('renders only the real capability chips and never a chat chip', async () => {
    const container = await mountGroups()

    expect(chipIds(container, 'BAAI/bge-m3')).toEqual(['embedding'])
    expect(chipIds(container, 'Qwen2-VL-72B')).toEqual(['vision', 'tools'])
    expect(chipIds(container, 'deepseek-r1-0528')).toEqual(['reasoning', 'tools'])
    expect(chipIds(container, 'deepseek-v3.2')).toEqual(['tools'])
    expect(chipIds(container, 'doubao-seedream-3-0-t2i')).toEqual(['imageGeneration'])
    expect(chipIds(container, 'T2V-01-Director')).toEqual(['videoGeneration'])
    expect(chipIds(container, 'Doubao-tts01')).toEqual(['speech'])
    expect(chipIds(container, 'tool-model')).toEqual(['tools'])
    const priced = row(container, 'priced')
    expect(priced?.querySelector('[data-model-cost]')?.textContent).toContain('200K · ¥8/¥28')
    expect(priced?.querySelector('[data-model-cost]')?.getAttribute('title')).toBe(
      labels.modelCostTitle('200K', '¥8', '¥28', '¥2', 'CNY')
    )
    expect(priced?.querySelector('[data-model-discount]')?.textContent).toBe(labels.modelDiscountBadge)
    expect(row(container, 'deepseek-v3.2')?.querySelector('[data-model-cost]')).toBeNull()
  })

  it('never renders the removed persisted verified/unverified markers', async () => {
    const container = await mountGroups()

    for (const id of ['legacy-passed', 'legacy-unsupported', 'legacy-failed', 'deepseek-v3.2']) {
      const entry = row(container, id)
      expect(entry?.querySelector('[data-model-probe-icon]')).toBeNull()
      expect(entry?.getAttribute('data-model-probe-status')).toBeNull()
      expect(entry?.querySelector('[data-model-detection-status]')).toBeNull()
      expect(entry?.getAttribute('data-model-protocol-failed')).toBeNull()
    }
    expect(container.textContent).not.toContain('Unverified')
  })

  it('renders the 10 model-type pills and keeps the 4 protocol pills in a separate row', async () => {
    const six: ModelGroup[] = [{
      name: 'Six',
      models: [
        model('text-model', { chat: true }),
        model('image-model', { chat: false, imageGeneration: true }),
        model('embedding-model', { chat: false, embedding: true }),
        model('audio-model', { chat: false, audio: true }),
        model('video-model', { chat: false, videoGeneration: true }),
        model('reasoning-model', { chat: false, reasoning: true }),
        model('vision-model', { chat: false, vision: true })
      ]
    }]
    const container = await mountGroups(six)
    const pills = [...container.querySelectorAll<HTMLElement>('[data-model-type-tab]')]

    expect(pills).toHaveLength(11)
    expect(pills.every((pill) => pill.querySelector('svg') !== null)).toBe(true)
    expect(pills.map((pill) => pill.textContent?.trim())).toEqual([
      `${labels.typeAll}7`,
      `${labels.typeDeal}0`,
      `${labels.typeText}3`,
      `${labels.typeRerank}0`,
      `${labels.typeEmbedding}1`,
      `${labels.typeImage}1`,
      `${labels.typeVideo}1`,
      `${labels.typeSpeech}1`,
      `${labels.typeTranscription}0`,
      `${labels.typeOcr}0`,
      `${labels.typeVision}1`
    ])
    expect(container.querySelector('[data-model-type-tab="all"]')?.getAttribute('data-active')).toBe('true')

    await clickType(container, 'vision')
    expect(container.querySelector('[data-model-type-tab="vision"]')?.getAttribute('data-active')).toBe('true')
    expect(container.querySelector('[data-model-type-tab="all"]')?.getAttribute('data-active')).toBe('false')
    expect(container.querySelectorAll('[data-model-row]')).toHaveLength(1)

    expect(container.querySelector('[data-models-runtime-advisory]')).toBeNull()
    expect(container.querySelector('[data-models-detect]')?.textContent).toBe(labels.detectModels)
  })

  it('filters free and discounted models from the pill next to 全部', async () => {
    const freeGroups: ModelGroup[] = [{
      name: 'Free',
      models: [
        {
          id: 'zero-price',
          name: 'Zero Price',
          capabilities: { chat: true },
          pricing: { currency: 'USD', promptPerMillion: 0, completionPerMillion: 0 }
        },
        {
          id: 'manual-free',
          name: 'Manual Free',
          capabilities: { chat: true },
          pricing: { currency: 'USD', promptPerMillion: 8, completionPerMillion: 28 },
          freeOverride: true
        },
        {
          id: 'discounted',
          name: 'Discounted',
          capabilities: { chat: true },
          pricing: { currency: 'USD', promptPerMillion: 8, completionPerMillion: 28, hasDiscount: true }
        },
        {
          id: 'paid',
          name: 'Paid',
          capabilities: { chat: true },
          pricing: { currency: 'USD', promptPerMillion: 8, completionPerMillion: 28 }
        }
      ]
    }]
    const container = await mountGroups(freeGroups)

    expect(container.querySelector('[data-model-type-tab="deal"]')?.textContent)
      .toContain(`${labels.typeDeal}3`)
    await clickType(container, 'deal')
    expect(container.querySelector('[data-model-type-tab="deal"]')?.getAttribute('data-active')).toBe('true')
    const rows = [...container.querySelectorAll<HTMLElement>('[data-model-row]')].map((entry) => entry.getAttribute('data-model-row'))
    expect(rows).toEqual(['zero-price', 'manual-free', 'discounted'])
  })

  it('searches by model name without any type filter', async () => {
    const container = await mountGroups()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-models-search-toggle]')?.click()
      await Promise.resolve()
    })
    const search = container.querySelector<HTMLInputElement>('[data-models-search]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'deepseek')
      search?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await clickType(container, 'text')
    const rows = [...container.querySelectorAll('[data-model-row]')].map((entry) => entry.getAttribute('data-model-row'))
    expect(rows).toEqual(['deepseek-r1-0528', 'deepseek-v3.2'])
  })

  it('opens the detection dialog from the toolbar', async () => {
    const container = await mountGroups()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-models-detect]')?.click()
      await Promise.resolve()
    })
    const dialog = document.querySelector('[data-model-detect-dialog]')
    expect(dialog).not.toBeNull()
    expect(document.body.textContent).toContain(labels.detectModelsWarning)
    expect(document.body.textContent).toContain(labels.detectModeConnectivity)
    expect(document.body.textContent).toContain(labels.detectModeProtocol)
  })

  it('keeps each model row single-line with a fixed right-side order', async () => {
    const container = await mountGroups()
    const entry = row(container, 'deepseek-v3.2')
    expect(entry).not.toBeNull()
    const children = [...(entry?.children ?? [])].map((child) => child.className)
    expect(children).toEqual([
      'model-service-model-name',
      'capability-pills',
      'model-service-model-actions'
    ])
    // 名称与右侧簇是同一行的兄弟节点；actions 不单独占行。
    expect(entry?.querySelector('.model-service-model-name + .capability-pills + .model-service-model-actions')).not.toBeNull()
    expect(entry?.querySelectorAll('[data-model-row]')).toHaveLength(0)
  })
})

describe('PLAT-79 retired models are labelled', () => {
  it('greys a retired model and shows the retired tag', async () => {
    const retired = model('retired-x', { chat: true }, {
      messagesSupport: 'no',
      probeStatus: 'failed',
      probeReason: 'model_retired'
    })
    const container = await mountGroups([{ name: 'Models', models: [retired] }])
    const entry = row(container, 'retired-x')

    expect(entry?.getAttribute('data-model-retired')).toBe('true')
    expect(entry?.querySelector('[data-model-retired-tag]')?.textContent).toBe(labels.modelRetiredTag)
  })
})
