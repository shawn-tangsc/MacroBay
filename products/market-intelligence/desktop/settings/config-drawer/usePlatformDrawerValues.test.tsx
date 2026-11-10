// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { usePlatformDrawerValues } from './usePlatformDrawerValues'

/**
 * 「平台与模型 → 模型服务」那一行：读者只该看到 `已配置 / 未配置` 一档。
 *
 * 两态各一条；读不到（接口失败）不是「未配置」，所以另外钉一条「不编值」。
 */
function provider(overrides: Partial<SafeModelProvider> = {}): SafeModelProvider {
  return {
    id: 'silicon',
    name: 'Silicon',
    endpoints: [{ protocol: 'messages', baseUrl: 'https://silicon.example.test' }],
    enabled: true,
    baseUrl: 'https://silicon.example.test',
    hasApiKey: true,
    apiKeyPreview: 'sk-**********7890',
    models: [],
    isSystem: false,
    ...overrides
  } as unknown as SafeModelProvider
}

type Bridge = {
  settings?: { get?: () => Promise<unknown> }
  modelProviders?: { list?: () => Promise<unknown> }
}

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  delete (window as unknown as { platform?: Bridge }).platform
})

function Host(): React.ReactElement {
  const values = usePlatformDrawerValues()
  return createElement('output', { 'data-drawer-values': JSON.stringify(values) })
}

async function mount(bridge: Bridge): Promise<Record<string, string | undefined>> {
  ;(window as unknown as { platform: Bridge }).platform = bridge
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(Host) }))
    await Promise.resolve()
    await Promise.resolve()
  })
  const output = container.querySelector('output')?.getAttribute('data-drawer-values') ?? '{}'
  return JSON.parse(output) as Record<string, string | undefined>
}

describe('平台与模型 → 模型服务', () => {
  it('says 已配置 when one provider is enabled with endpoint and API key', async () => {
    const values = await mount({
      settings: { get: async () => ({}) },
      modelProviders: { list: async () => [provider()] }
    })

    expect(values.modelService).toBe('已配置')
  })

  it('says 未配置 when no provider is ready', async () => {
    const values = await mount({
      settings: { get: async () => ({}) },
      modelProviders: { list: async () => [provider({ hasApiKey: false }), provider({ enabled: false })] }
    })

    expect(values.modelService).toBe('未配置')
  })

  it('leaves the row empty (read failure) instead of claiming 未配置', async () => {
    const values = await mount({
      settings: { get: async () => ({}) },
      modelProviders: { list: async () => { throw new Error('bridge-missing') } }
    })

    expect(values.modelService).toBeUndefined()
  })
})
