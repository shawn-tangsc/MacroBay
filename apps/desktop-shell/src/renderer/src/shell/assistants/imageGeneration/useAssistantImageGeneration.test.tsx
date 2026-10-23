// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../../i18n/platformText'
import { useAssistantImageGeneration } from './useAssistantImageGeneration'

/**
 * T2/T3：图像生成/编辑 hook。
 * 派发时带 topicId；主进程 settle 后只做 refresh（消息是真消息），本地占位随之消失；
 * 只有「没有落成消息」的失败才留在面板里显示人话原因。
 */
const labels = platformText['en-US'].assistants
const models = platformText['en-US'].models
const failureLabels = { image: labels, reason: models }
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined

const imageProvider = {
  id: 'acme',
  name: 'Acme',
  protocol: 'openai-compatible',
  enabled: true,
  baseUrl: 'https://api.acme.test',
  hasApiKey: true,
  apiKeyPreview: 'sk-**********1234',
  imageEndpoints: {
    generation: 'https://api.acme.test/images',
    edit: 'https://api.acme.test/images'
  },
  models: [{ id: 'acme-image', name: 'Acme Image', capabilities: { chat: false, imageGeneration: true } }]
} as unknown as SafeModelProvider

const generatedRef = {
  kind: 'image',
  mime: 'image/png',
  fileName: '0123456789abcdef.png',
  byteLength: 128
}

type GenerateResponse =
  | { ok: true; messageId: string; imageCount: number }
  | { ok: false; reasonCode?: string; messageId?: string }

function installPlatform(generateImage: (input: unknown) => Promise<GenerateResponse>): ReturnType<typeof vi.fn> {
  const spy = vi.fn(generateImage)
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: { modelProviders: { generateImage: spy } }
  })
  return spy
}

type HarnessProps = {
  providers: SafeModelProvider[]
  topicId: string | null
  resolveTopicId?: () => Promise<string | null>
  onMessagesChanged?: (topicId: string) => Promise<void> | void
}

function Harness({
  providers,
  topicId,
  resolveTopicId = async () => 'topic-1',
  onMessagesChanged = () => undefined
}: HarnessProps): React.ReactElement {
  const generation = useAssistantImageGeneration({
    providers,
    labels,
    failureLabels,
    topicId,
    resolveTopicId,
    onMessagesChanged
  })
  return createElement(
    'div',
    null,
    createElement('span', {
      'data-state': true,
      'data-target': generation.target?.modelId ?? '',
      'data-edit-target': generation.editTarget?.modelId ?? '',
      'data-generating': String(generation.isGenerating),
      'data-pending': generation.pending ? generation.pending.kind : '',
      'data-error': generation.errorText ?? '',
      'data-refs': JSON.stringify([generatedRef])
    }),
    createElement('button', {
      'data-generate': true,
      onClick: () => void generation.generate({ prompt: 'a red fox', size: '512x512', count: 2 })
    }),
    createElement('button', {
      'data-generate-empty': true,
      onClick: () => void generation.generate({ prompt: '   ', size: '512x512', count: 1 })
    }),
    createElement('button', {
      'data-edit': true,
      onClick: () =>
        void generation.edit({
          prompt: 'make it blue',
          size: '512x512',
          source: { fileName: generatedRef.fileName }
        })
    }),
    createElement('button', {
      'data-edit-nosource': true,
      onClick: () =>
        void generation.edit({ prompt: 'make it blue', size: '512x512', source: undefined as never })
    })
  )
}

async function mount(props: HarnessProps): Promise<HTMLElement> {
  document.body.replaceChildren()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(Harness, props))
  })
  return container
}

function state(container: HTMLElement): {
  target: string
  editTarget: string
  generating: boolean
  pending: string
  error: string
} {
  const node = container.querySelector<HTMLElement>('[data-state]')
  if (!node) throw new Error('missing state node')
  return {
    target: node.dataset.target ?? '',
    editTarget: node.dataset.editTarget ?? '',
    generating: node.dataset.generating === 'true',
    pending: node.dataset.pending ?? '',
    error: node.dataset.error ?? ''
  }
}

