// 抽屉目录的「不接数据」守卫（文件头先说规则，再说为什么）：
//
// **文案不是数据。** 允许 `../../shared/i18n/` 这一个前缀，是因为接 i18n 只是读静态文本，
// 不会让抽屉开始读视图或 IPC；IPC / 视图 / service 仍然**一律红**。
// 允许名单只放这一个前缀，别再随手加第二条——加一条就等于给「顺手接个数据」开了口子。
// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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

  it('imports nothing from the data layer: the "no data" promise is falsifiable', () => {
    // 「不接数据」不是口头保证。抽屉目录里出现任何数据层 import 就该红——包括 IPC、视图、
    // 以及本产品自己的 service。允许的只有平台 UI 组件、React、图标、本目录的纯数据与样式。
    const dir = __dirname
    // **文案不算数据**：i18n 表是静态文本，接进来不会让抽屉开始读视图/IPC。
    // 真正要挡的是 IPC、视图、service 这些「会让这一版偷偷开始取数」的 import。
    const allowedPrefixes = ['react', 'react-dom', 'lucide-react', '@platform/ui/', './', '../../shared/i18n/']
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
      .flatMap((name) => readFileSync(join(dir, name), 'utf8').split('\n').flatMap((line, index) => {
        if (!/^import .* from '/u.test(line)) return []
        const specifier = /from '([^']+)'/u.exec(line)?.[1] ?? ''
        if (allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) return []
        return [`${name}:${index + 1} imports '${specifier}'`]
      }))
    expect(offenders).toEqual([])
  })
})
