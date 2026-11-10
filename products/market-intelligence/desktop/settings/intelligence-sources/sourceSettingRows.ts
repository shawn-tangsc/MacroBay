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

const BY_TEMPLATE: ReadonlyMap<string, SettingDescriptor> = new Map(
  settingRegistry.sources.map((row) => [row.key, row])
)

/** 按模板取声明；没有这一条直接抛，不返回 `undefined` 让调用点决定要不要静默。 */
export function sourceRowDescriptor(template: SourceRowTemplate): SettingDescriptor {
  const descriptor = BY_TEMPLATE.get(template)
  if (!descriptor) throw new Error(`missing setting descriptor: ${template}`)
  return descriptor
}

/**
 * 一条声明在这份视图里的**值**与**可见性**：屏幕不再自己读字段、也不再自己判条件。
 * 值取 `read.select(view)`（与声明写下的读法同一处），可见性取 `visibleWhen`（缺省可见）。
 */
export type SourceRowView = Readonly<{
  template: SourceRowTemplate
  descriptor: SettingDescriptor
  value: unknown
  visible: boolean
}>

export function sourceRowView(template: SourceRowTemplate, view: unknown): SourceRowView {
  const descriptor = sourceRowDescriptor(template)
  return {
    template,
    descriptor,
    value: descriptor.read.select(view),
    visible: descriptor.visibleWhen?.(view) ?? true
  }
}

/**
 * 这份视图里能看到的菜单 1 行，**顺序就是 `SOURCE_ROWS` 的声明顺序**。
 * 屏幕照它排列，不自己写「先启用、再预设、再情绪」——那是第二份顺序表。
 */
export function visibleSourceRows(view: unknown): readonly SourceRowView[] {
  const templates = Object.values(SOURCE_ROW_TEMPLATES)
  return settingRegistry.sources
    .filter((row): row is typeof row & { key: SourceRowTemplate } =>
      (templates as readonly string[]).includes(row.key))
    .map((row) => sourceRowView(row.key, view))
    .filter((row) => row.visible)
}

/** 模板 → 这一份视图里的实例键（`data-setting-key` 用它，守卫按它认行）。 */
export function sourceRowInstanceKey(template: SourceRowTemplate, sourceId: string): string {
  return template.replace('<sourceId>', sourceId)
}
