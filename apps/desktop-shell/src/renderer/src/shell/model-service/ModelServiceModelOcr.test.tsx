// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'

import { ModelServiceModelRow } from './ModelServiceModelRow'
import {
  buildModelTypeCounts,
  matchesModelType,
  ModelServiceModelTypeFilter
} from './ModelServiceModelTypeFilter'

const labels = platformText['en-US'].models

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

const ocrModel: ModelDefinition = {
  id: 'deepseek-ai/DeepSeek-OCR',
  name: 'DeepSeek-OCR',
  capabilities: { chat: true, vision: true, ocr: true }
}

const chatModel: ModelDefinition = {
  id: 'deepseek-v3.2',
  name: 'DeepSeek V3.2',
  capabilities: { chat: true }
}

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(element))
  return container
}

describe('OCR as a first-class model type', () => {
  it('renders the ocr chip while the model stays chat-capable', async () => {
    const container = await mount(createElement(ModelServiceModelRow, {
      labels,
      providerId: 'acme',
      model: ocrModel,
      isRemovingModel: false,
      onEditModel: () => undefined,
      onRemoveModel: async () => true
    }))

    expect(container.querySelector('[data-model-chip="ocr"]')).not.toBeNull()
    // OCR 模型的输入是图片：vision 不能缺失。
    expect(container.querySelector('[data-model-chip="vision"]')).not.toBeNull()
    // 模型行本来就没有 chat chip（聊天由类型 pill 的 Text 表达），这里钉住既有约定。
    expect(container.querySelector('[data-model-chip="chat"]')).toBeNull()
  })

  it('counts OCR under All and matches it in the OCR type pill', async () => {
    const models = [ocrModel, chatModel]
    const counts = buildModelTypeCounts(models)

    expect(counts.all).toBe(2)
    expect(counts.ocr).toBe(1)
    // OCR 模型仍可聊天：Text pill 也算它一份。
    expect(counts.text).toBe(2)
    expect(matchesModelType(ocrModel, 'ocr')).toBe(true)
    expect(matchesModelType(chatModel, 'ocr')).toBe(false)

    const container = await mount(createElement(ModelServiceModelTypeFilter, {
      labels,
      active: 'all',
      counts,
      onChange: () => undefined
    }))

    const ocrPill = container.querySelector<HTMLElement>('[data-model-type-tab="ocr"]')
    expect(ocrPill).not.toBeNull()
    expect(ocrPill?.textContent).toBe(`${labels.typeOcr}1`)
    expect(labels.typeOcr).toBe('OCR')
  })
})
