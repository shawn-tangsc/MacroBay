/**
 * Owner: platform/desktop/main/workspace。
 *
 * **2026-11-06 真机缺陷的回归用例**：情报页声明了「我是首页」（`home: true`）之后，菜单上看得见、点它却
 * 什么都不发生，日志里一个字都没有。根因不在壳层：
 *
 *   1. `WorkspaceRegistrationPolicy.pageFields` 是注册项的**字段白名单**，里面没有 `home`；
 *   2. 于是 `registry.register(...)` 整条拒绝；
 *   3. 而组合根对这个拒绝是 **fail-soft**（`catch {}` 只跳过那一页），所以那一页在 Main 的注册表里
 *      **根本不存在**；
 *   4. 壳层点它 → `openTab({ menuKey })` → `byMenuKey` 查不到 → `registration-missing`；
 *   5. 拒绝是**返回值**不是异常，于是没有 `catch`、没有日志、界面上只看到「点了没反应」。
 *
 * 这条用例走的是**组合根真实路径**（不是自己 new 一个注册表），所以第 3 步那个 fail-soft 吞不掉它：
 * 断言到「按菜单键能解析出这一页」为止，正是 openTab 用的那一步。
 */
import { describe, expect, it } from 'vitest'

import type { ProductManifest } from '@platform/product-manifest'
import { createComposedPageRegistry } from './workspacePageRegistryComposition'

function manifestWith(input: { home?: true; localId?: string } = {}): ProductManifest {
  const id = input.localId ?? 'overview'
  return {
    id: 'sample-addon',
    name: { 'zh-CN': '样例', 'en-US': 'Sample' },
    version: '1.0.0',
    shellContributions: {
      menuPages: [{
        id, title: { 'zh-CN': '总览', 'en-US': 'Overview' }, icon: 'home', order: 10,
        module: `./desktop/pages/${id}`,
        ...(input.home === true ? { home: true as const } : {})
      }],
      settingsSections: []
    },
    routes: [], navigation: [], settingsSections: [], serviceRoutes: [], tools: [], skills: [],
    agents: [], workflows: [], policies: [], evaluations: [], jobHandlers: [], migrations: []
  }
}

describe('默认首页那一页必须真的进 Main 的注册表（否则点它 registration-missing）', () => {
  it('声明 home 的页面经组合根注册成功，并按菜单键解析得到', () => {
    const registry = createComposedPageRegistry([manifestWith({ home: true })], ['sample-addon.overview'])

    // 是这条用例的核心：组合根的 fail-soft 会把非法贡献**静默跳过**，所以必须断言「能解析到」。
    expect(registry.byMenuKey('/sample-addon/overview')?.pageId).toBe('sample-addon.overview')
    expect(registry.get('sample-addon.overview')?.home).toBe(true)
  })

  it('对照：不声明 home 的页面同样注册成功（回归的是字段白名单，不是首页语义）', () => {
    const registry = createComposedPageRegistry([manifestWith()], ['sample-addon.overview'])

    expect(registry.byMenuKey('/sample-addon/overview')?.pageId).toBe('sample-addon.overview')
    expect(registry.get('sample-addon.overview')?.home).toBeUndefined()
  })
})
