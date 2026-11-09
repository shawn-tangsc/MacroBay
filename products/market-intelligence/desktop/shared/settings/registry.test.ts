import { describe, expect, it } from 'vitest'

import { intelligenceNotificationText } from '../../settings/intelligence-notification/text'
import { productText } from '../i18n/productText'
import { IpcChannels } from '@platform/desktop/ipc/channels'
import type { SettingDescriptor, SettingMenuId, SettingWrite } from './registry'
import { PLATFORM_COMMANDS, SETTING_MENUS, settingRegistry, validateSettingRegistry } from './registry'

type Registry = Readonly<Record<SettingMenuId, readonly SettingDescriptor[]>>

const PUSH_THRESHOLD = settingRegistry.notifications.find(
  (row) => row.key === 'setting:notifications.push-threshold'
) as SettingDescriptor
const CHANNEL_SWITCH = settingRegistry.notifications.find(
  (row) => row.key === 'setting:notifications.channel-event.signal-triggered'
) as SettingDescriptor
const LEAD = settingRegistry.notifications.find(
  (row) => row.key === 'setting:notifications.calendar.lead'
) as SettingDescriptor
const COUNTRY_CODES = settingRegistry.notifications.find(
  (row) => row.key === 'setting:notifications.calendar.landed-countries.codes'
) as SettingDescriptor

function withRow(replacement: SettingDescriptor): Registry {
  return {
    ...settingRegistry,
    notifications: [
      ...settingRegistry.notifications.filter((row) => row.key !== replacement.key),
      replacement
    ]
  }
}

