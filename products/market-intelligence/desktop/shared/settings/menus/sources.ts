import type { SettingDescriptor } from '../descriptorTypes'
import { readViewField } from '../descriptorTypes'

/**
 * 菜单 1 的首批：**按来源实例化**的行（`keyedBy: 'sourceId'`）。
 *
 * 实例 id 只从 `view` 来（`{ sourceId, profile, … }`）：`key` 是模板，实例 id 拼进 key 就又成了静态行。
 * 注册表里不写源清单——那是第二份源注册表。
 *
 * 「能力·看板 / 能力·日历」不在这里：`SourceCapabilities` 只有 `runNow` / `testConnection`，
 * 没有 panel/calendar，也没有对应写命令；为凑清单编一个字段就是造幽灵设置。
 */
export const SOURCE_ROWS: readonly SettingDescriptor[] = Object.freeze([
  {
    // 逐源启用：行名是**数据**（来源名），所以走 `labelText(view)`，不写文案键。
    key: 'setting:sources.enabled@<sourceId>',
    keyedBy: 'sourceId',
    menu: 'sources',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'switch' },
    read: { command: 'intelligenceSources.getSettingsView', select: (view) => readViewField(view, 'enabled') },
    write: {
      kind: 'value',
      command: 'intelligenceSources.setEnabled',
      toPayload: (value, view) => ({
        sourceId: readViewField(view, 'sourceId'),
        enabled: value === true
      })
    },
    labelText: (view) => {
      const displayName = readViewField(view, 'displayName')
      return typeof displayName === 'string' ? displayName : ''
    },
    availability: 'live'
  },
  {
    // 采集预设：行名是静态字段名（不是数据），所以仍用文案键。
    key: 'setting:sources.collection-preset@<sourceId>',
    keyedBy: 'sourceId',
    menu: 'sources',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'select', optionsFrom: 'collection-presets' },
    read: {
      command: 'intelligenceSources.getPageState',
      select: (view) => readViewField(readViewField(view, 'profile'), 'collectionPreset')
    },
    write: {
      kind: 'value',
      command: 'intelligenceSources.saveProfile',
      toPayload: (value, view) => ({
        sourceId: readViewField(view, 'sourceId'),
        collectionPreset: value
      })
    },
    visibleWhen: (view) =>
      typeof readViewField(view, 'sourceId') === 'string' &&
      readViewField(view, 'profile') !== undefined,
    copy: { labelKey: 'settings.intelligenceSources.collectionPolicy.collectionPreset' },
    availability: 'live'
  }
])
