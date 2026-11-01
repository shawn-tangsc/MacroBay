// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MiSideDrawer } from './MiSideDrawer'

let root: Root | undefined
let host: HTMLDivElement | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
    title: '利率路径', closeLabel: '关闭', onClose, meta: createElement('span', null, '12-09')
  }, createElement('p', null, '内容'))))
  return host
}

describe('shared side drawer', () => {
  it('closes from its button and from Escape', async () => {
    const onClose = vi.fn()
    const dom = await render(onClose)
    expect(dom.querySelector('.mi-analysis-drawer')).not.toBeNull()
    await act(async () => dom.querySelector<HTMLButtonElement>('button')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
