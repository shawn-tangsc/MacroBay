// @vitest-environment happy-dom

import { act } from 'react'
import type { Root } from 'react-dom/client'
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

beforeAll(() => {
  // The page reports failed syncs through console.warn, and React may log act() warnings.
  // Those messages can outlive the test and race the worker teardown, so keep both channels
  // quiet for the whole file instead of restoring between tests.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

/**
 * 每个用例渲染的是整页 `AppShell`，而共享 helper 只把 `root` 交回来、不负责卸载。
 * 不卸载的后果不是"少一次清理"：这一页挂着**延迟探测**（`useModelAvailabilityCheck` 的
 * 定时器）和一批异步读取，树还活着时它们的续体会在文件结束后继续跑；并行满载时
 * 环境的 `window` 先被拆掉，调度器再碰它就是 `ReferenceError: window is not defined`
 * ——**用例全绿、却在 teardown 之后报一条未捕获错误**，vitest 因此把整次全量判红。
 * 卸载会让 `useEffect` 的清理把定时器掐掉，续体就没有执行的机会。
 */
const mountedRoots: Root[] = []

afterEach(() => {
  // 卸载要走 act()：不包一层，React 会报「更新没有包在 act 里」，这条噪音会盖住真错误。
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
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
    mountedRoots.push(page.root)

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
    mountedRoots.push(page.root)

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
