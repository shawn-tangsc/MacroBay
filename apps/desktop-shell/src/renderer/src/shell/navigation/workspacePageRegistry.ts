import type { GeneratedProductMenuEntry } from '@platform/product-registry/types'
import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { BuiltInWorkspacePageId } from '@platform/workspace/registry/builtInWorkspacePages'
import { resolveMenuPageWorkspaceCapability } from '@platform/workspace/registry/workspacePageRegistry'
import type { LucideIcon } from 'lucide-react'

import { resolveLocalizedTitle, resolveShellIcon } from './shellIconRegistry'
import { createBuiltInNavItems } from './builtInNavEntries'

/**
 * Owner: shell/navigation（P2-01）。权威：技术设计 §3.3/§3.4 与 A-T01。
 * **Shell 本地 loader 投影**：Main 只持有纯描述注册（pageId/menuKey/能力），页面的真实 loader
 * 由 shell 本地提供，绝不由 renderer 上报回 Main 作为信任来源。
 * 一致性判据：`menuKey`/`pageId` 与 `mergeShellNavItems`、Main 注册源逐项相等；
 * 能力默认值复用平台的 `resolveMenuPageWorkspaceCapability`，避免两套默认值分叉。
 * 任何缺失（内置 loader 缺项、重复 pageId/menuKey）一律 fail closed，不静默降级。
 */

export type ShellWorkspacePageLoader = () => Promise<unknown>

export interface ShellWorkspacePage {
  pageId: string
  menuKey: string
  label: string
  icon: LucideIcon
  kind: 'built-in' | 'product'
  supportsDetached: boolean
  allowMultipleInstances: boolean
  load: ShellWorkspacePageLoader
}

export interface ShellWorkspacePageRegistryOptions {
  language: AppLanguage
  productMenuEntries: readonly GeneratedProductMenuEntry[]
  /** 内置页 loader：由 shell 组合根注入（导航层不反向 import 页面组件）。缺项即 fail closed。 */
  builtInPageLoaders: Partial<Record<BuiltInWorkspacePageId, ShellWorkspacePageLoader>>
}

export function createShellWorkspacePageRegistry(options: ShellWorkspacePageRegistryOptions) {
  const pages: ShellWorkspacePage[] = []
  const pageIds = new Set<string>()
  const menuKeys = new Set<string>()

  const push = (page: ShellWorkspacePage): void => {
    if (pageIds.has(page.pageId)) throw new Error(`duplicate workspace page id: ${page.pageId}`)
    if (menuKeys.has(page.menuKey)) throw new Error(`duplicate workspace menu key: ${page.menuKey}`)
    pageIds.add(page.pageId)
    menuKeys.add(page.menuKey)
    pages.push(Object.freeze(page))
  }

  for (const item of createBuiltInNavItems(options.language)) {
    const load = options.builtInPageLoaders[item.pageId]
    if (typeof load !== 'function') throw new Error(`missing built-in workspace page loader: ${item.pageId}`)
    push({
      pageId: item.pageId,
      menuKey: item.menuKey,
      label: item.label,
      icon: item.icon,
      kind: 'built-in',
      supportsDetached: item.supportsDetached,
      allowMultipleInstances: item.allowMultipleInstances,
      load
    })
  }

  for (const entry of [...options.productMenuEntries].sort((left, right) => left.order - right.order)) {
    const capability = resolveMenuPageWorkspaceCapability({ workspace: entry.workspace })
    push({
      pageId: entry.id,
      menuKey: entry.routePath,
      label: resolveLocalizedTitle(entry.title, options.language),
      icon: resolveShellIcon(entry.icon),
      kind: 'product',
      supportsDetached: capability.supportsDetached,
      allowMultipleInstances: capability.allowMultipleInstances,
      load: entry.load
    })
  }

  const byPageId = new Map(pages.map((page) => [page.pageId, page]))
  const byMenuKey = new Map(pages.map((page) => [page.menuKey, page]))
  const list = Object.freeze([...pages])

  return Object.freeze({
    list: (): readonly ShellWorkspacePage[] => list,
    get(pageId: string): ShellWorkspacePage | undefined {
      return byPageId.get(pageId)
    },
    getByMenuKey(menuKey: string): ShellWorkspacePage | undefined {
      return byMenuKey.get(menuKey)
    }
  })
}

export type ShellWorkspacePageRegistry = ReturnType<typeof createShellWorkspacePageRegistry>
