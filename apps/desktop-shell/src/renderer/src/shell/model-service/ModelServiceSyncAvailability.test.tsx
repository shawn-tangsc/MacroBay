// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  pageLabels as labels,
  providerFixture,
  renderModelServiceSettings
} from './modelServicePageHarness'

/**
 * PLAT-61：模型清单是**只读拉取** ⇒ 只要「baseUrl + Key」就能同步/添加模型，
 * 不要求供应商已启用；停用状态同步成功后也不自动启用供应商。
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  // The page reports failed syncs through console.warn, and React may log act() warnings.
  // Those messages can outlive the test and race the worker teardown, so keep both channels
  // quiet for the whole file instead of restoring between tests.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

describe('PLAT-61 模型同步可用性', () => {
  it('allows fetching models for a disabled provider that has a key', async () => {
    const page = await renderModelServiceSettings({
      provider: { enabled: false, hasApiKey: true },
      previewModelSync: async () => ({ ok: true, added: [], missing: [] })
    })

    const sync = page.container.querySelector<HTMLButtonElement>('[data-models-sync]')
    expect(sync?.disabled).toBe(false)
    await act(async () => {
      sync?.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(page.api.previewModelSync).toHaveBeenCalledTimes(1))
    // 拉取不会顺手启用供应商。
    expect(page.api.setEnabled).not.toHaveBeenCalled()
  })

  it('disables sync and add-model with a visible key hint when no key is available', async () => {
    const page = await renderModelServiceSettings({
      provider: { hasApiKey: false, apiKeyPreview: '' }
    })

    const sync = page.container.querySelector<HTMLButtonElement>('[data-models-sync]')
    const add = page.container.querySelector<HTMLButtonElement>('[data-models-add]')
    expect(sync?.disabled).toBe(true)
    expect(sync?.getAttribute('title')).toContain('API key')
    expect(add?.disabled).toBe(true)
    expect(add?.getAttribute('title')).toContain('API key')
  })

  it('keeps add-model available for a disabled provider with a key', async () => {
    const page = await renderModelServiceSettings({ provider: { ...providerFixture, enabled: false } })

    const add = page.container.querySelector<HTMLButtonElement>('[data-models-add]')
    expect(add?.disabled).toBe(false)
    expect(add?.getAttribute('title')).toBe(labels.addModel)
  })

  /**
   * PLAT-71：Gemini 走原生 `/v1beta/models` ⇒ 「获取模型列表」正常返回候选，
   * 不再出现「不支持模型列表」的提示。
   */
  it('syncs a gemini provider through its native model list', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        id: 'gemini',
        name: 'Gemini',
        endpoints: [
          { protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' }
        ],
        baseUrl: 'https://generativelanguage.googleapis.com'
      },
      previewModelSync: async () => ({
        ok: true,
        added: [
          {
            id: 'gemini-3.5-flash',
            name: 'Gemini 3.5 Flash',
            capabilities: { chat: true, vision: false, embedding: false, tools: false },
            chatProtocol: 'gemini'
          }
        ],
        updated: [],
        missing: [],
        stale: []
      })
    })

    const sync = page.container.querySelector<HTMLButtonElement>('[data-models-sync]')
    expect(sync?.disabled).toBe(false)
    await act(async () => {
      sync?.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      const text = document.body.textContent ?? ''
      expect(text).not.toContain(labels.modelSyncReasonModelListUnsupported)
      expect(text).not.toContain('HTTP 404')
    })
  })
})
