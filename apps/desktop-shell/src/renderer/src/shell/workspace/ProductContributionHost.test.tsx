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

async function mount(load: () => Promise<unknown>, focusEntityId?: string): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ProductContributionHost, {
      language: 'zh-CN',
      load,
      ...(focusEntityId === undefined ? {} : { focusEntityId })
    }))
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

  it('keeps the raw error only inside the collapsed technical details', async () => {
    const container = await mount(failing('BOOM-RAW-ERROR'))

    const details = container.querySelector('details.state-view__details')
    expect(details).not.toBeNull()
    // 默认收起；摘要就是现成的那条「技术详情」。
    expect(details?.hasAttribute('open')).toBe(false)
    expect(details?.querySelector('summary')?.textContent).toBe('技术详情')
    expect(details?.textContent).toContain('BOOM-RAW-ERROR')

    // 折叠区之外零出现：去掉 fold 后整页不得再有原文；title 属性里也不许带。
    const outside = container.cloneNode(true) as HTMLElement
    outside.querySelector('details')?.remove()
    expect(outside.textContent ?? '').not.toContain('BOOM-RAW-ERROR')
    expect(
      [...container.querySelectorAll('[title]')].some((element) => (element.getAttribute('title') ?? '').includes('BOOM-RAW-ERROR'))
    ).toBe(false)
  })

  it('redacts the diagnostic before it reaches the fold', async () => {
    const raw = "Cannot find module '/Users/alice/proj/secret.ts' while fetching https://user:SUPERSECRETTOKEN@example.com/api?key=abcdefghijklmnop"
    const container = await mount(failing(raw))

    const fold = container.querySelector('details')?.textContent ?? ''
    expect(fold).toContain('~/secret.ts')
    expect(fold).not.toContain('/Users/alice')
    // URL 的值脱敏：userinfo 与 query 的值都不留，键保留。
    expect(fold).not.toContain('SUPERSECRETTOKEN')
    expect(fold).toContain('https://***@example.com/api?key=***')
  })
})

describe('the product contribution host focus id', () => {
  it('passes the id a notification pointed at through to the panel', async () => {
    let received: string | null | undefined
    const Panel = (props: { focusEntityId?: string | null }): React.ReactElement => {
      received = props.focusEntityId
      return createElement('div', null, 'panel')
    }
    const container = await mount(async () => ({ default: Panel }), 'mi-ar-1')

    expect(container.textContent).toBe('panel')
    expect(received).toBe('mi-ar-1')
  })
})
