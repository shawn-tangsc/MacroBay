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
  },
  {
    // 纳入情绪分析：可见性由**视图里的能力事实**决定（`view.supportsSentiment`，页面算视图时一并给）。
    // 缺这条事实 ⇒ 整行不渲染（不是默认 true）；不接受渲染层另传上下文。
    key: 'setting:sources.include-in-sentiment@<sourceId>',
    keyedBy: 'sourceId',
    menu: 'sources',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'switch' },
    read: {
      command: 'intelligenceSources.getPageState',
      select: (view) => readViewField(readViewField(view, 'profile'), 'includeInSentiment')
    },
    write: {
      kind: 'value',
      command: 'intelligenceSources.saveProfile',
      toPayload: (value, view) => ({
        sourceId: readViewField(view, 'sourceId'),
        includeInSentiment: value === true
      })
    },
    visibleWhen: (view, legacyContext) => {
      // 视图给了事实就**只认视图**（这是契约要求的那条路）。
      const supportsSentiment = readViewField(view, 'supportsSentiment')
      if (typeof supportsSentiment === 'boolean') return supportsSentiment
      // 过渡：页面还没把事实拼进视图时，退回旧的只读上下文——只在「视图里根本没有这一格」时生效。
      // TODO(C17 第三步)：调用点改单参后，连同 `SettingContext` 一起删掉这一段，缺事实即不渲染。
      const sourceId = readViewField(view, 'sourceId')
      if (typeof sourceId !== 'string') return false
      return readViewField(readViewField(legacyContext, 'supportsSentimentById'), sourceId) === true
    },
    copy: { labelKey: 'settings.intelligenceSources.collectionPolicy.includeInSentiment' },
    availability: 'live'
  }
])
