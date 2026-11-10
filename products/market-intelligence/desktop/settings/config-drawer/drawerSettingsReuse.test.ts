import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 抽屉里那两屏必须**复用注册表暴露的同一份实现**，不许在抽屉里再画一套（用户 2026-11-12）。
 * 判据是源码级：抽屉 import 的就是 manifest `settingsSections[].module` 指向的入口 / 同一组件。
 */
const repo = process.cwd()
const read = (path: string): string => readFileSync(join(repo, path), 'utf8')

describe('抽屉屏与平台设置注册同源', () => {
  it('run log: the drawer imports the registered module itself', () => {
    const drawer = read('products/market-intelligence/desktop/pages/intelligence/RunLogDrawerPanel.tsx')
    expect(drawer).toContain("from '../../settings/run-log/index'")
    // 注册表指向的就是这个入口。
    const manifest = read('products/market-intelligence/product.manifest.ts')
    expect(manifest).toContain("module: './desktop/settings/run-log'")
  })

  it('sources: the drawer mounts the very component the registered entry renders', () => {
    const drawer = read('products/market-intelligence/desktop/pages/intelligence/DashboardSourcesPanel.tsx')
    expect(drawer).toContain("from '../../settings/intelligence-sources/SourcesSettingsPane'")
    const settingsEntry = read('products/market-intelligence/desktop/settings/intelligence-sources/index.tsx')
    expect(settingsEntry).toContain("from './SourcesSettingsPane'")
    const manifest = read('products/market-intelligence/product.manifest.ts')
    expect(manifest).toContain("module: './desktop/settings/intelligence-sources'")
  })
})