describe('settings registry self-checks (G1–G7)', () => {
  it('ships a self-consistent registry and declares every menu in the type', () => {
    expect(Object.keys(settingRegistry).sort()).toEqual([...SETTING_MENUS].sort())
    expect(validateSettingRegistry(settingRegistry)).toEqual([])
    for (const rows of Object.values(settingRegistry)) {
      for (const row of rows) expect(row.surfaces).toEqual(['settings'])
    }
  })

  it('G1: static keys are unique, and a keyed template is declared exactly once', () => {
    // 静态行重复 → 红。
    expect(validateSettingRegistry({
      ...settingRegistry,
      notifications: [...settingRegistry.notifications, { ...PUSH_THRESHOLD }]
    })).toContain('duplicate-key')

    // 按来源实例化的行：同一模板声明两次 → 红；实例数由视图决定，注册表里只许一条模板。
    const template: SettingDescriptor = { ...PUSH_THRESHOLD, key: 'setting:sources.enabled@<sourceId>', keyedBy: 'sourceId' }
    expect(validateSettingRegistry({ ...settingRegistry, sources: [template, { ...template }] })).toContain('duplicate-key')
    // 一条模板 + 一条静态同名 key 不算撞：两种身份不同。
    expect(validateSettingRegistry({ ...settingRegistry, sources: [template] })).not.toContain('duplicate-key')
  })

  it('G2: an empty or non-settings surface is rejected', () => {
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, surfaces: [] }))).toContain('empty-surfaces')
    // A3 变异之一：把 surfaces 改成本版不许的值。
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, surfaces: ['drawer'] }))).toContain('surface-not-settings')
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, surfaces: ['drawer'] }))).not.toContain('unsupported-surface')
  })

  it('G3: a platform row may use command writes, but never a value write or a default', () => {
    expect(validateSettingRegistry(withRow({ ...CHANNEL_SWITCH, defaultValueFrom: 'calendarReminder.enabled' })))
      .toContain('platform-has-default')
    expect(validateSettingRegistry(withRow({
      ...CHANNEL_SWITCH,
      write: { kind: 'value', command: 'platform:notifications-set-channel-event', toPayload: () => ({}) }
    }))).toContain('platform-has-value-write')
    // 命令写是允许的（通道事件开关今天就要能拨）。
    expect(validateSettingRegistry(settingRegistry)).not.toContain('platform-has-value-write')
  })

  it('G4: an unimplemented row may not carry a write path or a default', () => {
    const issues = validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, availability: 'unimplemented' }))
    expect(issues).toContain('unimplemented-has-write')
    expect(issues).toContain('unimplemented-has-default')
  })

  it('G5: writable product rows need a write, read-only rows forbid one', () => {
    // A3 变异之二：抽掉可写行的写命令。
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, write: undefined })))
      .toContain('writable-requires-write')
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, field: { kind: 'readonly' } })))
      .toContain('readonly-forbids-write')
  })

  it('G6: a default value must come from the server constants, never a literal', () => {
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, defaultValueFrom: 'not-a-server-default' as never })))
      .toContain('unknown-default')

    // 编译期：类型只接受 SERVER_DEFAULTS 的键，写字面量本身编不过。
    // @ts-expect-error defaultValueFrom only accepts keys of SERVER_DEFAULTS
    const literalDefault: SettingDescriptor = { ...PUSH_THRESHOLD, defaultValueFrom: 'medium' }
    expect(literalDefault.defaultValueFrom).toBe('medium')
  })

  it('G7: every command write names a command that the platform actually exports', () => {
    for (const rows of Object.values(settingRegistry)) {
      for (const row of rows) {
        if (row.write?.kind === 'command') {
          expect(PLATFORM_COMMANDS).toContain(row.write.id)
        }
      }
    }
    // 反向：写一个平台清单里没有的命令 → 红。
    const bogus: SettingWrite = { kind: 'command', id: 'platform:notifications-set-channel-event-x' as never }
    expect(validateSettingRegistry(withRow({ ...CHANNEL_SWITCH, write: bogus })))
      .toContain('unknown-platform-command')
    // 清单本身必须来自唯一的平台导出，不许另抄一份。
    expect(PLATFORM_COMMANDS).toEqual(Object.values(IpcChannels))
  })

  it('conditional rows declare visibleWhen instead of always showing', () => {
    // 提前量 / 重要性：只在「开始前」开着时出现。
    expect(LEAD.visibleWhen?.({ enabled: false })).toBe(false)
    expect(LEAD.visibleWhen?.({ enabled: true })).toBe(true)
    // 国家码：只在「自选国家」时出现。
    expect(COUNTRY_CODES.visibleWhen?.({ landedCountries: { scope: 'us' } })).toBe(false)
    expect(COUNTRY_CODES.visibleWhen?.({ landedCountries: { scope: 'custom', codes: ['US'] } })).toBe(true)
  })

  it('menu 1 declares a keyed template instead of a source list', () => {
    // 模板只声明一条；实例数量由视图里的源列表决定，注册表里不许出现源清单。
    expect(settingRegistry.sources).toHaveLength(1)
    const row = settingRegistry.sources[0] as SettingDescriptor
    expect(row.keyedBy).toBe('sourceId')
    expect(row.key).toBe('setting:sources.collection-preset@<sourceId>')

    const view = {
      selectedSourceId: 'coindesk-rss',
      detail: { profile: { sourceId: 'coindesk-rss', collectionPreset: 'balanced' } }
    }
    expect(row.read.command).toBe('intelligenceSources.getPageState')
    expect(row.read.select(view)).toBe('balanced')
    expect(row.visibleWhen?.(view)).toBe(true)
    expect(row.visibleWhen?.({})).toBe(false)
    if (row.write?.kind !== 'value') throw new Error('the preset row must be a value write')
    // 写的是「选中来源的 profile」：sourceId 从视图拿，渲染层不另传第二个参数。
    expect(row.write.toPayload('frequent', view)).toEqual({
      sourceId: 'coindesk-rss',
      collectionPreset: 'frequent'
    })
  })

  it('only existing copy keys: every labelKey / helpKey resolves in both locales', () => {
    const descriptors = Object.values(settingRegistry).flat()
    expect(descriptors.length).toBeGreaterThan(0)
    for (const descriptor of descriptors) {
      for (const locale of ['zh-CN', 'en-US'] as const) {
        expect(resolveCopyKey(locale, descriptor.copy.labelKey)).not.toBe('')
        if (descriptor.copy.helpKey) {
          expect(resolveCopyKey(locale, descriptor.copy.helpKey)).not.toBe('')
        }
      }
    }
  })
})

/** 两屏的文案表不同：通知页在 `intelligenceNotificationText`，来源页在 `productText.settings.*`。 */
function resolveCopyKey(locale: 'zh-CN' | 'en-US', key: string): string {
  if (!key.startsWith('settings.')) return intelligenceNotificationText[locale][key] ?? ''
  let node: unknown = productText[locale]
  for (const part of key.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined
  }
  return typeof node === 'string' ? node : ''
}
