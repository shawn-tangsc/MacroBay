// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MiSideDrawer } from './MiSideDrawer'

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

const render = async (onClose: () => void) => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(MiSideDrawer, {
    title: '利率路径', closeLabel: '关闭', onClose, meta: createElement('span', null, '12-09'),
    children: createElement('p', null, '内容')
  })))
  return host
}

describe('stacked side drawers', () => {
  function mountDrawer(onClose: () => void, options: { returnFocusTo?: HTMLElement | null } = {}): { host: HTMLDivElement; root: Root } {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(MiSideDrawer, {
      title: '叠层', closeLabel: '关闭', onClose, ...(options.returnFocusTo !== undefined ? { returnFocusTo: options.returnFocusTo } : {}),
      children: createElement('p', null, '内容')
    })))
    return { host, root }
  }

  it('closes only the top drawer on Escape; the bottom one stays until the next Escape', () => {
    const bottom = vi.fn()
    const top = vi.fn()
    const first = mountDrawer(bottom)
    const second = mountDrawer(top)
    try {
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
      expect(top).toHaveBeenCalledTimes(1)
      expect(bottom).not.toHaveBeenCalled()
    } finally {
      act(() => { second.root.unmount() })
      act(() => { first.root.unmount() })
      second.host.remove()
      first.host.remove()
    }
  })

  it('returns focus to the trigger element when it unmounts', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    const drawer = mountDrawer(vi.fn(), { returnFocusTo: trigger })
    try {
      expect(document.activeElement).not.toBe(trigger)
    } finally {
      act(() => { drawer.root.unmount() })
      expect(document.activeElement).toBe(trigger)
      drawer.host.remove()
      trigger.remove()
    }
  })
})

describe('shared side drawer', () => {
  it('closes from its button and from Escape', async () => {
    const onClose = vi.fn()
    const dom = await render(onClose)
    expect(dom.querySelector('.mi-analysis-drawer')).not.toBeNull()
    const close = dom.querySelector<HTMLButtonElement>('button')!
    // 关闭键是共享的那一枚：平台键给读屏名、sm 档 22px，而不是各壳自己写 aria-label。
    expect(close.getAttribute('aria-label')).toBe('关闭抽屉')
    expect(close.className).toContain('icon-button--sm')
    await act(async () => close.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
