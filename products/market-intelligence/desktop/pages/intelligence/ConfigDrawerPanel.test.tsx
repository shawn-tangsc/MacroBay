// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Component, type ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfigSettingsDrawer } from '../../settings/config-drawer/ConfigSettingsDrawer'
import { ConfigDrawerPanel, type ConfigDrawerScreen } from './ConfigDrawerPanel'

const dashboard = readFileSync(
  resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/CryptoIntelligenceDashboard.tsx'),
  'utf8'
)

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

class Boom extends Component<{ children?: ReactNode }> {
  render(): ReactNode {
    throw new Error('panel exploded')
  }
}

/** 抽屉里的错误态：落在抽屉正文里，不落在页面主列上。 */
describe('configuration drawer panels keep their own failure inside the drawer', () => {
  it('renders the crash surface inside the drawer body, not in the page flow', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    act(() => {
      root!.render(
        <ConfigSettingsDrawer
          initialMenu="sources"
          onClose={() => undefined}
          open
          sourcesPanel={() => <ConfigDrawerPanel screen="sources"><Boom /></ConfigDrawerPanel>}
        />
      )
    })

    const drawerBody = document.querySelector('.ant-drawer-body')
    const failure = drawerBody?.querySelector('[data-state="error"]')
    expect(failure).not.toBeNull()
    // 页面主列里没有第二份：错误态只属于那一屏。
    expect(host.querySelector('[data-state="error"]')).toBeNull()
    // 技术详情里带得出是哪一屏（scope 进日志与详情）。
    expect(drawerBody!.textContent).toContain('config-drawer/sources')
  })

  it('wraps every screen the drawer receives, one boundary per screen', () => {
    // 一屏一层：少了任何一层，那一屏的崩溃就会落到外层（主列顶端）。
    //
    // 判据按**今天真实的接线形状**写：2026-11-11 起 `sourcesPanel` / `sourcesDataPanel` 是回调
    // （`(nav) => …`），因为抽屉内部导航要把定位交给那一屏；其余五屏仍是节点。所以这里用正则
    // 允许两种形状，仍钉住「这个 prop 的值就是它自己的那层边界」——而不是把断言删掉或放宽成
    // 「文件里出现过 ConfigDrawerPanel」。
    /*
      形状是**逐屏钉住**的，不是「两种都行」：
      - 来源两屏是回调（`(nav) => …`），抽屉内部导航靠它把定位交下去；谁把它改回节点形状，
        那条「点源名只在抽屉里换菜单」就断了，所以这里必须红；
      - 其余五屏是节点。
      两边都钉住，才既保住「每屏一层边界」又保住「两屏收抽屉给的导航」。
    */
    const screens: ReadonlyArray<[string, ConfigDrawerScreen, 'callback' | 'node']> = [
      ['analysisPanel', 'analysis', 'node'],
      ['briefingPanel', 'briefing', 'node'],
      ['processingPanel', 'processing', 'node'],
      ['runLogPanel', 'run-log', 'node'],
      ['notificationsPanel', 'notifications', 'node'],
      ['sourcesPanel', 'sources', 'callback'],
      ['sourcesDataPanel', 'sourcesData', 'callback']
    ]
    for (const [prop, screen, shape] of screens) {
      const wired = shape === 'callback'
        ? new RegExp(`${prop}=\\{\\(nav\\) => <ConfigDrawerPanel screen="${screen}">`, 'u')
        : new RegExp(`${prop}=\\{<ConfigDrawerPanel screen="${screen}">`, 'u')
      expect(dashboard, prop).toMatch(wired)
    }
    // 反向：边界不多也不少——每一层都是某个屏自己的。
    expect(dashboard.match(/ConfigDrawerPanel screen=/gu) ?? []).toHaveLength(screens.length)
  })
})
