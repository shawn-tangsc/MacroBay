import { domesticPresets } from './domestic'
import { gatewayPresets } from './gateway'
import { internationalPresets } from './international'
import { localPresets } from './local'
import type { ProviderPresetInput } from './presetTypes'
import { relayPresets } from './relay'

/**
 * PLAT-62：左栏供应商分组。
 *
 * 纯展示分类：**不进入** ModelProvider 契约、不写设置、不做持久化。未收录的 id
 * （自定义供应商）一律归 `gateway`，由 `providerCategoryOf` 兜底。
 */
export type ProviderCategoryId = 'relay' | 'domestic' | 'international' | 'local' | 'gateway'

export type PresetGroup = {
  readonly category: ProviderCategoryId
  readonly presets: readonly ProviderPresetInput[]
}

/**
 * 预设的唯一分组来源：**一家供应商写哪个文件，它的分类就是哪个**。
 *
 * 增删改供应商只需改它所在的文件，分类 / 可达性 / 全局顺序都从数据派生，不会漏改。
 * 数组顺序 = `PROVIDER_CATEGORY_ORDER`（左栏组头顺序）= 全局预设顺序；
 * 组内顺序 = 该文件里的书写顺序 = 左栏组内顺序。
 */
export const PRESET_GROUPS: readonly PresetGroup[] = [
  { category: 'relay', presets: relayPresets },
  { category: 'domestic', presets: domesticPresets },
  { category: 'international', presets: internationalPresets },
  { category: 'local', presets: localPresets },
  { category: 'gateway', presets: gatewayPresets }
]
