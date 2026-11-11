// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CellStateCard } from './DashboardCellState'

let root: Root | undefined
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren() })

function render(node: React.ReactElement): HTMLDivElement {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
  return host
}

describe('整卡级与行级的三态', () => {
  it('uses the platform state surface for a whole card, with one action each', () => {
    const onEnable = vi.fn()
    const disabled = render(createElement(CellStateCard, { kind: 'disabled', label: '数据未被启用', onSelect: onEnable }))
    const disabledSurface = disabled.querySelector('[data-state="disabled"]')!
    expect(disabledSurface).not.toBeNull()
    expect(disabledSurface.querySelectorAll('button')).toHaveLength(1)
    act(() => disabledSurface.querySelector<HTMLButtonElement>('button')!.click())
    expect(onEnable).toHaveBeenCalledTimes(1)

    const onRetry = vi.fn()
    const unreadable = render(createElement(CellStateCard, { kind: 'unreadable', label: '暂时读不到', onSelect: onRetry }))
    const errorSurface = unreadable.querySelector('[data-state="error"]')!
    expect(errorSurface).not.toBeNull()
    expect(errorSurface.querySelectorAll('button')).toHaveLength(1)
  })

})
