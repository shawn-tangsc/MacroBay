// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import {
  resetModelDetectionControllerForTests,
  startModelDetection
} from './modelDetectionController'
import { useAutoModelDetection } from './useAutoModelDetection'

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
      { id: 'chat-1', name: 'Chat 1', capabilities: { chat: true } },
      { id: 'chat-2', name: 'Chat 2', capabilities: { chat: true } }
    ],
    ...overrides
  }
}

function installApi() {
  const detectModels = vi.fn(async () => ({ accepted: true, total: 2 }))
  const doneListeners = new Set<(runId: string, payload: { stopped: boolean }) => void>()
  Object.assign(window, {
    platform: {
      modelProviders: {
        detectModels,
        onModelDetectionProgress: () => () => undefined,
        onModelDetectionDone: (callback: (runId: string, payload: { stopped: boolean }) => void) => {
          doneListeners.add(callback)
          return () => doneListeners.delete(callback)
        }
      }
    }
  })
  /** 真实主进程在 run 结束时发 done；不发就永远算「检测中」，下一轮会正确让位。 */
  const finishLatestRun = (): void => {
    const lastCall = detectModels.mock.calls.at(-1) as unknown as [string, { runId: string }] | undefined
    if (!lastCall) return
    for (const listener of doneListeners) listener(lastCall[1].runId, { stopped: false })
  }
  return { detectModels, finishLatestRun }
}

function Probe({ provider }: { provider: SafeModelProvider | null }): React.ReactElement {
  const outcome = useAutoModelDetection({ provider, delayMs: 20 })
  return createElement('span', {
    'data-auto-detection': outcome === null ? '' : `${outcome.started}/${outcome.skipped}`
  })
}

let root: Root | undefined

beforeEach(() => {
  vi.useFakeTimers()
  resetModelDetectionControllerForTests()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  resetModelDetectionControllerForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mount(provider: SafeModelProvider | null): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(Probe, { provider }))
  })
  return container
}

async function flush(delayMs = 30): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(delayMs)
  })
}

describe('useAutoModelDetection', () => {
  it('runs a connectivity check for the pending chat models after the debounce', async () => {
    const { detectModels } = installApi()
    const container = await mount(providerFixture())

    expect(detectModels).not.toHaveBeenCalled()
    await flush()

    expect(detectModels).toHaveBeenCalledTimes(1)
    expect(detectModels).toHaveBeenCalledWith('tokenrhythm', expect.objectContaining({
      modes: ['connectivity'],
      modelIds: ['chat-1', 'chat-2']
    }))
    expect(container.querySelector('[data-auto-detection]')?.getAttribute('data-auto-detection')).toBe('2/0')
  })

  it('does not fire when the provider is disabled or has no key', async () => {
    const { detectModels } = installApi()
    await mount(providerFixture({ enabled: false }))
    await flush()
    expect(detectModels).not.toHaveBeenCalled()

    await act(async () => root?.unmount())
    resetModelDetectionControllerForTests()
    await mount(providerFixture({ hasApiKey: false }))
    await flush()
    expect(detectModels).not.toHaveBeenCalled()
  })

  it('runs once per configuration signature even when the provider object is replaced', async () => {
    const { detectModels, finishLatestRun } = installApi()
    await mount(providerFixture())
    await flush()
    expect(detectModels).toHaveBeenCalledTimes(1)
    await act(async () => finishLatestRun())

    // 保存后的 refresh 会换一个新对象，但配置没变 ⇒ 不得再发一轮请求。
    await act(async () => {
      root?.render(createElement(Probe, { provider: providerFixture() }))
    })
    await flush()
    expect(detectModels).toHaveBeenCalledTimes(1)

    // Key 变了 ⇒ 结论全部失效 ⇒ 允许再跑一轮。
    await act(async () => {
      root?.render(createElement(Probe, { provider: providerFixture({ apiKeyPreview: 'sk-b**********wxyz' }) }))
    })
    await flush()
    expect(detectModels).toHaveBeenCalledTimes(2)
  })

  it('yields to an already running detection instead of stacking requests', async () => {
    const { detectModels } = installApi()
    // 手动入口已经起了一轮（run 在内存里仍在跑）。
    await act(async () => {
      await startModelDetection('tokenrhythm', ['connectivity', 'protocol'])
    })
    expect(detectModels).toHaveBeenCalledTimes(1)

    await mount(providerFixture())
    await flush()
    expect(detectModels).toHaveBeenCalledTimes(1)
  })
})
