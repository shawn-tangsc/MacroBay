import { describe, expect, it } from 'vitest'

import { intelligenceNotificationText } from '../../settings/intelligence-notification/text'
import type { SettingDescriptor, SettingMenuId } from './registry'
import { SETTING_MENUS, settingRegistry, validateSettingRegistry } from './registry'

type Registry = Readonly<Record<SettingMenuId, readonly SettingDescriptor[]>>

const SHIPPED_ROW = settingRegistry.notifications[0] as SettingDescriptor

function registryWithNotifications(rows: readonly SettingDescriptor[]): Registry {
  return { ...settingRegistry, notifications: rows }
}

function withRow(patch: Partial<SettingDescriptor>): Registry {
  return registryWithNotifications([
    { ...SHIPPED_ROW, ...patch },
    ...settingRegistry.notifications.slice(1)
  ])
}

describe('settings registry self-checks (G1–G6)', () => {
  it('ships a self-consistent registry and puts every menu in the type', () => {
    // 六格都必须在（类型是 Record<MenuId, …>，删掉一个键编译就红）。
    expect(Object.keys(settingRegistry).sort()).toEqual([...SETTING_MENUS].sort())
    expect(validateSettingRegistry(settingRegistry)).toEqual([])
    // 本版只许声明 settings 面（drawer/panel 是预留位）。
    for (const rows of Object.values(settingRegistry)) {
      for (const row of rows) expect(row.surfaces).toEqual(['settings'])
    }
  })

  it('G1: a repeated key is rejected', () => {
    const issues = validateSettingRegistry(registryWithNotifications([
      SHIPPED_ROW,
      { ...SHIPPED_ROW }
    ]))
    expect(issues).toContain('duplicate-key')
  })

  it('G2: an empty or non-settings surface is rejected', () => {
    expect(validateSettingRegistry(withRow({ surfaces: [] }))).toContain('empty-surfaces')
    // A3 变异之一：把 surfaces 改成一个本版不许的值。
    expect(validateSettingRegistry(withRow({ surfaces: ['drawer'] }))).toContain('surface-not-settings')
    expect(validateSettingRegistry(withRow({ surfaces: ['drawer'] }))).not.toContain('unsupported-surface')
  })

  it('G3: a platform-level row may not carry a write path or a default', () => {
    const issues = validateSettingRegistry(withRow({ level: 'platform' }))
    expect(issues).toContain('platform-has-write')
    expect(issues).toContain('platform-has-default')
  })

  it('G4: an unimplemented row may not carry a write path or a default', () => {
    const issues = validateSettingRegistry(withRow({ availability: 'unimplemented' }))
    expect(issues).toContain('unimplemented-has-write')
    expect(issues).toContain('unimplemented-has-default')
  })

  it('G5: writable rows need a write, read-only rows forbid one', () => {
    // A3 变异之二：抽掉可写行的写命令。
    const missingWrite = withRow({ write: undefined })
    expect(validateSettingRegistry(missingWrite)).toContain('writable-requires-write')
    // 另一个方向：只读行带着写命令也要红。
    const readonlyWithWrite = withRow({ field: { kind: 'readonly' } })
    expect(validateSettingRegistry(readonlyWithWrite)).toContain('readonly-forbids-write')
  })

  it('G6: a default value must come from the server constants, never a literal', () => {
    // 运行时这一侧：未知的默认值键要报出来。
    expect(validateSettingRegistry(withRow({ defaultValueFrom: 'not-a-server-default' as never })))
      .toContain('unknown-default')

    // 编译期这一侧：类型只接受 SERVER_DEFAULTS 的键，写一个字面量/乱写的键本身就编不过。
    // @ts-expect-error defaultValueFrom only accepts keys of SERVER_DEFAULTS
    const literalDefault: SettingDescriptor = { ...SHIPPED_ROW, defaultValueFrom: 'medium' }
    expect(literalDefault.defaultValueFrom).toBe('medium')
  })

  it('只有现有文案键：每个 labelKey / helpKey 在中英两份里都能解析', () => {
    const descriptors = Object.values(settingRegistry).flat()
    expect(descriptors.length).toBeGreaterThan(0)
    for (const descriptor of descriptors) {
      for (const locale of ['zh-CN', 'en-US'] as const) {
        expect(intelligenceNotificationText[locale][descriptor.copy.labelKey] ?? '').not.toBe('')
        if (descriptor.copy.helpKey) {
          expect(intelligenceNotificationText[locale][descriptor.copy.helpKey] ?? '').not.toBe('')
        }
      }
    }
  })
})
