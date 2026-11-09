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
