/**
 * 设置定义注册表（C2 第一步：只声明，不渲染）。
 *
 * 一条声明 = 设置页上的一行。`key` 是身份（将来写进行节点的 `data-setting-key`），不是文案键；
 * 文案走 `copy`，只引用现有表。
 *
 * 本笔边界（与产品/Chief 2026-11-10 对齐）：
 * - `surfaces` 闭集三个值，本版**只许 `settings`**；`drawer`/`panel` 是预留位，不写空壳；
 * - 产品只声明自己拥有的设置：`level: 'platform'` 只许**命令写**（值在平台）或只读，
 *   禁用值写、禁 `defaultValueFrom`；
 * - 菜单 1 的行按来源实例化（`keyedBy: 'sourceId'`），`key` 是模板；注册表里不写源清单。
 *
 * 文案键来自 `desktop/settings/intelligence-notification/text.ts`（**不是 `productText.ts`**），
 * 本笔不新增任何文案键（A2：键集合相等）。
 */

import { IpcChannels } from '@platform/desktop/ipc/channels'

import {
  DEFAULT_CALENDAR_REMINDER_SETTINGS,
  type CalendarLandedFilter,
  type CalendarReminderLeadMinutes
} from '../../../contracts/calendarEventReminder'
import { DEFAULT_CALENDAR_LANDED_COUNTRIES } from '../../../contracts/calendarLandedCountries'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS } from '../../../contracts/notificationEventKeys'
import {
  DEFAULT_NEWS_PUSH_THRESHOLD,
  type NewsSentimentTierThreshold
} from '../../../contracts/newsSentimentTiers'

/** 六格菜单 id：与 `01-prd-structure.md` 的六格一一对应，顺序一致。 */
export const SETTING_MENUS = [
  'sources',
  'content',
  'analysis',
  'briefing',
  'notifications',
  'platform'
] as const
export type SettingMenuId = (typeof SETTING_MENUS)[number]

/** 允许出现在哪些面。本版只许 `settings`；另两个是预留位，出现即违反 G2。 */
export const SETTING_SURFACES = ['settings', 'drawer', 'panel'] as const
export type SettingSurface = (typeof SETTING_SURFACES)[number]

/** 值的归属：`product` = 产品存储；`platform` = 平台设置（命令写或只读）。 */
export type SettingLevel = 'product' | 'platform'

/** 未实现项无控件、无写、无默认值（G4），渲染一行说明；不许画成禁用控件。 */
export type SettingAvailability = 'live' | 'unimplemented'

/** 控件可选项只许来自这里声明的集合，不许在行里手写列表。 */
export type SettingOptionsSource =
  | 'news-push-thresholds'
  | 'calendar-reminder-leads'
  | 'calendar-reminder-importance'
  | 'calendar-landed-filter'
  | 'calendar-landed-scopes'
  | 'calendar-landed-country-codes'
  | 'collection-presets'

/** 本版五种控件；文本输入与动作按钮不进注册表（契约 §1.1）。 */
export type SettingField =
  | { readonly kind: 'switch' }
  | { readonly kind: 'select'; readonly optionsFrom: SettingOptionsSource }
  | { readonly kind: 'multiSelect'; readonly optionsFrom: SettingOptionsSource }
  | { readonly kind: 'number'; readonly min?: number; readonly max?: number; readonly step?: number; readonly unitKey?: string }
  | { readonly kind: 'readonly' }

/** 平台命令清单：G7 的对照表，也把「写一个不存在的命令」变成编译期错误。 */
export const PLATFORM_COMMANDS = Object.values(IpcChannels)
export type PlatformCommandId = (typeof IpcChannels)[keyof typeof IpcChannels]

/**
 * 默认值的唯一来源：只放共享契约/服务端常量引用，声明里只放这张表的键。
 * 运行期分不出「引用的 false」和「手写的 false」，所以 G6 用类型强制（写字面量编译不过）。
 */
