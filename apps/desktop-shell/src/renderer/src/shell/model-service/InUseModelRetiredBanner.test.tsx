// @vitest-environment happy-dom

import { act, createElement, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'
import { InUseModelRetiredBanner } from './InUseModelRetiredBanner'
import { useInUseModelPatrol } from './useInUseModelPatrol'

/**
 * PLAT-75：巡检只探"在用模型"（fetch 次数 = 目标数，证明不做全量），
 * 下线才出提示、正常/限流/网络失败不出提示，按钮只负责跳转（不自动切模型）。
 */
const labels = platformText['en-US'].models

function provider(id: string, modelIds: string[]): SafeModelProvider {
  return {
    id,
    name: id,
    protocol: 'openai',
    enabled: true,
    baseUrl: `https://${id}.example.test`,
    hasApiKey: true,
    apiKeyPreview: 'sk-**********7890',
    apiKeyRef: `provider:${id}`,
    defaultChatModelId: modelIds[0],
    models: modelIds.map((modelId) => ({ id: modelId, name: modelId, capabilities: { chat: true } })),
    isSystem: false
  } as unknown as SafeModelProvider
}

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

type TestConnection = (providerId: string, options?: { modelId?: string }) => Promise<unknown>

function installPlatform(testConnection: TestConnection, agentModelIds: string[]): void {
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      modelProviders: { testConnection: vi.fn(testConnection) },
      agents: { getState: vi.fn(async () => ({ agents: agentModelIds.map((model) => ({ model })) })) }
    }
  })
}

function Host({
  providers,
  onChangeModel
}: {
  providers: SafeModelProvider[]
  onChangeModel: () => void
}): React.ReactElement {
  const retired = useInUseModelPatrol({
    providers,
    loadAgentModelIds: async () => ['deepseek:chat-b']
  })
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return createElement(InUseModelRetiredBanner, { labels, items: mounted ? retired : [], onChangeModel })
}

async function mount(providers: SafeModelProvider[], onChangeModel = (): void => undefined): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(Host, { providers, onChangeModel }))
    await Promise.resolve()
  })
  return container
}

describe('PLAT-75 in-use model patrol', () => {
  it('probes only the in-use models (call count equals the target count)', async () => {
    const testConnection = vi.fn(async () => ({ ok: true }))
    installPlatform(testConnection, ['deepseek:chat-b'])

    await mount([provider('silicon', ['chat-a']), provider('deepseek', ['chat-b'])])
    await act(async () => { await Promise.resolve() })

    expect(testConnection).toHaveBeenCalledTimes(2)
    const probedModelIds = testConnection.mock.calls.map((call) =>
      (call as unknown as [string, { modelId?: string }])[1].modelId
    )
    expect(probedModelIds.sort()).toEqual(['chat-a', 'chat-b'])
  })

  it('shows a persistent banner for a retired model and offers a change-model action', async () => {
    const onChangeModel = vi.fn()
    installPlatform(async () => ({ ok: false, failureCode: 'model_retired' }), [])

    const container = await mount([provider('silicon', ['chat-a'])], onChangeModel)
    await act(async () => { await Promise.resolve() })

    const banner = container.querySelector('[data-in-use-model-retired]')
    expect(banner?.textContent).toContain(labels.inUseModelRetired('chat-a'))
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-in-use-model-retired-change]')?.click()
      await Promise.resolve()
    })
    expect(onChangeModel).toHaveBeenCalledTimes(1)
  })

  it('stays silent for rate limits, network failures and healthy models', async () => {
    for (const response of [
      { ok: false, failureCode: 'rate_limited' },
      { ok: false, failureCode: 'network_timeout' },
      { ok: false, failureCode: 'http_500' },
      { ok: true }
    ]) {
      installPlatform(async () => response, [])
      const container = await mount([provider('silicon', ['chat-a'])])
      await act(async () => { await Promise.resolve() })
      expect(container.querySelector('[data-in-use-model-retired]'), JSON.stringify(response)).toBeNull()
      await act(async () => root?.unmount())
      root = undefined
      document.body.replaceChildren()
    }
  })

  it('never treats a thrown IPC error as "retired"', async () => {
    installPlatform(async () => {
      throw new Error('ipc failed')
    }, [])

    const container = await mount([provider('silicon', ['chat-a'])])
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('[data-in-use-model-retired]')).toBeNull()
  })
})
