// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProductContributionHost } from './ProductContributionHost'

let root: Root | undefined
let reloadSpy: ReturnType<typeof vi.spyOn> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  reloadSpy?.mockRestore()
  reloadSpy = undefined
})

async function mount(load: () => Promise<unknown>): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ProductContributionHost, { language: 'zh-CN', load }))
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return container
}

const failing = (message: string) => async (): Promise<unknown> => {
  throw new Error(message)
}

describe('the product contribution host failure state', () => {
  it('shows the shared error view instead of a 42px heading', async () => {
    const container = await mount(failing('BOOM-RAW-ERROR'))

    const error = container.querySelector('.contribution-error')
    expect(error).not.toBeNull()
    expect(error?.querySelector('[data-state="error"]')).not.toBeNull()
    // 大字标题与重复产品名（eyebrow）都删掉：页面骨架已经在，失败态只是内容区的一格。
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('.eyebrow')).toBeNull()
  })

  it('reloads the page exactly once from the single action', async () => {
    reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined)
    const container = await mount(failing('BOOM-RAW-ERROR'))

    const action = container.querySelector<HTMLButtonElement>('.state-view__action')
    expect(action).not.toBeNull()
    expect(action?.textContent).toBe('重新载入界面')

    await act(async () => {
      action?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('offers no second action button next to the reload', async () => {
    const container = await mount(failing('BOOM-RAW-ERROR'))

    // 「重试」会把读者推回一个必然失败的 import；这一页只有一个动作，不给假出路。
    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(container.querySelectorAll('.state-view__action')).toHaveLength(1)
  })

  it('keeps the raw error out of every visible text', async () => {
    const container = await mount(failing('BOOM-RAW-ERROR'))

    // 这一批只做「不许出现」，不塞折叠区（技术细节是第二批）。
    expect(container.textContent ?? '').not.toContain('BOOM-RAW-ERROR')
    expect(container.innerHTML).not.toContain('BOOM-RAW-ERROR')
  })
})
