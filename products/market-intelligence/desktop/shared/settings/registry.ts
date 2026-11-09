/**
 * 设置定义注册表（C2 第一步：只声明，不渲染）。
 *
 * 一条声明 = 设置页上的一行。渲染层只按这张表出行，不许再手写第二份；`key` 是这一行的
 * 身份（将来写在最外层节点的 `data-setting-key` 上），**不是文案键**——文案走 `copy`。
 *
 * 本笔的边界（与产品/Chief 2026-11-10 对齐）：
 * - `surfaces` 闭集只有三个值，本版**只许出现 `settings`**；`drawer` / `panel` 是预留位，
 *   不许提前写空壳分支；
 * - **产品只声明自己拥有的设置**：`level: 'platform'` 的项只许只读展示 + 跳转，禁
 *   `write` / `defaultValueFrom`（否则产品注册表就持有了平台设置的写路径，平台反向依赖产品）；
 * - 菜单 1（来源与采集）本笔为空：它的每一行都是**按来源实例化**的（`启用`/`能力·看板`/
 *   `能力·日历`/`采集频率` 每个源各一行），静态 `key` 表达不了；要等契约补 `keyedBy`
 *   （或等 C11–C13 拿着视图里的源列表一起落），不在本笔硬造一份源清单。
 *
 * 文案键只引用**现有**表：通知页的字句在
 * `desktop/settings/intelligence-notification/text.ts`（不是 `productText.ts`），本笔
 * 不新增任何文案键（A2：键集合相等）。
 */

import {
  DEFAULT_CALENDAR_REMINDER_SETTINGS,
  type CalendarLandedFilter,
  type CalendarReminderLeadMinutes
} from '../../../contracts/calendarEventReminder'
import {
  DEFAULT_NEWS_PUSH_THRESHOLD,
  type NewsSentimentTierThreshold
} from '../../../contracts/newsSentimentTiers'

/** 六格菜单的 id：与 `01-prd-structure.md` 的六格一一对应，顺序也一致。 */
export const SETTING_MENUS = [
  'sources',
  'content',
  'analysis',
  'briefing',
  'notifications',
  'platform'
] as const
export type SettingMenuId = (typeof SETTING_MENUS)[number]

/** 允许出现在哪些面。本版只许 `settings`；另两个是预留位，声明里出现即违反 G2。 */
export const SETTING_SURFACES = ['settings', 'drawer', 'panel'] as const
export type SettingSurface = (typeof SETTING_SURFACES)[number]

/**
 * 值的归属：`product` = 产品自己的存储；`platform` = 平台设置的只读投影。
 * 平台项禁写、禁声明默认值（G3）——产品注册表不许持有平台的写路径。
 */
export type SettingLevel = 'product' | 'platform'

/** 未实现项不许挂控件、不许声明默认值、不许有写命令（G4）；渲染成一行说明。 */
export type SettingAvailability = 'live' | 'unimplemented'

/** 本版只做四种控件（契约 §1.1）；文本输入与多值勾选不在其中，故它们不在首批声明里。 */
export type SettingOptionsSource =
  | 'news-push-thresholds'
  | 'calendar-reminder-leads'
  | 'calendar-landed-filter'

export type SettingField =
  | { readonly kind: 'switch' }
  | { readonly kind: 'select'; readonly optionsFrom: SettingOptionsSource }
  | { readonly kind: 'number'; readonly min?: number; readonly max?: number; readonly step?: number; readonly unitKey?: string }
  | { readonly kind: 'readonly' }

/**
 * 默认值的**唯一来源**：这里只放服务端/共享契约里的常量引用，声明里只放这张表的键。
 *
 * 为什么不按契约写 `defaultValue: unknown`：运行期分不出「引用的 false」和「手写的 false」，
 * 单测只能看着两个相等的值发呆。把默认值改成「键」以后，写一个字面量在类型上就不成立
 * （G6 从测试提升为编译期），服务端改默认值时这里不同步会直接编译报错。
 */
export const SERVER_DEFAULTS = Object.freeze({
  newsPushThreshold: DEFAULT_NEWS_PUSH_THRESHOLD,
  'calendarReminder.enabled': DEFAULT_CALENDAR_REMINDER_SETTINGS.enabled,
  'calendarReminder.leadMinutes': DEFAULT_CALENDAR_REMINDER_SETTINGS.leadMinutes,
  'calendarReminder.landedFilter': DEFAULT_CALENDAR_REMINDER_SETTINGS.landedFilter
} as const)

export type ServerDefaultKey = keyof typeof SERVER_DEFAULTS

export type SettingDescriptor = Readonly<{
  /** 身份：全局唯一、稳定，不随文案改名；将来写到行的 `data-setting-key` 上。 */
  key: string
  menu: SettingMenuId
  surfaces: readonly SettingSurface[]
  level: SettingLevel
  field: SettingField
  /** 从哪个视图取哪个字段。渲染层只调用它，不许自己拼载荷。 */
  read: Readonly<{ command: string; select: (view: unknown) => unknown }>
  /** 怎么把值写回去。可写的 live 项必须有；只读/平台/未实现项必须没有（G3/G4/G5）。 */
  write?: Readonly<{ command: string; toPayload: (value: unknown) => unknown }>
  /** 值缺失时显示什么：只许引用 `SERVER_DEFAULTS` 的键（G6）。 */
  defaultValueFrom?: ServerDefaultKey
  /** 只依赖 `read` 的结果；假 = 不渲染，不是禁用。 */
  visibleWhen?: (view: unknown) => boolean
  /** 行名 + ⓘ 说明。只引用现有文案键，不新增。 */
  copy: Readonly<{ labelKey: string; helpKey?: string }>
  availability: SettingAvailability
}>

