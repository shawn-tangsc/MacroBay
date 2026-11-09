/**
 * 设置定义注册表（C2 第一步：只声明，不渲染）：六格聚合 + 声明自检。
 *
 * 形状与默认值来源在 `descriptorTypes.ts`，每个菜单的声明在 `menus/` 下——一个菜单一个文件，
 * 谁也不必读完整张表才能改一行。
 *
 * 本笔边界（与产品/Chief 2026-11-10 对齐）：
 * - `surfaces` 闭集三个值，本版**只许 `settings`**；`drawer`/`panel` 是预留位，不写空壳；
 * - 产品只声明自己拥有的设置：`level: 'platform'` 只许**命令写**或只读，禁值写与默认值；
 * - 按实例化的行（`keyedBy`）`key` 是模板，实例 id 只从 `view` 来，注册表里不写实例清单。
 */

import { NOTIFICATION_ROWS } from './menus/notifications'
import { SOURCE_ROWS } from './menus/sources'
import {
  PLATFORM_COMMANDS,
  SERVER_DEFAULTS,
  SETTING_MENUS,
  SETTING_SURFACES,
  type ServerDefaultKey,
  type SettingDescriptor,
  type SettingMenuId
} from './descriptorTypes'

export * from './descriptorTypes'

/**
 * 六格都必须有键：删掉某菜单（或整个菜单）从类型上报错，不会静默少一行。
 * 本笔只填菜单 5；其余空数组是「本笔不声明」，不是「永远没有」。
 * 菜单 1 的 `keyedBy: 'sourceId'` 已在类型里，行声明等读/写实例绑定落到契约后再进表。
 */
export const settingRegistry: Readonly<Record<SettingMenuId, readonly SettingDescriptor[]>> = Object.freeze({
  sources: SOURCE_ROWS,
  content: Object.freeze([]),
  analysis: Object.freeze([]),
  briefing: Object.freeze([]),
  notifications: NOTIFICATION_ROWS,
  platform: Object.freeze([])
})

export type SettingRegistryIssue =
  | 'empty-key'
  | 'duplicate-key'
  | 'empty-surfaces'
  | 'unsupported-surface'
  | 'surface-not-settings'
  | 'platform-has-default'
  | 'platform-has-value-write'
  | 'unimplemented-has-write'
  | 'unimplemented-has-default'
  | 'writable-requires-write'
  | 'readonly-forbids-write'
  | 'unknown-default'
  | 'unknown-platform-command'
  | 'missing-label'
  | 'label-text-on-static-row'
  | 'template-key-mismatch'

/**
 * 声明自检，纯函数：注册表自身不自洽时返回问题码，由单测调用。
 * 不在这里抛错——渲染层拿到的是一份已验证的表；验证失败应当是测试的红，不是页面白屏。
 */
export function validateSettingRegistry(
  registry: Readonly<Record<SettingMenuId, readonly SettingDescriptor[]>>
): SettingRegistryIssue[] {
  const issues: SettingRegistryIssue[] = []
  const seen = new Set<string>()
  for (const menu of SETTING_MENUS) {
    for (const descriptor of registry[menu]) {
      if (descriptor.key.trim().length === 0) issues.push('empty-key')
      // 身份：静态行判全局唯一；按实例化的行只判模板唯一（实例数由视图决定）。
      const identity = descriptor.keyedBy ? `template:${descriptor.key}` : `static:${descriptor.key}`
      if (seen.has(identity)) issues.push('duplicate-key')
      seen.add(identity)

      if (descriptor.surfaces.length === 0) issues.push('empty-surfaces')
      for (const surface of descriptor.surfaces) {
        if (!(SETTING_SURFACES as readonly string[]).includes(surface)) issues.push('unsupported-surface')
        else if (surface !== 'settings') issues.push('surface-not-settings')
      }

      if (descriptor.level === 'platform') {
        if (descriptor.defaultValueFrom) issues.push('platform-has-default')
        if (descriptor.write?.kind === 'value') issues.push('platform-has-value-write')
      }
      if (descriptor.availability === 'unimplemented') {
        if (descriptor.write) issues.push('unimplemented-has-write')
        if (descriptor.defaultValueFrom) issues.push('unimplemented-has-default')
      }

      if (descriptor.field.kind === 'readonly') {
        if (descriptor.write) issues.push('readonly-forbids-write')
      } else if (descriptor.availability === 'live' && descriptor.level === 'product' && !descriptor.write) {
        issues.push('writable-requires-write')
      }

      if (descriptor.defaultValueFrom && !(descriptor.defaultValueFrom in SERVER_DEFAULTS)) {
        issues.push('unknown-default')
      }
      if (descriptor.write?.kind === 'command' && !(PLATFORM_COMMANDS as readonly string[]).includes(descriptor.write.id)) {
        issues.push('unknown-platform-command')
      }

      // 行名：必须恰有一个来源——静态行用 labelKey，按实例化的行才可用 labelText（视图数据）。
      const hasLabelKey = (descriptor.copy?.labelKey ?? '').length > 0
      if (descriptor.labelText === undefined && !hasLabelKey) issues.push('missing-label')
      if (descriptor.labelText !== undefined && descriptor.keyedBy === undefined) {
        issues.push('label-text-on-static-row')
      }

      // 模板必须按实例化的维度取键：源行不许写 feed 模板，feed 行也不许写源模板。
      if (descriptor.keyedBy === 'sourceId' && !descriptor.key.includes('@<sourceId>')) {
        issues.push('template-key-mismatch')
      }
      if (descriptor.keyedBy === 'feedId' && !descriptor.key.includes('@<feedId>')) {
        issues.push('template-key-mismatch')
      }
    }
  }
  return issues
}

/** 取值：声明里只放键，值从唯一来源读。 */
export function resolveServerDefault(key: ServerDefaultKey): unknown {
  return SERVER_DEFAULTS[key]
}
