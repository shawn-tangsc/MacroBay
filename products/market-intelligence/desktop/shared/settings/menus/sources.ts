import type { SettingDescriptor } from '../descriptorTypes'
import { readViewField } from '../descriptorTypes'

/**
 * 菜单 1 首批：**按来源实例化**的一行。
 *
 * 只声明「采集预设」：它的标签是静态文案键、读的是选中来源的 `detail.profile`、写的是
 * `saveProfile`，三样都有代码证据。逐源「启用」不从这儿声明——它的标签是来源名（数据），
 * 不是文案键；「能力·看板/日历」「纳入情绪分析」的可见性字段在视图里没有（前者的
 * `profile.capabilities` 不存在，后者由 `supportsSentimentById` 传进来），声明了就是编。
 *
 * 实例 id 只从 `view` 来（`{ sourceId, profile }`）：`key` 是模板，实例 id 拼进 key 就又成了静态行。
 */
export const SOURCE_ROWS: readonly SettingDescriptor[] = Object.freeze([
  {
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
        // 实例键只从 view 来（契约 ①）：`key` 是模板，实例 id 不进 key。
        sourceId: readViewField(view, 'sourceId'),
        collectionPreset: value
      })
    },
    // 只在「已经选中一个来源」时出现；没选中就没有这一行可读的值。
    visibleWhen: (view) =>
      typeof readViewField(view, 'sourceId') === 'string' &&
      readViewField(view, 'profile') !== undefined,
    copy: { labelKey: 'settings.intelligenceSources.collectionPolicy.collectionPreset' },
    availability: 'live'
  }
])

