import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { platformText } from '../../i18n/platformText'
import type { GeneratedProductMenuEntry, GeneratedProductSettingsEntry } from '@platform/product-registry/types'
import { resolveMenuPageWorkspaceCapability } from '@platform/workspace/registry/workspacePageRegistry'
import type { LucideIcon } from 'lucide-react'

import { resolveLocalizedTitle, resolveShellIcon } from './shellIconRegistry'
import type { BuiltInNavItem, BuiltInSettingsPanel } from './builtInNavEntries'
import {
  BUILT_IN_SETTINGS_GROUP_ORDER,
  createBuiltInNavItems,
  createBuiltInSettingsPanels,
  type BuiltInSettingsGroup
} from './builtInNavEntries'

/**
 * P2-01：一级菜单项同时是统一注册（workspace 页）的一条记录。
 * `key` 是可见菜单键（内置页 = pageId；产品页 = 产品路由路径），`pageId` 是稳定的全局页 id；
 * 能力默认值只来自 `WorkspacePageRegistrationPolicy`（`resolveMenuPageWorkspaceCapability`），
 * 因此缺扩展字段的既有产品菜单仍被注册为「可分离 + 单实例」，不隐藏、不报错。
 */
export interface ShellNavItem {
  key: string
  label: string
  icon: LucideIcon
  kind: 'built-in' | 'product'
  pageId: string
  menuKey: string
  supportsDetached: boolean
  allowMultipleInstances: boolean
  /** 「我是默认首页」的声明（`home?: true`）。菜单顺序用它：声明者排最前；未声明时**没有这个键**。 */
  home?: true
}

export interface ShellSidebarNavLayout {
  primaryItems: readonly ShellNavItem[]
  bottomItems: readonly ShellNavItem[]
}

export interface ShellSettingsPanelItem {
  key: string
  label: string
  icon: LucideIcon
  kind: 'built-in' | 'product'
  productId?: string
  productName?: string
}

export interface ShellSettingsNavGroup {
  id: string
  title: string | null
  kind: 'platform' | 'product'
  panels: readonly ShellSettingsPanelItem[]
}

export function mergeShellNavItems(
  language: AppLanguage,
  productMenuEntries: readonly GeneratedProductMenuEntry[]
): ShellNavItem[] {
  const builtInItems = createBuiltInNavItems(language).map<ShellNavItem>((item: BuiltInNavItem) => ({
    key: item.id,
    label: item.label,
    icon: item.icon,
    kind: 'built-in',
    pageId: item.pageId,
    menuKey: item.menuKey,
    supportsDetached: item.supportsDetached,
    allowMultipleInstances: item.allowMultipleInstances,
    ...(item.home === true ? { home: true as const } : {})
  }))

  /**
   * 稳定排序：`order` 相同的两项保持**注册顺序**（`Array.prototype.sort` 自 ES2019 起是稳定排序，
   * 这里依赖的是规范，不是引擎实现）。契约 §4c 把它列成硬约束：不稳定排序的症状是「有时这个在前、
   * 有时那个在前」，那种偶发最难查。用例 `order 相同 ⇒ 多次结果一致` 钉住这一点。
   */
  const productItems = [...productMenuEntries]
    .sort((left, right) => left.order - right.order)
    .map<ShellNavItem>((entry) => {
      const capability = resolveMenuPageWorkspaceCapability({ workspace: entry.workspace })
      return {
        key: entry.routePath,
        label: resolveLocalizedTitle(entry.title, language),
        icon: resolveShellIcon(entry.icon),
        kind: 'product',
        pageId: entry.id,
        menuKey: entry.routePath,
        supportsDetached: capability.supportsDetached,
        allowMultipleInstances: capability.allowMultipleInstances,
        ...(entry.home === true ? { home: true as const } : {})
      }
    })

  return orderShellNavItems([...builtInItems, ...productItems])
}