export const SERVER_DEFAULTS = Object.freeze({
  newsPushThreshold: DEFAULT_NEWS_PUSH_THRESHOLD,
  'calendarReminder.enabled': DEFAULT_CALENDAR_REMINDER_SETTINGS.enabled,
  'calendarReminder.leadMinutes': DEFAULT_CALENDAR_REMINDER_SETTINGS.leadMinutes,
  'calendarReminder.importance': DEFAULT_CALENDAR_REMINDER_SETTINGS.importance,
  'calendarReminder.landedFilter': DEFAULT_CALENDAR_REMINDER_SETTINGS.landedFilter,
  'calendarReminder.landedCountryScope': DEFAULT_CALENDAR_LANDED_COUNTRIES.scope
} as const)

export type ServerDefaultKey = keyof typeof SERVER_DEFAULTS

/**
 * 两种写，不是一个例外：
 * - `value`：值写，注册表持有这一项（只许 `level: 'product'`）；
 * - `command`：命令写，值在平台，这里只声明按哪个命令改（不持有值、无默认值）。
 *
 * `toPayload` / `toArgs` 都收第二个 `view`：有些行一次要写多字段（如国家的
 * `{ scope, codes }`），只给新值会丢掉同一对象里的另一格——那不是省事，是把读者另一半设置清空。
 */
export type SettingWrite =
  | Readonly<{
      kind: 'value'
      command: string
      toPayload: (value: unknown, view: unknown) => unknown
    }>
  | Readonly<{
      kind: 'command'
      id: PlatformCommandId
      toArgs?: (value: unknown, view: unknown) => unknown
    }>

export type SettingDescriptor = Readonly<{
  /** 身份：静态行全局唯一；带 `keyedBy` 时是模板（`…@<sourceId>`），模板只声明一次。 */
  key: string
  /** 按视图里的列表实例化；本版只认 `sourceId`。注册表里不写实例清单。 */
  keyedBy?: 'sourceId'
  menu: SettingMenuId
  surfaces: readonly SettingSurface[]
  level: SettingLevel
  field: SettingField
  read: Readonly<{ command: string; select: (view: unknown) => unknown }>
  write?: SettingWrite
  /** 值缺失时显示什么：只许是 `SERVER_DEFAULTS` 的键（G6，编译期）。 */
  defaultValueFrom?: ServerDefaultKey
  /** 只依赖 `read` 的结果；假 = 不渲染，不是禁用。 */
  visibleWhen?: (view: unknown) => boolean
  copy: Readonly<{ labelKey: string; helpKey?: string }>
  availability: SettingAvailability
}>

/** 从 `unknown` 视图里取具名字段；取不到就是 `undefined`，不让渲染层猜。 */
export function readViewField(view: unknown, field: string): unknown {
  if (typeof view !== 'object' || view === null) return undefined
  return field in view ? (view as Record<string, unknown>)[field] : undefined
}

