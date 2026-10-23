import { describe, expect, it } from 'vitest'

import type { ProductMenuPageContribution } from '../../product-manifest'
import { toProductRoutePath } from '../../product-registry/validate'
import { WorkspaceRegistrationError, type WorkspacePageRegistration } from '../contracts'
import { WorkspaceRegistrationPolicy } from '../policies'
import { builtInWorkspacePages } from './builtInWorkspacePages'
import {
  createWorkspacePageRegistry,
  toProductWorkspacePage,
  toWorkspacePageId,
  toWorkspacePageMenuKey
} from './workspacePageRegistry'

/**
 * P2-01 focused：一级菜单统一注册（内置三项 + 全部产品菜单页）。
 * 断言只依赖注册本身的语义：集合、能力默认值、文案来源互斥、菜单键规则与拒绝路径。
 */

const legacyContribution: ProductMenuPageContribution = {
  id: 'legacy-page',
  title: { 'zh-CN': '旧页', 'en-US': 'Legacy' },
  icon: 'home',
  order: 1,
  module: './desktop/pages/legacy'
}

function registryOf(pages: readonly WorkspacePageRegistration[]) {
  const registry = createWorkspacePageRegistry({
    moduleIds: pages.map((page) => page.module),
    productIds: [...new Set(pages.flatMap((page) => (page.productId === undefined ? [] : [page.productId])))]
  })
  pages.forEach((page) => registry.register(page))
  registry.seal()
  return registry
}

