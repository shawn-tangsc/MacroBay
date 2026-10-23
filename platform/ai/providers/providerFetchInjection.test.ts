import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelProvider } from './modelProviderTypes'
import { testModelProviderConnection } from './providerConnection'
import { previewProviderModelSync } from './providerModelSync'

/**
 * PLAT-61 回归守卫：provider 出站**只能**用注入的 fetch（生产 = Electron net.fetch + session 代理）。
 * 以前 `options.fetch ?? fetch` 会静默回退到 Node 全局 fetch，绕过代理 ⇒ 需代理的域名必然超时。
 */
function createProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'aihubmix',
    name: 'AiHubMix',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://aihubmix.com' }
    ],
    enabled: true,
    baseUrl: 'https://aihubmix.com',
    apiKey: 'sk-test',
    models: [{ id: 'gpt-5', name: 'gpt-5', capabilities: { chat: true, vision: false, embedding: false, tools: true } }],
    defaultChatModelId: 'gpt-5',
    ...overrides
  }
}

const readSource = (relativePath: string): string => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PLAT-61 provider fetch injection', () => {
  it('uses only the injected fetch for connection checks (global fetch stays untouched)', async () => {
    const globalFetch = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', globalFetch)
    const injected = vi.fn(async () => new Response(JSON.stringify({ id: 'ok' }), { status: 200 }))

    const result = await testModelProviderConnection(createProvider(), { fetch: injected })

    expect(result.ok).toBe(true)
    expect(injected).toHaveBeenCalledOnce()
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('uses only the injected fetch for model listing (global fetch stays untouched)', async () => {
    const globalFetch = vi.fn(async () => new Response('', { status: 500 }))
    vi.stubGlobal('fetch', globalFetch)
    const injected = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-5' }] }), { status: 200 }))

    const outcome = await previewProviderModelSync(createProvider(), { fetch: injected })

    expect(outcome.ok).toBe(true)
    expect(injected).toHaveBeenCalledOnce()
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('has no implicit global fetch fallback in the provider transport modules', () => {
    for (const file of ['platform/ai/providers/providerConnection.ts', 'platform/ai/providers/modelList/remoteModelList.ts']) {
      const source = readSource(file)
      expect(source, `${file} must not fall back to global fetch`).not.toMatch(/options\.fetch\s*\?\?/)
      expect(source, `${file} must not fall back to global fetch`).not.toMatch(/\?\?\s*fetch\b/)
      // 注入的 fetch 可能被作为参数顺流传给内部 helper（`requestJson(..., options.fetch)`），
      // 只要引用的是注入值、且没有裸调全局 `fetch(` 就算守住。
      expect(source, `${file} must use the injected fetch`).toMatch(/options\.fetch\b/)
      expect(source, `${file} must not call the global fetch`).not.toMatch(/[^.\w]fetch\s*\(/)
    }
  })
})
