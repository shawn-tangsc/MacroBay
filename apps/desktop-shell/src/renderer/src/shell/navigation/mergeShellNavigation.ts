import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { GeneratedProductMenuEntry, GeneratedProductSettingsEntry } from '@platform/product-registry/types'
import { resolveMenuPageWorkspaceCapability } from '@platform/workspace/registry/workspacePageRegistry'
import type { LucideIcon } from 'lucide-react'

import { resolveLocalizedTitle, resolveShellIcon } from './shellIconRegistry'
import type { BuiltInNavItem, BuiltInSettingsPanel } from './builtInNavEntries'
import { createBuiltInNavItems, createBuiltInSettingsPanels } from './builtInNavEntries'

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
    allowMultipleInstances: item.allowMultipleInstances
  }))

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
        allowMultipleInstances: capability.allowMultipleInstances
      }
    })

  return [...builtInItems, ...productItems]
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
  const platformGroup: ShellSettingsNavGroup = {
    id: 'platform',
    title: null,
    kind: 'platform',
    panels: createBuiltInSettingsPanels(language).map<ShellSettingsPanelItem>((panel: BuiltInSettingsPanel) => ({
      key: panel.id,
      label: panel.label,
      icon: panel.icon,
      kind: 'built-in'
    }))
  }

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
    platformGroup,
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
