import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const drawerSource = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/DashboardPanelDrawer.tsx'), 'utf8')
const css = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/intelligence.css'), 'utf8')

describe('market-intelligence drawer drag regions', () => {
  it('marks the source drawer no-drag so its close button can receive clicks', () => {
    // The portal drawer sits under the window drag strip; without this class the close button is
    // visually present but treated as a window-drag handle.
    expect(drawerSource).toContain('className="mi-dashboard-source-drawer"')
    expect(css).toContain('.mi-dashboard-source-drawer,')
    expect(css).toContain('-webkit-app-region: no-drag;')
  })
})
