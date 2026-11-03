import type { AppLanguage } from '@platform/settings/schema/appSettings'
import {
  builtInWorkspacePages,
  type BuiltInWorkspacePageId,
  type BuiltInWorkspacePageTitleKey
} from '@platform/workspace/registry/builtInWorkspacePages'
import type { LucideIcon } from 'lucide-react'
import { Bell, Bot, Database, Globe2, Info, KeyRound, Languages, ListChecks, MessagesSquare } from 'lucide-react'

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
  | 'about'

/** 左侧设置导航的分组；顺序即展示顺序（原型：模型与助手 → 系统与数据 → 通知与频道 → 其他）。 */
export type BuiltInSettingsGroup = 'models' | 'system' | 'notify' | 'other'

export const BUILT_IN_SETTINGS_GROUP_ORDER: readonly BuiltInSettingsGroup[] = ['models', 'system', 'notify', 'other']

export interface BuiltInSettingsPanel {
  id: BuiltInSettingsPanelId
  label: string
  icon: LucideIcon
  group: BuiltInSettingsGroup
}

/** Settings 的**二级**面板：只出现在 Settings 分组内，绝不升级为一级菜单页（技术设计 §3.3）。 */
export function createBuiltInSettingsPanels(language: AppLanguage): BuiltInSettingsPanel[] {
  const t = platformText[language]
  return [
    { id: 'models', label: t.settings.modelService, icon: KeyRound, group: 'models' },
    { id: 'assistant-library', label: t.settings.assistantLibrary, icon: Bot, group: 'models' },
    { id: 'web-search', label: t.settings.webSearch, icon: Globe2, group: 'system' },
    { id: 'storage-cache', label: t.settings.storageAndCache, icon: Database, group: 'system' },
    { id: 'task-automation', label: t.settings.taskAutomation, icon: ListChecks, group: 'system' },
    { id: 'preferences', label: t.settings.basicSettings, icon: Languages, group: 'other' },
    { id: 'notifications', label: t.settings.notifications, icon: Bell, group: 'notify' },
    { id: 'channels', label: t.settings.channels, icon: MessagesSquare, group: 'notify' },
    // 「关于我们」放在最后：它是最不像「设置」的一页，放前面会把配置区切碎。
    { id: 'about', label: t.about.title, icon: Info, group: 'other' }
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
    value === 'channels' ||
    value === 'about'
  )
}
