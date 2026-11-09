// @vitest-environment happy-dom

import { act } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  pageLabels as labels,
  providerFixture,
  renderModelServiceSettings
} from './modelServicePageHarness'

/**
 * PLAT-61：模型清单是**只读拉取** ⇒ 只要「baseUrl + Key」就能同步/添加模型，
 * 不要求供应商已启用；停用状态同步成功后也不自动启用供应商。
 */

/**
 * 两个通道留作**守卫**用（不是拿来「静音了事」）：它们保留 spy 形态，收尾时用它断言
 * 「拆卸之后没有新日志」。`e011cdc` 那次的教训是——静音只让症状看不见，竞态还在。
 */
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

/**
 * 每个用例渲染的是整页 `AppShell`，而共享 helper 只把 `root` 交回来、不负责卸载。
 * 不卸载的后果不是"少一次清理"：这一页挂着**延迟探测**（`useModelAvailabilityCheck` 的
 * 定时器）和一批异步读取，树还活着时它们的续体会在文件结束后继续跑；并行满载时
 * 环境的 `window` 先被拆掉，调度器再碰它就是 `ReferenceError: window is not defined`
 * ——**用例全绿、却在 teardown 之后报一条未捕获错误**，vitest 因此把整次全量判红。
 * 卸载会让 `useEffect` 的清理把定时器掐掉，续体就没有执行的机会。
 */
const mountedRoots: Root[] = []

/** 一次宏任务 + 微任务：让排到队尾的续体落地。 */
const flushTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(async () => {
  // 1) 卸载**之前**，在 act 里把已经排队的续体跑完：`ModelServiceModelsSection` 的检测汇总、
  //    antd `CSSMotion` 的动画帧都会在这些续体里 setState；跑在 act 外就是那条「not wrapped in act」。
  await act(async () => {
    await flushTick()
  })

  // 2) 卸载放进 act：清理函数（清定时器、退订）必须在 act 作用域里执行。
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })

  // 3) 卸载后仍有动画帧/续体排着：仍在 act 里排空，让它们落在 act 作用域内，而不是落在 teardown 之后。
  await act(async () => {
    await flushTick()
  })

  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')

  // 4) 守卫：上面三步之后，任何新日志都说明还有东西活在用例之外。**红在这个文件里、带这条消息**，
  //    而不是变成 worker 层的 `Closing rpc while "onUserConsoleLog" was pending` 把整次全量判红。
  const before = warnSpy.mock.calls.length + errorSpy.mock.calls.length
  await flushTick()
  expect(
    warnSpy.mock.calls.length + errorSpy.mock.calls.length,
    `teardown 之后仍有日志：${JSON.stringify(
      [...warnSpy.mock.calls, ...errorSpy.mock.calls].map((call) => String(call[0])).slice(before)
    )}`
  ).toBe(before)
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
    // 禁用态的说明改成**看得见**的一句（平台契约：禁用控件带不了可聚焦提示）。
    expect(page.container.querySelector('[data-models-key-hint]')?.textContent).toContain('API key')
    expect(add?.disabled).toBe(true)
    expect(page.container.querySelector('[data-models-key-hint]')?.textContent).toContain('API key')
  })

  it('keeps add-model available for a disabled provider with a key', async () => {
    const page = await renderModelServiceSettings({ provider: { ...providerFixture, enabled: false } })

    const add = page.container.querySelector<HTMLButtonElement>('[data-models-add]')
    expect(add?.disabled).toBe(false)
    // 可用时提示是浮层（tooltipKey），不再是原生 title。
    expect(add?.getAttribute('title')).toBeNull()
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
