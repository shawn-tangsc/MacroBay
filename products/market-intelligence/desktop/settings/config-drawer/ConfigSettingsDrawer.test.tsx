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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfigSettingsDrawer } from './ConfigSettingsDrawer'
import type { DrawerRowView, DrawerScreenView, DrawerSourcesView } from './drawerScreenView'
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


/** 平台屏的挂载助手：这两条用例只差「传了哪些值」。 */
function openPlatform(values: Record<string, string>, onOpen: (target: string) => void = () => undefined): HTMLElement {
  document.body.replaceChildren()
  root?.unmount()
  root = undefined
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(
    <ConfigSettingsDrawer
      initialMenu="platform"
      onClose={() => undefined}
      onOpenPlatformSettings={onOpen as never}
      open
      platformValues={values}
      resolveText={(key) => key} />
  ))
  return document.body
}


/** 来源屏的挂载助手：只差「宿主读了什么」。 */
function openSources(view: DrawerSourcesView, onSelect: (sourceId: string) => void = () => undefined): HTMLElement {
  document.body.replaceChildren()
  root?.unmount()
  root = undefined
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(
    <ConfigSettingsDrawer
      initialMenu="sources"
      onClose={() => undefined}
      onSelectSource={onSelect}
      open
      resolveText={(key) => key}
      sourcesView={view} />
  ))
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

  it('tells "could not read" from "nothing there", and retries', () => {
    // 两种「空」长得像，必须分别断言：读不到 → error + 重试；确实没有 → empty。
    const onRetry = vi.fn()
    const open = (view: DrawerScreenView<DrawerRowView>): HTMLElement => {
      document.body.replaceChildren()
      root?.unmount()
      root = undefined
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      act(() => root?.render(
        <ConfigSettingsDrawer initialMenu="notifications" notificationsView={view} onClose={() => undefined} open />
      ))
      return document.body
    }

    const failed = open({ state: 'error', onRetry })
    expect(failed.querySelector('[data-drawer-screen="error"]')).not.toBeNull()
    expect(failed.querySelector('[data-drawer-screen="empty"]')).toBeNull()
    act(() => { failed.querySelector<HTMLElement>('.state-view__action')?.click() })
    expect(onRetry).toHaveBeenCalledTimes(1)

    const empty = open({ state: 'ready', rows: [] })
    expect(empty.querySelector('[data-drawer-screen="empty"]')).not.toBeNull()
    expect(empty.querySelector('[data-drawer-screen="error"]')).toBeNull()
  })

  it('renders the host rows, a per-row disabled property and an inline action', () => {
    document.body.replaceChildren()
    root?.unmount()
    root = undefined
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const onSelect = vi.fn()
    act(() => root?.render(
      <ConfigSettingsDrawer
        initialMenu="notifications"
        notificationsView={{ state: 'ready', rows: [
          { key: 'pushStrength', value: '最低强度' },
          { key: 'masterSwitch', value: '关', disabled: true, action: { labelKey: 'test', onSelect } }
        ] }}
        onClose={() => undefined}
        open />
    ))

    // 每屏根节点必须存在——只断「没报错」抓不到「什么都没渲染」。
    expect(document.querySelector('[data-drawer-screen="ready"]')).not.toBeNull()
    const rows = [...document.querySelectorAll<HTMLElement>('[data-drawer-row]')]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.querySelector('.config-drawer__value')?.textContent).toBe('最低强度')
    expect(rows[1]?.className).toContain('is-disabled')
    expect(rows[0]?.className).not.toContain('is-disabled')
    act(() => { rows[1]?.querySelector<HTMLElement>('.config-drawer__row-action')?.click() })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows the values the host passed', () => {
    // 与下一条成对、互不替代：这条只证明「传了值就显示值」，不证明缺值怎么画。
    const container = openPlatform({
      timeZone: 'Asia/Shanghai',
      language: '中文',
      theme: '深色',
      proxy: '系统代理',
      modelService: '已配置'
    })
    const rows = [...container.querySelectorAll<HTMLElement>('[data-drawer-row]')]
    expect(rows.map((row) => row.querySelector('.config-drawer__value')?.textContent))
      .toEqual(['Asia/Shanghai', '中文', '深色', '系统代理', '已配置'])
    expect(container.textContent).not.toContain('configDrawer.unreadable')
  })

  it('shows "could not read" for a missing platform value, never a blank cell', () => {
    // 这一屏最容易把「没读到」画成「没设置」：缺键必须显示读不到，且不是空串。
    const container = openPlatform({ timeZone: 'Asia/Shanghai' })
    const rows = [...container.querySelectorAll<HTMLElement>('[data-drawer-row]')]
    expect(rows).toHaveLength(5)
    for (const row of rows.slice(1)) {
      const cell = row.querySelector('.config-drawer__value')?.textContent ?? ''
      expect(cell).toBe('configDrawer.unreadable')
      expect(cell.trim()).not.toBe('')
    }
  })

  it('sends the row action to the host with the navigation target', () => {
    const onOpen = vi.fn()
    const container = openPlatform({ timeZone: 'Asia/Shanghai' }, onOpen)
    const rows = [...container.querySelectorAll<HTMLElement>('[data-drawer-row]')]
    act(() => { rows[4]?.querySelector<HTMLElement>('.config-drawer__row-action')?.click() })
    expect(onOpen).toHaveBeenCalledWith('models')
  })

  it('shows the sources the host read, and reports the selection back', () => {
    const onSelect = vi.fn()
    const container = openSources(
      { state: 'ready', rows: [
        { sourceId: 'bls', name: 'BLS 官方日历', statusLabel: '不可用', enabled: true },
        { sourceId: 'fed', name: 'Fed 官方日历', enabled: false }
      ] },
      onSelect
    )
    expect(container.querySelector('[data-drawer-screen="ready"]')).not.toBeNull()
    const items = [...container.querySelectorAll<HTMLElement>('[data-drawer-source]')]
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('BLS 官方日历')
    expect(items[0]?.textContent).toContain('不可用')
    act(() => { items[1]?.click() })
    expect(onSelect).toHaveBeenCalledWith('fed')
  })

  it('tells "could not read the sources" from "there are no sources"', () => {
    // 两条分开断言：读不到 → error + 重试；确实没有源 → empty。
    const onRetry = vi.fn()
    const failed = openSources({ state: 'error', onRetry })
    expect(failed.querySelector('[data-drawer-screen="error"]')).not.toBeNull()
    expect(failed.querySelector('[data-drawer-screen="empty"]')).toBeNull()
    act(() => { failed.querySelector<HTMLElement>('.state-view__action')?.click() })
    expect(onRetry).toHaveBeenCalledTimes(1)

    const empty = openSources({ state: 'ready', rows: [] })
    expect(empty.querySelector('[data-drawer-screen="empty"]')).not.toBeNull()
    expect(empty.querySelector('[data-drawer-screen="error"]')).toBeNull()
  })
})
