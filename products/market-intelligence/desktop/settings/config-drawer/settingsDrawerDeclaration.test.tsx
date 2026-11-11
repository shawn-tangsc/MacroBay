// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { ConfigSettingsDrawer } from './ConfigSettingsDrawer'
import { DRAWER_MENUS } from './drawerPreviewRows'

/**
 * 声明与抽屉必须是**同一份事实**（架构师 2026-11-11 签）：
 * 壳层敢渲染「去设置」，前提是产品真能兑现。所以
 *
 * 1. `product.manifest.ts` 的 `settingsDrawer` 菜单集 == 抽屉自己的 `DRAWER_MENUS`；
 *    守卫**从抽屉取集合**，不在测试里再抄一份 id 列表（抄一份就多一处会漂的事实）。
 * 2. 每个声明的 id 都能真的打开：以它为初始菜单渲染，面板在位、左栏那一项是当前项。
 *
 * 反向：声明里多一个不存在的 id（或删一个），第 1 条红；画不出那一屏，第 2 条红。
 */
const labels = productText['zh-CN'].pages.intelligence.portal.dashboard.configDrawer.menus as Readonly<Record<string, string>>

function declaredMenuIds(): readonly string[] {
  return (marketIntelligenceProductManifest.shellContributions?.settingsDrawer ?? []).map((menu) => menu.id)
}

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('settingsDrawer 声明 = 抽屉实际菜单集', () => {
  it('declares exactly the drawer menus, each exactly once', () => {
    const declared = declaredMenuIds()
    expect(declared.length).toBeGreaterThan(0)
    // 集合相等（顺序以抽屉为准，声明顺序不构成第二套顺序）。
    expect([...declared].sort()).toEqual([...DRAWER_MENUS].sort())
    expect(new Set(declared).size).toBe(declared.length)
  })

  it('opens a real screen for every declared menu', async () => {
    for (const menu of declaredMenuIds()) {
      const host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      await act(async () => {
        root?.render(<ConfigSettingsDrawer initialMenu={menu as never} onClose={() => undefined} open />)
      })
      const pane = document.body.querySelector('[data-drawer-pane="true"]')
      expect(pane, `menu ${menu} has no pane`).not.toBeNull()
      const active = [...document.body.querySelectorAll<HTMLElement>('.settings-nav-item')]
        .filter((item) => item.getAttribute('aria-current') === 'page')
      expect(active, `menu ${menu} is not the current item`).toHaveLength(1)
      expect(active[0]?.textContent?.trim()).toBe(labels[menu])
      await act(async () => root?.unmount())
      root = undefined
      document.body.replaceChildren()
    }
  })
})
