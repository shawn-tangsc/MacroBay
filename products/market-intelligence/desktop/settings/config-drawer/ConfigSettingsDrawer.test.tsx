// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ConfigSettingsDrawer } from './ConfigSettingsDrawer'
import { DRAWER_MENUS, DRAWER_PREVIEW_SCREENS } from './drawerPreviewRows'

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.replaceChildren()
})

/** antd `Drawer` 走 portal：内容挂在 document 上，不在我给的容器里。 */
function mount(menu: (typeof DRAWER_MENUS)[number]): HTMLElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<ConfigSettingsDrawer initialMenu={menu} onClose={() => undefined} open />))
  return document.body
}

describe('config settings drawer (static layout)', () => {
  it('shows the six menus, with the current one marked once', () => {
    const body = mount('sources')
    const items = [...body.querySelectorAll<HTMLElement>('.config-drawer__nav-item')]
    expect(items).toHaveLength(6)
    expect(items.filter((item) => item.getAttribute('aria-current') === 'true')).toHaveLength(1)
  })

  it('exposes one DOM snapshot per screen, and every screen has rows', () => {
    // 交付证据：六屏快照。值一律占位符，这一版不接任何数据。
    const snapshots = DRAWER_PREVIEW_SCREENS.map((screen) => {
      document.body.replaceChildren()
      root?.unmount()
      root = undefined
      const body = mount(screen.menu)
      const pane = body.querySelector<HTMLElement>('.config-drawer')
      return { menu: screen.menu, markup: pane?.outerHTML ?? '', rows: pane?.querySelectorAll('.config-drawer__row').length ?? 0 }
    })
    expect(snapshots).toHaveLength(6)
    for (const snapshot of snapshots) {
      expect(snapshot.rows).toBeGreaterThan(0)
      expect(snapshot.markup).toContain('config-drawer__value')
    }
  })
})
