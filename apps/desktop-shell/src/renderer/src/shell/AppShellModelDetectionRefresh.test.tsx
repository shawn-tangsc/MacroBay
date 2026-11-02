// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import { AppShell } from './AppShell'

/**
 * PLAT-82：检测结束会把「本次实测通过」的协议写回模型（主进程一次 save），
 * 所以渲染层收到 done 之后必须重新拉一次供应商列表 —— 否则行内协议 chip / 协议 pill
 * 要等到手动切页或重启才能反映新证据。
 */
const providerFixture: SafeModelProvider = {
  id: 'provider-local',
  name: 'Local Provider',
  enabled: true,
  baseUrl: 'https://api.example.test/v1',
  endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://api.example.test/v1' }],
  hasApiKey: true,
  apiKeyPreview: 'fixt...7890',
  connectionStatus: 'ready',
  models: [{
    id: 'chat-model',
    name: 'Chat Model',
    capabilities: { chat: true, vision: false, embedding: false, tools: true }
  }],
  defaultChatModelId: 'chat-model'
} as SafeModelProvider

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

function installPlatformApi(): {
  list: ReturnType<typeof vi.fn>
  fireDone: () => void
} {
  const doneListeners = new Set<(runId: string, payload: { stopped: boolean }) => void>()
  const list = vi.fn(async () => [providerFixture])
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      app: {
        getInfo: vi.fn(async () => null),
        getProductSummaries: vi.fn(async () => []),
        openExternal: vi.fn(async () => undefined)
      },
      settings: { get: vi.fn(async () => ({ ...createDefaultAppSettings(), language: 'en-US' })) },
      modelProviders: {
        list,
        onModelDetectionProgress: vi.fn(() => () => undefined),
        onModelDetectionDone: vi.fn((listener: (runId: string, payload: { stopped: boolean }) => void) => {
          doneListeners.add(listener)
          return () => doneListeners.delete(listener)
        })
      },
      assistants: {
        list: vi.fn(async () => []),
        listTopics: vi.fn(async () => ({ topics: [] })),
        listTopicMessages: vi.fn(async () => ({ messages: [] })),
        streamAttach: vi.fn(async () => ({ snapshot: { topicId: '', status: 'idle', executions: [] } })),
        onStreamChunk: vi.fn(() => () => undefined),
        onStreamDone: vi.fn(() => () => undefined),
        onStreamError: vi.fn(() => () => undefined),
        onStreamStatusChanged: vi.fn(() => () => undefined)
      }
    } as unknown as Window['platform']
  })
  return {
    list,
    fireDone: () => {
      for (const listener of doneListeners) listener('run-1', { stopped: false })
    }
  }
}

describe('PLAT-82 检测结束后刷新供应商', () => {
  it('re-reads the provider list when a detection run ends', async () => {
    const api = installPlatformApi()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(AppShell))
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(1))
    await act(async () => {
      api.fireDone()
      await Promise.resolve()
    })
    // done 之后重新拉一次：写库结果（probedProtocols / supportedProtocols）立刻可见。
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))

    await act(async () => root.unmount())
  })
})
