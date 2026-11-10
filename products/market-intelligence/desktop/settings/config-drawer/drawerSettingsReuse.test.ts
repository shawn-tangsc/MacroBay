import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 抽屉里那两屏必须**复用同一份实现**，不许在抽屉里再画一套（用户 2026-11-12）。
 * 平台设置侧的三条注册已撤（用户 2026-11-11），判据改为源码级：抽屉 import 的就是
 * 那个设置入口 / 入口再导出的同一组件——注册没了，同源关系不能跟着断。
 */
const repo = process.cwd()
const read = (path: string): string => readFileSync(join(repo, path), 'utf8')

describe('抽屉屏与设置页入口同源', () => {
  it('run log: the drawer imports the one settings implementation', () => {
    const drawer = read('products/market-intelligence/desktop/pages/intelligence/RunLogDrawerPanel.tsx')
    expect(drawer).toContain("from '../../settings/run-log/index'")
  })

  it('sources: the drawer mounts the very component the registered entry renders', () => {
    const drawer = read('products/market-intelligence/desktop/pages/intelligence/DashboardSourcesPanel.tsx')
    expect(drawer).toContain("from '../../settings/intelligence-sources/SourcesSettingsPane'")
    const settingsEntry = read('products/market-intelligence/desktop/settings/intelligence-sources/index.tsx')
    expect(settingsEntry).toContain("from './SourcesSettingsPane'")
  })
})
