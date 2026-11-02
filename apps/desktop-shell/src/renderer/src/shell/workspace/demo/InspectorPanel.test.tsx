// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { InspectorPanel } from './InspectorPanel'
import { platformText } from '../../../i18n/platformText'

/**
 * Owner: apps/desktop-shell renderer / workspace demo 面板内容。
 * 权威：P1-03 纠偏裁决 §4/§10（内容状态必须独立保留，测试必须推动真实 UI）。
 * 这里验证内容组件自身的草稿与选中状态在宿主停靠位置变化（父级重渲染）后仍然保留。
 * 端到端的换区域/换 Tab 保活由 WorkspacePanelHost.test.tsx 覆盖。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
})

describe('InspectorPanel', () => {
  it('keeps its draft and selection state while the hosting dock mode changes', async () => {
    let changeDock: (dock: 'docked-right' | 'docked-bottom') => void = () => undefined
    function Host(): React.ReactElement {
      const [dock, setDock] = useState<'docked-right' | 'docked-bottom'>('docked-right')
      changeDock = setDock
      return createElement('section', { 'data-dock': dock }, createElement(InspectorPanel))
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => { root!.render(createElement(Host)) })

    const input = container.querySelector<HTMLInputElement>('input')
    const select = container.querySelector<HTMLButtonElement>('button')
    expect(input).not.toBeNull()
    expect(select).not.toBeNull()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'draft survives')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
      select!.click()
    })
    expect(input!.value).toBe('draft survives')
    expect(container.textContent).toContain(platformText['zh-CN'].workspace.inspectorSelected)
    expect(container.querySelector('[data-dock]')?.getAttribute('data-dock')).toBe('docked-right')

    await act(async () => { changeDock('docked-bottom') })

    expect(container.querySelector('[data-dock]')?.getAttribute('data-dock')).toBe('docked-bottom')
    expect(container.querySelector('input')).toBe(input)
    expect(input!.value).toBe('draft survives')
    expect(container.textContent).toContain(platformText['zh-CN'].workspace.inspectorSelected)
  })
})
