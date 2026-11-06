// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'

import { platformText } from '../../i18n/platformText'

import { ModelServiceClearModelsControl } from './ModelServiceClearModelsControl'

/**
 * PLAT-72：「清空模型」按钮 + 二次确认。
 *
 * 这一组是平台 `confirm` 的**真渲染用例**：不 mock antd——mock 掉就等于只验了自己写的那几个参数。
 * 组件用 `useConfirm()` 取本树的实例，所以这里挂真的 `<ConfirmProvider>`（和 AppShell 里那层一样）。
 * 断言的是读者真的能看见、能点到的：
 * 标题、数量文案、危险钮、取消不提交、确认只提交一次、失败后还能再点一次；
 * 以及界面设计点名的**危险动作初始焦点在「取消」**——焦点落在破坏性按钮上，按住回车就是连续执行。
 */
const labels = platformText['en-US'].models

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

async function mount(
  modelCount: number,
  onConfirm: () => Promise<boolean> = async () => true
): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(ConfirmProvider, null, createElement(ModelServiceClearModelsControl, { labels, modelCount, onConfirm }))
    )
  })
  return container
}

function clearButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('[data-models-clear]')
  if (!button) throw new Error('Expected the clear button.')
  return button
}

/** 确认框由宿主内的实例通过 portal 挂到 `document.body`，不在组件的容器里。 */
function dialog(): Element | null {
  return document.querySelector('.ant-modal-confirm')
}

function confirmTitle(): string {
  return document.querySelector('.ant-modal-confirm-title')?.textContent ?? ''
}

function confirmBody(): string {
  return document.querySelector('.ant-modal-confirm-content')?.textContent ?? ''
}

function confirmButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button')]
}

function cancelButton(): HTMLButtonElement {
  const button = confirmButtons().find((entry) => !entry.classList.contains('ant-btn-primary'))
  if (!button) throw new Error('Expected the cancel button.')
  return button
}

function okButton(): HTMLButtonElement {
  const button = confirmButtons().find((entry) => entry.classList.contains('ant-btn-primary'))
  if (!button) throw new Error('Expected the confirm button.')
  return button
}

/** 放过一个宏任务：确认框是点下之后才挂载的，焦点也在挂载后一个 effect 里落。 */
async function settle(ms = 80): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error('Expected clickable element.')
  await act(async () => {
    ;(element as HTMLElement).click()
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

describe('PLAT-72 clear models control', () => {
  it('is disabled when the provider has no models, and opens nothing', async () => {
    const container = await mount(0)
    expect(clearButton(container).disabled).toBe(true)

    await click(clearButton(container))
    expect(dialog()).toBeNull()
  })

  it('states the count, and the confirming button is the dangerous one', async () => {
    const container = await mount(3)
    expect(clearButton(container).disabled).toBe(false)

    await click(clearButton(container))
    expect(confirmTitle()).toBe(labels.clearModelsConfirmTitle)
    expect(confirmBody()).toBe(labels.clearModelsConfirmBody(3))
    expect(okButton().textContent).toBe(labels.clearModels)
    expect(okButton().classList.contains('ant-btn-dangerous')).toBe(true)
    expect(cancelButton().textContent).toBe(labels.cancel)
  })

  it('puts the initial focus on cancel, never on the destructive button', async () => {
    const container = await mount(3)

    await click(clearButton(container))
    await settle()

    // 危险动作：回车落在「清空模型」上就是连续执行破坏性操作。
    expect(document.activeElement).toBe(cancelButton())
  })

  it('deletes nothing when the confirmation is cancelled', async () => {
    const onConfirm = vi.fn(async () => true)
    const container = await mount(2, onConfirm)

    await click(clearButton(container))
    await click(cancelButton())

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('submits exactly once on confirm', async () => {
    const onConfirm = vi.fn(async () => true)
    const container = await mount(4, onConfirm)

    await click(clearButton(container))
    await click(okButton())

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('keeps the confirmation usable when the clear did not apply, so the user can retry', async () => {
    // false = 调用方没清成（错误已在行内展示）；确认框必须还开着，否则读者连「再点一次」都没有。
    const onConfirm = vi.fn(async () => false)
    const container = await mount(2, onConfirm)

    await click(clearButton(container))
    await click(okButton())

    expect(onConfirm).toHaveBeenCalledTimes(1)
    // 还能再点一次 ⇒ 对话框没有关闭、危险钮已从 loading 恢复。
    expect(okButton().disabled).toBe(false)
    await click(okButton())
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })
})