describe('workspace page registry（P2-01 一级菜单统一注册）', () => {
  it('把内置三项注册为顶层页，Settings 子面板不占据顶层', () => {
    const registry = registryOf(builtInWorkspacePages)

    expect(registry.list().map((summary) => summary.id)).toEqual(['assistants', 'agents', 'settings'])
    expect(registry.list().map((summary) => summary.menuKey)).toEqual(['assistants', 'agents', 'settings'])
    expect(registry.list().every((summary) => summary.kind === 'page')).toBe(true)
    // 技术设计 §3.3：每个一级菜单都 supportsDetached；内置页固定单实例（§3.4）
    expect(registry.list().every((summary) => summary.supportsDetached)).toBe(true)
    expect(registry.list().every((summary) => summary.allowMultipleInstances === false)).toBe(true)
    // Settings 内部二级面板不是一级菜单，绝不能出现在统一注册的顶层页里
    const settingsPanelIds = [
      'models', 'assistant-library', 'web-search', 'storage-cache',
      'task-automation', 'channels', 'preferences', 'notifications'
    ]
    expect(settingsPanelIds.filter((id) => registry.list().some((summary) => summary.id === id))).toEqual([])
    expect(registry.get('settings')?.titleKey).toBe('nav.settings')
    expect(registry.get('settings')?.title).toBeUndefined()
  })

  it('把缺扩展字段的有效旧菜单注册为默认可分离的顶层页（向后兼容，不丢菜单、不报错）', () => {
    const page = toProductWorkspacePage('legacy-addon', legacyContribution)

    expect(page).toMatchObject({
      pageId: 'legacy-addon.legacy-page',
      menuKey: '/legacy-addon/legacy-page',
      productId: 'legacy-addon',
      icon: 'home',
      module: 'legacy-addon.legacy-page',
      supportsDetached: true,
      allowMultipleInstances: false,
      binding: { persistence: 'none', maxKeyBytes: WorkspaceRegistrationPolicy.maxBindingKeyBytes }
    })
    expect(page.title).toEqual(legacyContribution.title)
    expect(page.titleKey).toBeUndefined()

    const registry = registryOf([page])
    expect(registry.list()).toEqual([{
      id: 'legacy-addon.legacy-page',
      kind: 'page',
      menuKey: '/legacy-addon/legacy-page',
      title: legacyContribution.title,
      supportsDetached: true,
      allowMultipleInstances: false
    }])
    expect(registry.byMenuKey('/legacy-addon/legacy-page')?.pageId).toBe('legacy-addon.legacy-page')
  })

  it('产品页的 pageId / menuKey 与生成器使用的全局 id 和路由路径同规则', () => {
    expect(toWorkspacePageId('sample-product', 'trades')).toBe('sample-product.trades')
    expect(toWorkspacePageMenuKey('sample-product', 'trades')).toBe(toProductRoutePath('sample-product', 'trades'))
    expect(toWorkspacePageMenuKey('sample-product', 'trades')).toBe('/sample-product/trades')
  })

  it('拒绝把不可分离的顶层页注册进统一注册', () => {
    const page = toProductWorkspacePage('legacy-addon', legacyContribution)
    const registry = createWorkspacePageRegistry({ moduleIds: [page.module], productIds: ['legacy-addon'] })
    expect(() => registry.register({ ...page, supportsDetached: false }))
      .toThrowError(new WorkspaceRegistrationError('invalid-registration', 'supportsDetached'))
  })

  it('校验文案来源互斥、图标、模块 allowlist、产品 allowlist 与菜单键规则', () => {
    const page = toProductWorkspacePage('legacy-addon', legacyContribution)
    const fresh = () => createWorkspacePageRegistry({ moduleIds: [page.module], productIds: ['legacy-addon'] })

    expect(() => fresh().register({ ...page, titleKey: 'nav.legacy' }))
      .toThrowError(new WorkspaceRegistrationError('invalid-registration', 'titleKey'))
    expect(() => fresh().register({ ...page, title: undefined }))
      .toThrowError(new WorkspaceRegistrationError('invalid-registration', 'title'))
    expect(() => fresh().register({ ...page, icon: 'not-a-shell-icon' }))
      .toThrowError(new WorkspaceRegistrationError('invalid-registration', 'icon'))
    expect(() => fresh().register({ ...page, module: 'legacy-addon.other' }))
      .toThrowError(new WorkspaceRegistrationError('invalid-registration', 'module'))
    expect(() => fresh().register({ ...page, productId: 'other-addon' }))
      .toThrowError(new WorkspaceRegistrationError('invalid-registration', 'productId'))
    expect(() => fresh().register({ ...page, menuKey: '/legacy-addon/other' }))
      .toThrowError(new WorkspaceRegistrationError('invalid-registration', 'menuKey'))
  })

  it('拒绝重复页、未 seal 前读取与 seal 后继续注册，且不改写已注册条目', () => {
    const page = toProductWorkspacePage('legacy-addon', legacyContribution)
    const source = { ...page, title: { 'zh-CN': '旧页', 'en-US': 'Legacy' } }
    const registry = createWorkspacePageRegistry({ moduleIds: [page.module], productIds: ['legacy-addon'] })
    expect(() => registry.list()).toThrowError(new WorkspaceRegistrationError('registry-not-sealed'))
    registry.register(source)
    source.title['en-US'] = 'Mutated outside'
    expect(() => registry.register({ ...page })).toThrowError(new WorkspaceRegistrationError('duplicate-registration', 'pageId'))
    registry.seal()
    expect(registry.get('legacy-addon.legacy-page')?.title?.['en-US']).toBe('Legacy')
    expect(registry.list()).toHaveLength(1)
    expect(() => registry.register({ ...page, pageId: 'legacy-addon.third', menuKey: '/legacy-addon/third' }))
      .toThrowError(new WorkspaceRegistrationError('registry-sealed'))
    expect(registry.get('missing')).toBeUndefined()
  })

  it('内置页描述是不可变数据，外部改写无法改变注册结果', () => {
    expect(Object.isFrozen(builtInWorkspacePages)).toBe(true)
    expect(Object.isFrozen(builtInWorkspacePages[0])).toBe(true)
    expect(Object.isFrozen(builtInWorkspacePages[0]?.binding)).toBe(true)
  })
})