/**
 * 菜单顺序的**唯一**实现：声明了 `home` 的那一项排最前，其余保持各自相对次序。
 *
 * 为什么是「规则」而不是把 `order` 调成 0：首页是**可配置**的（用户 2026-11-06 要的是「改配置就能指定
 * 任何首页」）。靠手改排序号，换一次首页就要再改一次号，而且改号会打乱别人相对次序的意图。
 *
 * 与 `resolveHomeMenuKey` 是**两件事**，别合并：那个函数回答「首次打开落在哪一页」，这里回答「菜单怎么排」。
 * 一条是行为，一条是呈现；把它们揉进一个函数，将来「首页不在第一位」或「第一位不是首页」都做不了。
 *
 * 三条边界，都由用例钉住：
 *  - 零个 `home` ⇒ 原样返回（**不许**退化成「把第一项提到前面」这种近似行为）；
 *  - 内置页与产品页一视同仁（`kind` 不参与判断）；
 *  - 两个 `home` 是错误状态，红在注册那条红线里；这里仍给确定结果（取第一个声明者）。
 */
export function orderShellNavItems(items: readonly ShellNavItem[]): ShellNavItem[] {
  const homeIndex = items.findIndex((item) => item.home === true)
  if (homeIndex <= 0) return [...items]
  const ordered = [...items]
  const [homeItem] = ordered.splice(homeIndex, 1)
  return [homeItem!, ...ordered]
}

export function splitShellSidebarNavItems(navItems: readonly ShellNavItem[]): ShellSidebarNavLayout {
  return {
    primaryItems: navItems.filter((item) => item.key !== 'settings'),
    bottomItems: navItems.filter((item) => item.key === 'settings')
  }
}

export function groupShellSettingsPanels(
  language: AppLanguage,
  productSettingsEntries: readonly GeneratedProductSettingsEntry[]
): ShellSettingsNavGroup[] {
  const t = platformText[language]
  // 平台设置按原型分成四组，组标题与左导航其他分组标题同级；顺序固定，不按字母排。
  // 分组是**导航的呈现口径**，不改任何页面的 id 或可访问性（页面本身仍按 id 路由）。
  const platformPanels = createBuiltInSettingsPanels(language)
  const groupTitles: Record<BuiltInSettingsGroup, string> = {
    models: t.settings.settingsNavGroupModels,
    system: t.settings.settingsNavGroupSystem,
    notify: t.settings.settingsNavGroupNotify,
    other: t.settings.settingsNavGroupOther
  }
  const platformGroups: ShellSettingsNavGroup[] = BUILT_IN_SETTINGS_GROUP_ORDER.map((group) => ({
    id: `platform-${group}`,
    title: groupTitles[group],
    kind: 'platform' as const,
    panels: platformPanels
      .filter((panel: BuiltInSettingsPanel) => panel.group === group)
      .map<ShellSettingsPanelItem>((panel: BuiltInSettingsPanel) => ({
        key: panel.id,
        label: panel.label,
        icon: panel.icon,
        kind: 'built-in'
      }))
  })).filter((group) => group.panels.length > 0)

  const productGroups = new Map<string, ShellSettingsNavGroup>()
  for (const entry of [...productSettingsEntries].sort((left, right) => left.order - right.order)) {
    let group = productGroups.get(entry.productId)
    if (!group) {
      group = {
        id: entry.productId,
        title: resolveLocalizedTitle(entry.productName, language),
        kind: 'product',
        panels: []
      }
      productGroups.set(entry.productId, group)
    }

    group.panels = [
      ...group.panels,
      {
        key: entry.id,
        label: resolveLocalizedTitle(entry.title, language),
        icon: resolveShellIcon(entry.icon),
        kind: 'product',
        productId: entry.productId,
        productName: resolveLocalizedTitle(entry.productName, language)
      }
    ]
  }

  return [
    ...platformGroups,
    ...Array.from(productGroups.values()).sort((left, right) => (left.title ?? '').localeCompare(right.title ?? ''))
  ]
}

export function findProductMenuEntry(
  activeKey: string,
  productMenuEntries: readonly GeneratedProductMenuEntry[]
): GeneratedProductMenuEntry | undefined {
  return productMenuEntries.find((entry) => entry.routePath === activeKey)
}

export function findProductSettingsEntry(
  activeKey: string,
  productSettingsEntries: readonly GeneratedProductSettingsEntry[]
): GeneratedProductSettingsEntry | undefined {
  return productSettingsEntries.find((entry) => entry.id === activeKey)
}
