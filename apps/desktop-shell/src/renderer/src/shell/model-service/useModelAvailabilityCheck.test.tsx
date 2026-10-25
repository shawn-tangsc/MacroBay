// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelAvailability, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { modelAvailabilityFingerprint } from '@platform/ai/providers/modelAvailability'

import { resetModelDetectionControllerForTests } from './modelDetectionController'
import { useModelAvailabilityCheck } from './useModelAvailabilityCheck'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function providerFixture(overrides: Partial<SafeModelProvider> = {}): SafeModelProvider {
  return {
    id: 'tokenrhythm',
    name: 'TokenRhythm',
    enabled: true,
    baseUrl: 'https://tokenrhythm.studio',
    endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://tokenrhythm.studio' }],
    hasApiKey: true,
    apiKeyPreview: 'sk-a**********wxyz',
    models: [
      { id: 'selected-model', name: 'Selected', capabilities: { chat: true } },
      { id: 'other-1', name: 'Other 1', capabilities: { chat: true } },
      { id: 'other-2', name: 'Other 2', capabilities: { chat: true } }
    ],
    ...overrides
  }
}

function installApi() {
  const detectModels = vi.fn(async (_providerId: string, _request: unknown) => ({ accepted: true, total: 1 }))
  Object.assign(window, {
    platform: {
      modelProviders: {
        detectModels,
        onModelDetectionProgress: () => () => undefined,
        onModelDetectionDone: () => () => undefined
      }
    }
  })
  return { detectModels }
}

function Probe({ provider, modelId }: { provider: SafeModelProvider; modelId: string }): React.ReactElement {
  const model = provider.models.find((entry) => entry.id === modelId)
  useModelAvailabilityCheck({ provider, model, delayMs: 20 })
  return <span data-probe="" />
}

let root: Root | undefined
let container: HTMLElement | undefined

beforeEach(() => {
  vi.useFakeTimers()
  resetModelDetectionControllerForTests()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
  resetModelDetectionControllerForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mount(provider: SafeModelProvider, modelId = 'selected-model'): Promise<void> {
  await act(async () => {
    root?.render(<Probe provider={provider} modelId={modelId} />)
  })
}

async function flush(delayMs = 30): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(delayMs)
  })
}

function availabilityFor(provider: SafeModelProvider, modelId: string): ModelAvailability {
  const model = provider.models.find((entry) => entry.id === modelId)!
  return {
    status: 'ok',
    checkedAt: '2026-10-25T05:00:00.000Z',
    fingerprint: modelAvailabilityFingerprint(
      { endpoints: provider.endpoints, apiKeyPreview: provider.apiKeyPreview },
      model
    )
  }
}

describe('useModelAvailabilityCheck', () => {
  it('probes only the selected model, never the whole provider list', async () => {
    const { detectModels } = installApi()
    const provider = providerFixture()

    await mount(provider)
    expect(detectModels).not.toHaveBeenCalled()
    await flush()

    expect(detectModels).toHaveBeenCalledTimes(1)
    expect(detectModels).toHaveBeenCalledWith('tokenrhythm', expect.objectContaining({
      modes: ['connectivity'],
      modelIds: ['selected-model']
    }))
  })

  it('skips a model that already has a fresh verdict for the current config', async () => {
    const { detectModels } = installApi()
    const base = providerFixture()
    const provider = {
      ...base,
      models: base.models.map((model) =>
        model.id === 'selected-model'
          ? { ...model, availability: availabilityFor(base, model.id) }
          : model
      )
    }

    await mount(provider)
    await flush()
    expect(detectModels).not.toHaveBeenCalled()
  })

  it('re-probes once the key changes (old verdict becomes stale)', async () => {
    const { detectModels } = installApi()
    const base = providerFixture()
    const tested = {
      ...base,
      models: base.models.map((model) =>
        model.id === 'selected-model'
          ? { ...model, availability: availabilityFor(base, model.id) }
          : model
      )
    }

    await mount(tested)
    await flush()
    expect(detectModels).not.toHaveBeenCalled()

    const rotated = { ...tested, apiKeyPreview: 'sk-b**********wxyz' }
    await act(async () => {
      root?.render(<Probe provider={rotated} modelId="selected-model" />)
    })
    await flush()
    expect(detectModels).toHaveBeenCalledTimes(1)
    expect(detectModels).toHaveBeenCalledWith('tokenrhythm', expect.objectContaining({
      modelIds: ['selected-model']
    }))
  })

  it('does not probe a disabled provider, a keyless provider, or a media model', async () => {
    const { detectModels } = installApi()
    await mount(providerFixture({ enabled: false }))
    await flush()

    await act(async () => {
      root?.render(<Probe provider={providerFixture({ hasApiKey: false })} modelId="selected-model" />)
    })
    await flush()

    const media = providerFixture({
      models: [{ id: 'selected-model', name: 'Image', capabilities: { chat: false, imageGeneration: true } }]
    })
    await act(async () => {
      root?.render(<Probe provider={media} modelId="selected-model" />)
    })
    await flush()

    expect(detectModels).not.toHaveBeenCalled()
  })

  it('attempts each configuration only once per session', async () => {
    const { detectModels } = installApi()
    const provider = providerFixture()
    await mount(provider)
    await flush()
    expect(detectModels).toHaveBeenCalledTimes(1)

    // 刷新后 provider 换了新对象，但配置没变：不得重复探测。
    await act(async () => {
      root?.render(<Probe provider={{ ...provider }} modelId="selected-model" />)
    })
    await flush()
    expect(detectModels).toHaveBeenCalledTimes(1)
  })
})