/** 从 `unknown` 视图里取一个具名字段；取不到就是 `undefined`，不让渲染层猜。 */
export function readViewField(view: unknown, field: string): unknown {
  if (typeof view !== 'object' || view === null) return undefined
  return field in view ? (view as Record<string, unknown>)[field] : undefined
}

/** 通知页的四行（本笔首批）。文案键全部来自现有 `intelligenceNotificationText`。 */
const NOTIFICATION_SETTINGS: readonly SettingDescriptor[] = Object.freeze([
  {
    key: 'setting:notifications.push-threshold',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'select', optionsFrom: 'news-push-thresholds' },
    read: { command: 'intelligence.getNewsPushThreshold', select: (view) => readViewField(view, 'pushThreshold') },
    write: {
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
    key: 'setting:notifications.calendar.enabled',
    menu: 'notifications',
    surfaces: ['settings'],
    level: 'product',
    field: { kind: 'switch' },
    read: { command: 'intelligence.getCalendarReminderSettings', select: (view) => readViewField(view, 'enabled') },
    write: {
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value) => ({ enabled: value === true })
    },
    defaultValueFrom: 'calendarReminder.enabled',
    copy: {
      labelKey: 'pages.intelligence.notification.calendar.beforeRow',
      helpKey: 'pages.intelligence.notification.calendar.beforeNote'
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
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value) => ({ leadMinutes: value as CalendarReminderLeadMinutes })
    },
    defaultValueFrom: 'calendarReminder.leadMinutes',
    copy: {
      labelKey: 'pages.intelligence.notification.calendar.lead',
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
      command: 'intelligence.setCalendarReminderSettings',
      toPayload: (value) => ({ landedFilter: value as CalendarLandedFilter })
    },
    defaultValueFrom: 'calendarReminder.landedFilter',
    copy: {
      labelKey: 'pages.intelligence.notification.calendar.landedRow',
      helpKey: 'pages.intelligence.notification.landed.cost'
    },
    availability: 'live'
  }
])

/**
 * 六格都必须有键：删掉某菜单的声明（或整个菜单）会从类型上报错，不会静默少一行。
 * 本笔只填菜单 5；其余空数组是「本笔不声明」，不是「永远没有」。
 */
export const settingRegistry: Readonly<Record<SettingMenuId, readonly SettingDescriptor[]>> = Object.freeze({
  sources: Object.freeze([]),
  content: Object.freeze([]),
  analysis: Object.freeze([]),
  briefing: Object.freeze([]),
  notifications: NOTIFICATION_SETTINGS,
  platform: Object.freeze([])
})

export type SettingRegistryIssue =
  | 'empty-key'
  | 'duplicate-key'
  | 'empty-surfaces'
  | 'unsupported-surface'
  | 'surface-not-settings'
  | 'platform-has-write'
  | 'platform-has-default'
  | 'unimplemented-has-write'
  | 'unimplemented-has-default'
  | 'writable-requires-write'
  | 'readonly-forbids-write'
  | 'unknown-default'

/**
 * G1–G6 的自检，纯函数：注册表自身不自洽时返回问题码，由单测与（将来的）构建期守卫调用。
 * 不在这里抛错——渲染层拿到的是一份已验证的表，验证失败应当是测试的红，不是页面的白屏。
 */
export function validateSettingRegistry(
  registry: Readonly<Record<SettingMenuId, readonly SettingDescriptor[]>>
): SettingRegistryIssue[] {
  const issues: SettingRegistryIssue[] = []
  const seen = new Set<string>()
  for (const menu of SETTING_MENUS) {
    for (const descriptor of registry[menu]) {
      if (descriptor.key.trim().length === 0) issues.push('empty-key')
      if (seen.has(descriptor.key)) issues.push('duplicate-key')
      seen.add(descriptor.key)

      if (descriptor.surfaces.length === 0) issues.push('empty-surfaces')
      for (const surface of descriptor.surfaces) {
        if (!(SETTING_SURFACES as readonly string[]).includes(surface)) issues.push('unsupported-surface')
        else if (surface !== 'settings') issues.push('surface-not-settings')
      }

      if (descriptor.level === 'platform') {
        if (descriptor.write) issues.push('platform-has-write')
        if (descriptor.defaultValueFrom) issues.push('platform-has-default')
      }
      if (descriptor.availability === 'unimplemented') {
        if (descriptor.write) issues.push('unimplemented-has-write')
        if (descriptor.defaultValueFrom) issues.push('unimplemented-has-default')
      }

      if (descriptor.field.kind === 'readonly') {
        if (descriptor.write) issues.push('readonly-forbids-write')
      } else if (descriptor.availability === 'live' && !descriptor.write) {
        issues.push('writable-requires-write')
      }

      if (descriptor.defaultValueFrom && !(descriptor.defaultValueFrom in SERVER_DEFAULTS)) {
        issues.push('unknown-default')
      }
    }
  }
  return issues
}

/** 取值：声明里只放键，值从唯一来源读；未知键返回 `undefined`（G6 已在测试里挡住未知键）。 */
export function resolveServerDefault(key: ServerDefaultKey): unknown {
  return SERVER_DEFAULTS[key]
}
