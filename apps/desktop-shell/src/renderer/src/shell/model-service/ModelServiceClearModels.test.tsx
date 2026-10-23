// @vitest-environment happy-dom

import { act } from 'react'
import { message } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { pageLabels, pageStatusText, providerFixture, renderModelServiceSettings, type PlatformApiMock } from './modelServicePageHarness'

/**
 * PLAT-72：「清空模型」端到端（真实 AppShell + 真实页面，只 mock IPC 边界）。
 * 断言：确认弹窗数量、取消不提交、确认只提交一次且用 applyModelSync 通道、
 * 成功后 toast、失败行内报错且不假装清空。
 */
let dispose: (() => Promise<void>) | undefined

afterEach(async () => {
  await dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

async function mount(options: Parameters<typeof renderModelServiceSettings>[0] = {}): Promise<{
  api: PlatformApiMock
  container: HTMLElement
}> {
  const page = await renderModelServiceSettings(options)
  dispose = async () => {
    await act(async () => page.root.unmount())
  }
  return page
}

function clearButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('[data-models-clear]')
  if (!button) throw new Error('Expected the clear-models button.')
  return button
}

async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error('Expected a clickable element.')
  await act(async () => {
    ;(element as HTMLElement).click()
    await Promise.resolve()
  })
}

describe('PLAT-72 clear all models from the model toolbar', () => {
  it('confirms with the model count and deletes nothing on cancel', async () => {
    const { api, container } = await mount()
    expect(clearButton(container).disabled).toBe(false)

    await click(clearButton(container))
    expect(clearButton(container).getAttribute('data-models-clear-open')).toBe('true')
    expect(document.querySelector('[data-models-clear-confirm]')?.textContent)
      .toBe(pageLabels.clearModelsConfirmBody(providerFixture.models.length))

    await click(document.querySelector('[data-models-clear-cancel]'))
    expect(clearButton(container).getAttribute('data-models-clear-open')).toBe('false')
    expect(api.applyModelSync).not.toHaveBeenCalled()
  })

  it('clears through the existing applyModelSync channel and toasts the removed count', async () => {
    const success = vi.spyOn(message, 'success')
    const { api, container } = await mount()
    const modelIds = providerFixture.models.map((model) => model.id)

    await click(clearButton(container))
    await click(document.querySelector('[data-models-clear-confirm-button]'))

    expect(api.applyModelSync).toHaveBeenCalledTimes(1)
    expect(api.applyModelSync).toHaveBeenCalledWith('silicon', {
      toAdd: [],
      toUpdate: [],
      toRemove: modelIds
    })
    expect(success).toHaveBeenCalledWith(pageLabels.modelsClearedToast(modelIds.length))
  })

  it('is disabled when the provider has no models', async () => {
    const { container } = await mount({ provider: { models: [] } })
    expect(clearButton(container).disabled).toBe(true)
  })

  it('shows an inline error and keeps the models when the clear fails', async () => {
    const success = vi.spyOn(message, 'success')
    const { api, container } = await mount({
      applyModelSync: async () => {
        throw new Error('ipc-failed')
      }
    })

    await click(clearButton(container))
    await click(document.querySelector('[data-models-clear-confirm-button]'))

    expect(api.applyModelSync).toHaveBeenCalledTimes(1)
    expect(success).not.toHaveBeenCalled()
    const inlineError = container.querySelector('[data-models-error]')
    expect(inlineError?.textContent).toContain(pageStatusText.failed)
    expect(container.querySelector('[data-models-count]')?.textContent).toBe(String(providerFixture.models.length))
  })
})
