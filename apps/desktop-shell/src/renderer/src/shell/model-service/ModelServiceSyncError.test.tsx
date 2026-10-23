// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  pageLabels as labels,
  renderModelServiceSettings
} from './modelServicePageHarness'

/**
 * PLAT-61 A：模型同步失败的两层修复。
 *  - main：`previewModelSync`/`applyModelSync` 失败返回结构化 `{ ok:false, reasonCode }`（不 throw）；
 *  - renderer：即使仍收到原始 Error，也先洗掉 `Error invoking remote method …` / `platform:`，
 *    只显示「获取模型列表失败：{原因}」+ 重试。
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

describe('PLAT-61 模型同步失败的人话提示', () => {
  it('shows the reason and a retry action instead of the raw IPC error', async () => {
    let attempt = 0
    const page = await renderModelServiceSettings({
      previewModelSync: async () => {
        attempt += 1
        if (attempt === 1) {
          return {
            ok: false,
            reasonCode: 'unauthorized',
            message: `Error invoking remote method 'platform:model-providers-preview-model-sync': Error: Model sync failed.`
          }
        }
        return { ok: true, added: [], missing: [] }
      }
    })
    const api = page.api

    const sync = page.container.querySelector<HTMLButtonElement>('[data-models-sync]')
    await act(async () => {
      sync?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(page.container.querySelector('[data-models-sync-error]')).not.toBeNull())
    const error = page.container.querySelector('[data-models-sync-error]')
    expect(error?.textContent).toContain(labels.fetchModelsFailed)
    expect(error?.textContent).toContain(labels.connectionCheckReasonUnauthorized)
    expect(error?.querySelector('[data-models-sync-retry]')?.textContent?.trim()).toBe(labels.retry)

    // 原始 IPC 文本绝不进入 UI。
    expect(page.container.textContent).not.toContain('Error invoking remote method')
    expect(page.container.textContent).not.toContain('platform:')

    // 重试会重新调用一次（成功后错误消失）。
    await act(async () => {
      error?.querySelector<HTMLButtonElement>('[data-models-sync-retry]')?.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(api.previewModelSync).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(page.container.querySelector('[data-models-sync-error]')).toBeNull())
  })


  it('shows the upstream balance message in the main line and keeps the HTTP detail', async () => {
    const page = await renderModelServiceSettings({
      previewModelSync: async () => ({
        ok: false,
        reasonCode: 'account_balance_insufficient',
        message: 'HTTP 402 · Your account balance is insufficient. Please recharge. (tid: 42)',
        upstreamMessage: 'Your account balance is insufficient. Please recharge. (tid: 42)'
      })
    })

    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('[data-models-sync]')?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(page.container.querySelector('[data-models-sync-error]')).not.toBeNull())
    const error = page.container.querySelector('[data-models-sync-error]')
    expect(error?.textContent).toContain(labels.connectionCheckReasonAccountBalance)
    expect(error?.textContent).toContain('Your account balance is insufficient')
    expect(error?.querySelector('[data-models-sync-detail]')?.textContent).toContain('HTTP 402')
    expect(error?.querySelector('[data-models-sync-detail]')?.textContent).toContain('tid: 42')
    expect(page.container.textContent).not.toContain('Error invoking remote method')
    expect(page.container.textContent).not.toContain('platform:')
  })

  it('shows a one-line upstream msg for a 401 JSON body without leaking raw JSON', async () => {
    const page = await renderModelServiceSettings({
      previewModelSync: async () => ({
        ok: false,
        reasonCode: 'http_401',
        message: 'HTTP 401 · APIkey或者用户异常',
        upstreamMessage: 'APIkey或者用户异常'
      })
    })

    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('[data-models-sync]')?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(page.container.querySelector('[data-models-sync-error]')).not.toBeNull())
    const error = page.container.querySelector('[data-models-sync-error]')
    const text = page.container.textContent ?? ''
    expect(error?.textContent).toContain(labels.connectionCheckReasonUnauthorized)
    expect(text).toContain('HTTP 401')
    expect(text).toContain('APIkey或者用户异常')
    // 原始 JSON 绝不进入 DOM。
    expect(text).not.toContain('{"')
    expect(text).not.toContain('"data":null')
    expect(error?.querySelector('[data-models-sync-retry]')).not.toBeNull()
  })

  it('sanitizes a legacy thrown error so the channel name still never reaches the DOM', async () => {
    const page = await renderModelServiceSettings({
      previewModelSync: async () => {
        throw new Error(`Error invoking remote method 'platform:model-providers-preview-model-sync': Error: Model sync failed.`)
      }
    })

    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('[data-models-sync]')?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(page.container.querySelector('[data-models-sync-error]')).not.toBeNull())
    expect(page.container.textContent).toContain(labels.fetchModelsFailed)
    expect(page.container.textContent).toContain(labels.modelSyncReasonUnknown)
    expect(page.container.textContent).not.toContain('Error invoking remote method')
    expect(page.container.textContent).not.toContain('platform:')
  })
})
