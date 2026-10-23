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
