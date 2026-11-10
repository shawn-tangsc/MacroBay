import type { SettingDescriptor } from '../../shared/settings/descriptorTypes'
import { settingRegistry } from '../../shared/settings/registry'

/**
 * 菜单 1 的三条**按来源实例化**的声明（`keyedBy: 'sourceId'`）。
 *
 * 页面不自己拼 key、也不自己挑字段：模板只在这里写一次，实例键由 `sourceRowInstanceKey` 派生。
 * 注册表里没有这一条就抛——缺声明是红，不许静默少一行（少一行读者看不到，也没人会发现）。
 */
export const SOURCE_ROW_TEMPLATES = Object.freeze({
  enabled: 'setting:sources.enabled@<sourceId>',
  collectionPreset: 'setting:sources.collection-preset@<sourceId>',
  includeInSentiment: 'setting:sources.include-in-sentiment@<sourceId>'
} as const)

export type SourceRowTemplate = (typeof SOURCE_ROW_TEMPLATES)[keyof typeof SOURCE_ROW_TEMPLATES]

/**
 * 已经改由注册表渲染的菜单 1 行。守卫①②只认这份清单，不按文件位置推断——
 * 没进清单的行仍是旧写法，进了清单就必须真的画出来。
 */
export const MIGRATED_SOURCE_SETTING_KEYS: readonly SourceRowTemplate[] = [
  SOURCE_ROW_TEMPLATES.enabled
]

const BY_TEMPLATE: ReadonlyMap<string, SettingDescriptor> = new Map(
  settingRegistry.sources.map((row) => [row.key, row])
)

/** 按模板取声明；没有这一条直接抛，不返回 `undefined` 让调用点决定要不要静默。 */
export function sourceRowDescriptor(template: SourceRowTemplate): SettingDescriptor {
  const descriptor = BY_TEMPLATE.get(template)
  if (!descriptor) throw new Error(`missing setting descriptor: ${template}`)
  return descriptor
}

/** 模板 → 这一份视图里的实例键（`data-setting-key` 用它，守卫按它认行）。 */
export function sourceRowInstanceKey(template: SourceRowTemplate, sourceId: string): string {
  return template.replace('<sourceId>', sourceId)
}
