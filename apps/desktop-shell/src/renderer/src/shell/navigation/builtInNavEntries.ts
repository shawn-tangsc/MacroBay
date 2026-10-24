import type { AppLanguage } from '@platform/settings/schema/appSettings'
import {
  builtInWorkspacePages,
  type BuiltInWorkspacePageId,
  type BuiltInWorkspacePageTitleKey
} from '@platform/workspace/registry/builtInWorkspacePages'
import type { LucideIcon } from 'lucide-react'
import { Bell, Bot, Database, Globe2, KeyRound, Languages, ListChecks, MessagesSquare } from 'lucide-react'

import { platformText } from '../../i18n/platformText'
import { resolveShellIcon } from './shellIconRegistry'

/** P2-01：内置一级菜单页的 id 与注册表描述同源（`platform/workspace/registry/builtInWorkspacePages`）。 */
export type BuiltInNavItemId = BuiltInWorkspacePageId

export interface BuiltInNavItem {
  id: BuiltInNavItemId
  label: string
  icon: LucideIcon
  /** P2-01：统一注册所需的页身份与能力；可见文案仍只来自 platformText。 */
  pageId: BuiltInWorkspacePageId
  menuKey: string
  module: string
  supportsDetached: boolean
  allowMultipleInstances: boolean
}

/**
 * 文案键 → platformText 的穷尽映射：新增内置页却漏配文案会在类型检查期失败，
 * 平台层不持有第二份可见文案（文案 owner 仍是 `platformText`）。
 */
function builtInPageLabels(language: AppLanguage): Record<BuiltInWorkspacePageTitleKey, string> {
  const t = platformText[language]
  return {
    'nav.assistants': t.nav.assistants,
    'nav.agents': t.nav.agents,
    'nav.settings': t.nav.settings
  }
}

export function createBuiltInNavItems(language: AppLanguage): BuiltInNavItem[] {
  const labels = builtInPageLabels(language)
  return builtInWorkspacePages.map((page) => ({
    id: page.pageId,
    label: labels[page.titleKey],
    icon: resolveShellIcon(page.icon),
    pageId: page.pageId,
    menuKey: page.menuKey,
    module: page.module,
    supportsDetached: page.supportsDetached,
    allowMultipleInstances: page.allowMultipleInstances
  }))
}

export function isBuiltInNavItemId(value: string): value is BuiltInNavItemId {
  return value === 'assistants' || value === 'agents' || value === 'settings'
}

export type BuiltInSettingsPanelId =
  | 'models'
  | 'assistant-library'
  | 'web-search'
  | 'storage-cache'
  | 'preferences'
  | 'notifications'
  | 'task-automation'
  | 'channels'

export interface BuiltInSettingsPanel {
  id: BuiltInSettingsPanelId
  label: string
  icon: LucideIcon
}

/** Settings 的**二级**面板：只出现在 Settings 分组内，绝不升级为一级菜单页（技术设计 §3.3）。 */
export function createBuiltInSettingsPanels(language: AppLanguage): BuiltInSettingsPanel[] {
  const t = platformText[language]
  return [
    { id: 'models', label: t.settings.modelService, icon: KeyRound },
    { id: 'assistant-library', label: t.settings.assistantLibrary, icon: Bot },
    { id: 'web-search', label: t.settings.webSearch, icon: Globe2 },
    { id: 'storage-cache', label: t.settings.storageAndCache, icon: Database },
    { id: 'task-automation', label: t.settings.taskAutomation, icon: ListChecks },
    { id: 'preferences', label: t.settings.basicSettings, icon: Languages },
    { id: 'notifications', label: t.settings.notifications, icon: Bell },
    { id: 'channels', label: t.settings.channels, icon: MessagesSquare }
  ]
}

export function isBuiltInSettingsPanelId(value: string): value is BuiltInSettingsPanelId {
  return (
    value === 'models' ||
    value === 'assistant-library' ||
    value === 'web-search' ||
    value === 'storage-cache' ||
    value === 'task-automation' ||
    value === 'preferences' ||
    value === 'notifications' ||
    value === 'channels'
  )
}
