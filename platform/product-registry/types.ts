import type { LocalizedText } from '../product-manifest'
import type { WorkspacePanelRegistration } from '../workspace/contracts'

export interface GeneratedProductPanelEntry {
  productId: string
  registration: WorkspacePanelRegistration
  load: () => Promise<unknown>
}

interface PreparedProductPanelEntry extends Omit<GeneratedProductPanelEntry, 'load'> {
  modulePath: string
}

export interface GeneratedProductMenuEntry {
  id: string
  productId: string
  productName: LocalizedText
  title: LocalizedText
  icon: string
  order: number
  routePath: string
  /**
   * P2-01 additive：已按平台命名策略补齐的一级菜单能力。
   * 可选字段保证既有生成产物（缺该字段）继续通过类型与运行期校验；缺省按平台默认值解释。
   */
  workspace?: { supportsDetached: boolean; allowMultipleInstances: boolean }
  /**
   * 默认首页声明（`docs-private/10-development/home-menu-contract.md`）：菜单项自己声明「我是首页」，
   * 而不是写成 `defaultHomePageId: 'x'` 字符串 —— 那样「指向一个不在菜单里的页」会成为可达状态。
   * **只有 `true`**；未声明时字段不存在（不是 `false`）：「没有页声明首页」和「另一页声明了首页」
   * 是两个不同的问题，落成布尔会让读取处分不清。
   */
  home?: true
  load: () => Promise<unknown>
}

export interface GeneratedProductSettingsEntry {
  id: string
  productId: string
  productName: LocalizedText
  title: LocalizedText
  icon: string
  order: number
  load: () => Promise<unknown>
}

interface PreparedProductMenuEntry extends Omit<GeneratedProductMenuEntry, 'load'> {
  modulePath: string
}

interface PreparedProductSettingsEntry extends Omit<GeneratedProductSettingsEntry, 'load'> {
  modulePath: string
}

export interface GeneratedProductRegistry {
  productIds: readonly string[]
  menuEntries: readonly PreparedProductMenuEntry[]
  settingsEntries: readonly PreparedProductSettingsEntry[]
  panelEntries: readonly PreparedProductPanelEntry[]
}