const NOTIFICATION_ROWS: readonly SettingDescriptor[] = Object.freeze([
  {
    key: 'setting:notifications.channel-event.signal-triggered',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'platform',
    field: { kind: 'switch' },
    read: {
      command: 'platform:notifications-get-channel-events',
      select: (view) => readViewField(readViewField(view, 'events'), MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.signalTriggered)
    },
    write: {
      kind: 'command',
      id: 'platform:notifications-set-channel-event',
      toArgs: (value) => ({ eventId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.signalTriggered, enabled: value === true })
    },
    copy: {
      labelKey: 'pages.intelligence.notification.rows.signalTriggered.title',
      helpKey: 'pages.intelligence.notification.rows.signalTriggered.info'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.channel-event.briefing-ready',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'platform',
    field: { kind: 'switch' },
    read: {
      command: 'platform:notifications-get-channel-events',
      select: (view) => readViewField(readViewField(view, 'events'), MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.briefingReady)
    },
    write: {
      kind: 'command',
      id: 'platform:notifications-set-channel-event',
      toArgs: (value) => ({ eventId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.briefingReady, enabled: value === true })
    },
    copy: {
      labelKey: 'pages.intelligence.notification.rows.briefingReady.title',
      helpKey: 'pages.intelligence.notification.rows.briefingReady.info'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.channel-event.sentiment-alert',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'platform',
    field: { kind: 'switch' },
    read: {
      command: 'platform:notifications-get-channel-events',
      select: (view) => readViewField(readViewField(view, 'events'), MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.sentimentAlert)
    },
    write: {
      kind: 'command',
      id: 'platform:notifications-set-channel-event',
      toArgs: (value) => ({ eventId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.sentimentAlert, enabled: value === true })
    },
    copy: {
      labelKey: 'pages.intelligence.notification.rows.sentimentAlert.title',
      helpKey: 'pages.intelligence.notification.rows.sentimentAlert.info'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.channel-event.calendar',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'platform',
    field: { kind: 'switch' },
    read: {
      command: 'platform:notifications-get-channel-events',
      select: (view) => readViewField(readViewField(view, 'events'), MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.calendarEventUpcoming)
    },
    write: {
      kind: 'command',
      id: 'platform:notifications-set-channel-event',
      toArgs: (value) => ({ eventId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.calendarEventUpcoming, enabled: value === true })
    },
    copy: {
      labelKey: 'pages.intelligence.notification.rows.calendar.title',
      helpKey: 'pages.intelligence.notification.rows.calendar.info'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.push-threshold',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'select', optionsFrom: 'news-push-thresholds' },
    read: { command: 'intelligence.getNewsPushThreshold', select: (view) => readViewField(view, 'pushThreshold') },
    write: {
      kind: 'value',
      command: 'intelligence.saveNewsPushThreshold',
      toPayload: (value) => ({ pushThreshold: value as NewsSentimentTierThreshold })
    },
    defaultValueFrom: 'newsPushThreshold',
    copy: {
      labelKey: 'pages.intelligence.notification.threshold.row',
      helpKey: 'pages.intelligence.notification.threshold.info'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.calendar.lead',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'select', optionsFrom: 'calendar-reminder-leads' },
    read: { command: 'intelligence.getCalendarReminderSettings', select: (view) => readViewField(view, 'leadMinutes') },
    write: {
      kind: 'value',
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value) => ({ leadMinutes: value as CalendarReminderLeadMinutes })
    },
    defaultValueFrom: 'calendarReminder.leadMinutes',
    // 契约：只在「开始前」开着时出现；关着时只留一行状态摘要。
    visibleWhen: (view) => readViewField(view, 'enabled') === true,
    copy: {
      labelKey: 'pages.intelligence.notification.calendar.lead',
      helpKey: 'pages.intelligence.notification.calendar.beforeNote'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.calendar.importance',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'multiSelect', optionsFrom: 'calendar-reminder-importance' },
    read: { command: 'intelligence.getCalendarReminderSettings', select: (view) => readViewField(view, 'importance') },
    write: {
      kind: 'value',
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value) => ({ importance: value })
    },
    defaultValueFrom: 'calendarReminder.importance',
    visibleWhen: (view) => readViewField(view, 'enabled') === true,
    copy: {
      labelKey: 'pages.intelligence.notification.calendar.importance',
      helpKey: 'pages.intelligence.notification.calendar.beforeNote'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.calendar.landed-filter',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'select', optionsFrom: 'calendar-landed-filter' },
    read: { command: 'intelligence.getCalendarReminderSettings', select: (view) => readViewField(view, 'landedFilter') },
    write: {
      kind: 'value',
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value) => ({ landedFilter: value as CalendarLandedFilter })
    },
    defaultValueFrom: 'calendarReminder.landedFilter',
    copy: {
      labelKey: 'pages.intelligence.notification.calendar.landedRow',
      helpKey: 'pages.intelligence.notification.landed.cost'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.calendar.landed-countries.scope',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'select', optionsFrom: 'calendar-landed-scopes' },
    read: {
      command: 'intelligence.getCalendarReminderSettings',
      select: (view) => readViewField(readViewField(view, 'landedCountries'), 'scope')
    },
    write: {
      kind: 'value',
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value, view) => ({
        // 两格是一份对象：改范围不能把读者已勾的国家清掉（非 custom 时服务端本来也只存空）。
        landedCountries: {
          scope: value,
          codes: value === 'custom' ? readViewField(readViewField(view, 'landedCountries'), 'codes') ?? [] : []
        }
      })
    },
    defaultValueFrom: 'calendarReminder.landedCountryScope',
    copy: {
      labelKey: 'pages.intelligence.notification.countries.row',
      helpKey: 'pages.intelligence.notification.countries.scopeNote'
    },
    availability: 'live'
  },
  {
    key: 'setting:notifications.calendar.landed-countries.codes',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'multiSelect', optionsFrom: 'calendar-landed-country-codes' },
    read: {
      command: 'intelligence.getCalendarReminderSettings',
      select: (view) => readViewField(readViewField(view, 'landedCountries'), 'codes')
    },
    write: {
      kind: 'value',
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value) => ({ landedCountries: { scope: 'custom', codes: value } })
    },
    // 契约：仅「自选国家」时出现（`calendarLandedCountries.ts` 的 scope 条件多选）。
    visibleWhen: (view) => readViewField(readViewField(view, 'landedCountries'), 'scope') === 'custom',
    copy: {
      labelKey: 'pages.intelligence.notification.countries.customTitle',
      helpKey: 'pages.intelligence.notification.countries.customCost'
    },
    availability: 'live'
  }
])

/**
 * 菜单 1 首批：**按来源实例化**的一行。
 *
 * 只声明「采集预设」：它的标签是静态文案键、读的是选中来源的 `detail.profile`、写的是
 * `saveProfile`，三样都有代码证据。逐源「启用」不从这儿声明——它的标签是来源名（数据），
 * 不是文案键；「能力·看板/日历」「纳入情绪分析」的可见性字段在视图里没有（前者的
 * `profile.capabilities` 不存在，后者由 `supportsSentimentById` 传进来），声明了就是编。
 *
 * 实例 id 由页面按 `keyedBy` 填进模板；读/写靠视图自带的 `selectedSourceId` 与
 * `detail.profile` 绑定，不要求渲染层再传第二个参数。
 */
const SOURCE_ROWS: readonly SettingDescriptor[] = Object.freeze([
  {
    key: 'setting:sources.collection-preset@<sourceId>',
    keyedBy: 'sourceId',
    menu: 'sources',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'select', optionsFrom: 'collection-presets' },
    read: {
      command: 'intelligenceSources.getPageState',
      select: (view) => readViewField(readViewField(readViewField(view, 'detail'), 'profile'), 'collectionPreset')
    },
    write: {
      kind: 'value',
      command: 'intelligenceSources.saveProfile',
      toPayload: (value, view) => ({
        sourceId: readViewField(view, 'selectedSourceId'),
        collectionPreset: value
      })
    },
    // 只在「已经选中一个来源」时出现；没选中就没有这一行可读的值。
    visibleWhen: (view) =>
      typeof readViewField(view, 'selectedSourceId') === 'string' &&
      readViewField(readViewField(view, 'detail'), 'profile') !== undefined,
    copy: { labelKey: 'settings.intelligenceSources.collectionPolicy.collectionPreset' },
    availability: 'live'
  }
])

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

/**
 * G1–G7 自检，纯函数：注册表自身不自洽时返回问题码，由单测调用。
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
      // G1：静态行判全局唯一；按实例化的行只判模板唯一（实例数由视图决定）。
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
    }
  }
  return issues
}

/** 取值：声明里只放键，值从唯一来源读。 */
export function resolveServerDefault(key: ServerDefaultKey): unknown {
  return SERVER_DEFAULTS[key]
}
