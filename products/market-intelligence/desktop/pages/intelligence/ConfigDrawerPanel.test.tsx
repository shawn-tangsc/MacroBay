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
          sourcesPanel={<ConfigDrawerPanel screen="sources"><Boom /></ConfigDrawerPanel>}
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
    const screens: ReadonlyArray<[string, ConfigDrawerScreen]> = [
      ['analysisPanel', 'analysis'],
      ['briefingPanel', 'briefing'],
      ['processingPanel', 'processing'],
      ['runLogPanel', 'run-log'],
      ['notificationsPanel', 'notifications'],
      ['sourcesPanel', 'sources']
    ]
    for (const [prop, screen] of screens) {
      expect(dashboard, prop).toContain(`${prop}={<ConfigDrawerPanel screen="${screen}">`)
    }
  })
})