async function click(container: HTMLElement, selector: string): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(selector)?.click()
    await Promise.resolve()
  })
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

describe('useAssistantImageGeneration', () => {
  it('dispatches generation with the topic and refreshes messages instead of keeping base64', async () => {
    const onMessagesChanged = vi.fn()
    const spy = installPlatform(async () => ({ ok: true, messageId: 'msg-1', imageCount: 1 }))
    const container = await mount({ providers: [imageProvider], topicId: 'topic-1', onMessagesChanged })

    expect(state(container).target).toBe('acme-image')
    expect(state(container).editTarget).toBe('acme-image')
    await click(container, '[data-generate]')

    expect(spy).toHaveBeenCalledWith({
      providerId: 'acme',
      modelId: 'acme-image',
      prompt: 'a red fox',
      size: '512x512',
      count: 2,
      topicId: 'topic-1',
      operation: 'generate'
    })
    expect(onMessagesChanged).toHaveBeenCalledWith('topic-1')
    expect(state(container)).toMatchObject({ generating: false, pending: '', error: '' })
  })

  it('shows a local pending placeholder only until the message settles', async () => {
    let settle: (() => void) | undefined
    const response = new Promise<GenerateResponse>((resolve) => {
      settle = () => resolve({ ok: true, messageId: 'msg-1', imageCount: 1 })
    })
    installPlatform(() => response)
    const container = await mount({ providers: [imageProvider], topicId: 'topic-1' })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-generate]')?.click()
      await Promise.resolve()
    })
    expect(state(container)).toMatchObject({ generating: true, pending: 'generate' })

    await act(async () => {
      settle?.()
      await response
    })
    expect(state(container)).toMatchObject({ generating: false, pending: '' })
  })

  it('creates a topic before dispatching when none is selected', async () => {
    const onMessagesChanged = vi.fn()
    const spy = installPlatform(async () => ({ ok: true, messageId: 'msg-1', imageCount: 1 }))
    const resolveTopicId = vi.fn(async () => 'topic-new')
    const container = await mount({ providers: [imageProvider], topicId: null, resolveTopicId, onMessagesChanged })

    await click(container, '[data-generate]')

    expect(resolveTopicId).toHaveBeenCalled()
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ topicId: 'topic-new' }))
    expect(onMessagesChanged).toHaveBeenCalledWith('topic-new')
  })

  it('keeps the human failure in the panel only when no message was written', async () => {
    const withMessage = installPlatform(async () => ({ ok: false, reasonCode: 'http_401', messageId: 'msg-1' }))
    const first = await mount({ providers: [imageProvider], topicId: 'topic-1' })
    await click(first, '[data-generate]')
    expect(state(first).error).toBe('')
    expect(withMessage).toHaveBeenCalledTimes(1)

    const noMessage = installPlatform(async () => ({ ok: false, reasonCode: 'missing_topic' }))
    const second = await mount({ providers: [imageProvider], topicId: 'topic-1' })
    await click(second, '[data-generate]')
    expect(state(second).error).toBe(labels.imageFailureTopicMissing)
    expect(noMessage).toHaveBeenCalledTimes(1)
  })

  it('reports a missing topic when the topic cannot be created', async () => {
    const spy = installPlatform(async () => ({ ok: true, messageId: 'msg-1', imageCount: 1 }))
    const container = await mount({ providers: [imageProvider], topicId: null, resolveTopicId: async () => null })

    await click(container, '[data-generate]')

    expect(state(container).error).toBe(labels.imageFailureTopicMissing)
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects an empty prompt before calling the main process', async () => {
    const spy = installPlatform(async () => ({ ok: true, messageId: 'msg-1', imageCount: 1 }))
    const container = await mount({ providers: [imageProvider], topicId: 'topic-1' })

    await click(container, '[data-generate-empty]')

    expect(state(container).error).toBe(labels.imagePromptRequired)
    expect(state(container).pending).toBe('')
    expect(spy).not.toHaveBeenCalled()
  })

  it('disables generation without an image endpoint and editing without an image edit endpoint', async () => {
    const spy = installPlatform(async () => ({ ok: true, messageId: 'msg-1', imageCount: 1 }))
    const container = await mount({ providers: [{ ...imageProvider, imageEndpoints: {} } as SafeModelProvider], topicId: 'topic-1' })

    expect(state(container).target).toBe('')
    expect(state(container).editTarget).toBe('')
    await click(container, '[data-generate]')
    expect(state(container).error).toBe(labels.imageFailureNoEndpoint)

    const editOnly = await mount({
      providers: [
        { ...imageProvider, extraEndpoints: { imageEdit: 'https://api.acme.test/images' } } as SafeModelProvider
      ],
      topicId: 'topic-1'
    })
    expect(state(editOnly).editTarget).toBe('acme-image')
    await click(editOnly, '[data-edit]')
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ operation: 'edit', sourceImage: { fileName: generatedRef.fileName }, count: 1 })
    )
  })

  it('dispatches an edit with the source image reference and requires a source', async () => {
    const onMessagesChanged = vi.fn()
    const spy = installPlatform(async () => ({ ok: true, messageId: 'msg-2', imageCount: 1 }))
    const container = await mount({ providers: [imageProvider], topicId: 'topic-1', onMessagesChanged })

    await click(container, '[data-edit-nosource]')
    expect(state(container).error).toBe(labels.imageEditSourceRequired)
    expect(spy).not.toHaveBeenCalled()

    await click(container, '[data-edit]')
    expect(spy).toHaveBeenCalledWith({
      providerId: 'acme',
      modelId: 'acme-image',
      prompt: 'make it blue',
      size: '512x512',
      count: 1,
      topicId: 'topic-1',
      operation: 'edit',
      sourceImage: { fileName: generatedRef.fileName }
    })
    expect(onMessagesChanged).toHaveBeenCalledWith('topic-1')
    expect(state(container)).toMatchObject({ generating: false, pending: '', error: '' })
  })

  it('keeps the placeholder when the topic is created for the in-flight request', async () => {
    let settle: (() => void) | undefined
    installPlatform(
      () =>
        new Promise<GenerateResponse>((resolve) => {
          settle = () => resolve({ ok: true, messageId: 'msg-1', imageCount: 1 })
        })
    )
    const container = await mount({
      providers: [imageProvider],
      topicId: null,
      resolveTopicId: async () => 'topic-new'
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-generate]')?.click()
      await Promise.resolve()
    })
    expect(state(container).pending).toBe('generate')

    // 主进程/父组件在派发期间把新话题设为当前话题 ⇒ 这是同一次请求的话题，不能当成「切走」
    await act(async () => {
      root?.render(createElement(Harness, { providers: [imageProvider], topicId: 'topic-new' }))
    })
    expect(state(container).pending).toBe('generate')

    await act(async () => {
      settle?.()
      await Promise.resolve()
    })
    expect(state(container)).toMatchObject({ pending: '', generating: false })
  })

  it('clears the local placeholder and error when the topic changes', async () => {
    let settle: (() => void) | undefined
    installPlatform(
      () =>
        new Promise<GenerateResponse>((resolve) => {
          settle = () => resolve({ ok: false, reasonCode: 'missing_topic' })
        })
    )
    const container = await mount({ providers: [imageProvider], topicId: 'topic-1' })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-generate]')?.click()
      await Promise.resolve()
    })
    expect(state(container).pending).toBe('generate')

    await act(async () => {
      root?.render(createElement(Harness, { providers: [imageProvider], topicId: 'topic-2' }))
    })
    expect(state(container)).toMatchObject({ pending: '', generating: false, error: '' })

    await act(async () => {
      settle?.()
      await Promise.resolve()
    })
  })
})
