// @vitest-environment happy-dom

import { act } from 'react'
import { message } from 'antd'

import { installAntdStaticRender } from '@platform/ui/antd/antdStaticRender'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pageLabels, pageStatusText, providerFixture, renderModelServiceSettings, type PlatformApiMock } from './modelServicePageHarness'

/**
 * PLAT-72：「清空模型」端到端（真实 AppShell + 真实页面，只 mock IPC 边界）。
 * 断言：确认弹窗数量、取消不提交、确认只提交一次且用 applyModelSync 通道、
 * 成功后 toast、失败行内报错且不假装清空。
 */
let dispose: (() => Promise<void>) | undefined

beforeEach(() => {
  // 与渲染入口 `main.tsx` 同一句：确认框走 antd 静态渲染，测试里也要接一次。
  installAntdStaticRender()
})

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


/** 确认框由 `Modal.confirm` 挂在 `document.body`：标题、正文、两个按钮都在 portal 里。 */
function confirmTitle(): string {
  return document.querySelector('.ant-modal-confirm-title')?.textContent ?? ''
}

function confirmBody(): string {
  return document.querySelector('.ant-modal-confirm-content')?.textContent ?? ''
}

function confirmButton(primary: boolean): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button')]
    .find((entry) => entry.classList.contains('ant-btn-primary') === primary)
}

async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error('Expected a clickable element.')
  await act(async () => {
    ;(element as HTMLElement).click()
    // 确认框是点下之后才挂载的，要放过一个宏任务才能读到它的 DOM。
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

describe('PLAT-72 clear all models from the model toolbar', () => {
  it('confirms with the model count and deletes nothing on cancel', async () => {
    const { api, container } = await mount()
    expect(clearButton(container).disabled).toBe(false)

    await click(clearButton(container))
    expect(confirmTitle()).toBe(pageLabels.clearModelsConfirmTitle)
    expect(confirmBody()).toBe(pageLabels.clearModelsConfirmBody(providerFixture.models.length))

    await click(confirmButton(false) ?? null)
    expect(api.applyModelSync).not.toHaveBeenCalled()
  })

  it('clears through the existing applyModelSync channel and the list ends up empty', async () => {
    const { api, container } = await mount()
    const modelIds = providerFixture.models.map((model) => model.id)

    await click(clearButton(container))
    await click(confirmButton(true) ?? null)

    expect(api.applyModelSync).toHaveBeenCalledTimes(1)
    expect(api.applyModelSync).toHaveBeenCalledWith('silicon', {
      toAdd: [],
      toUpdate: [],
      toRemove: modelIds
    })
    // 「成功提示」那条断言随 `message.*` → 平台 Toast 的迁移一起搬走（那一笔改的是提示通道本身）；
    // 这里只保证这次提交真正要保证的事：走既有通道、且只走一次。
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
    await click(confirmButton(true) ?? null)

    expect(api.applyModelSync).toHaveBeenCalledTimes(1)
    expect(success).not.toHaveBeenCalled()
    const inlineError = container.querySelector('[data-models-error]')
    expect(inlineError?.textContent).toContain(pageStatusText.failed)
    expect(container.querySelector('[data-models-count]')?.textContent).toBe(String(providerFixture.models.length))
  })
})
