// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'

import { ModelServiceClearModelsControl } from './ModelServiceClearModelsControl'

/**
 * PLAT-72：「清空模型」按钮 + 二次确认。
 * 只测交互边界：何时可点、弹窗数量文案、取消不提交、确认只提交一次、失败不关窗。
 */
const labels = platformText['en-US'].models

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(modelCount: number, onConfirm: () => Promise<boolean> = async () => true): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ModelServiceClearModelsControl, { labels, modelCount, onConfirm }))
  })
  return container
}

function clearButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('[data-models-clear]')
  if (!button) throw new Error('Expected the clear button.')
  return button
}

/** `open` 状态用 data 属性暴露（antd 关闭动画在 happy-dom 里不落地，不能靠 DOM 增删判断）。 */
function modalOpen(container: HTMLElement): boolean {
  return clearButton(container).getAttribute('data-models-clear-open') === 'true'
}

function confirmBody(): string {
  return document.querySelector('[data-models-clear-confirm]')?.textContent ?? ''
}

async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error('Expected clickable element.')
  await act(async () => {
    ;(element as HTMLElement).click()
    await Promise.resolve()
  })
}

/** 工具条按钮与弹窗 OK 文案相同（都是「清空模型」），必须用 data 属性区分。 */
function modalButton(attribute: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[${attribute}]`)
}

describe('PLAT-72 clear models control', () => {
  it('is disabled when the provider has no models', async () => {
    const container = await mount(0)
    expect(clearButton(container).disabled).toBe(true)

    await click(clearButton(container))
    expect(modalOpen(container)).toBe(false)
  })

  it('is enabled with models, and the modal states how many will be deleted', async () => {
    const container = await mount(3)
    expect(clearButton(container).disabled).toBe(false)

    await click(clearButton(container))
    expect(document.querySelector('.ant-modal-title')?.textContent).toBe(labels.clearModelsConfirmTitle)
    expect(confirmBody()).toBe(labels.clearModelsConfirmBody(3))
    expect(modalButton('data-models-clear-confirm-button')).not.toBeNull()
    expect(modalButton('data-models-clear-cancel')).not.toBeNull()
  })

  it('deletes nothing when the confirmation is cancelled', async () => {
    const onConfirm = vi.fn(async () => true)
    const container = await mount(2, onConfirm)

    await click(clearButton(container))
    await click(modalButton('data-models-clear-cancel'))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(modalOpen(container)).toBe(false)
  })

  it('submits exactly once on confirm and closes the modal', async () => {
    const onConfirm = vi.fn(async () => true)
    const container = await mount(4, onConfirm)

    await click(clearButton(container))
    await click(modalButton('data-models-clear-confirm-button'))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(modalOpen(container)).toBe(false)
  })

  it('keeps the modal open when the clear fails', async () => {
    const onConfirm = vi.fn(async () => false)
    const container = await mount(2, onConfirm)

    await click(clearButton(container))
    await click(modalButton('data-models-clear-confirm-button'))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(modalOpen(container)).toBe(true)
  })
})
