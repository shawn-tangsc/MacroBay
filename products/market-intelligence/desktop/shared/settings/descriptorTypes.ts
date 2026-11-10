/**
 * 设置定义注册表的**形状与选项数据**（C2 第一步：只声明，不渲染）。
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
 * 选项集合（值、锁定项）是**数据**，住在这里；选项的句子住各自文案表，注册表不抄句子。
 */

import { IpcChannels } from '@platform/desktop/ipc/channels'

import {
  CALENDAR_REMINDER_LEAD_MINUTES,
  DEFAULT_CALENDAR_REMINDER_SETTINGS
} from '../../../contracts/calendarEventReminder'
import {
  CALENDAR_LANDED_COUNTRY_CODES,
  DEFAULT_CALENDAR_LANDED_COUNTRIES
} from '../../../contracts/calendarLandedCountries'
import { DEFAULT_NEWS_PUSH_THRESHOLD } from '../../../contracts/newsSentimentTiers'

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

/** 允许出现在哪些面。本版只许 `settings`；另两个是预留位，出现即不合法。 */
export const SETTING_SURFACES = ['settings', 'drawer', 'panel'] as const
export type SettingSurface = (typeof SETTING_SURFACES)[number]

/** 值的归属：`product` = 产品存储；`platform` = 平台设置（命令写或只读）。 */
export type SettingLevel = 'product' | 'platform'

/** 未实现项无控件、无写、无默认值，渲染一行说明；不许画成禁用控件。 */
export type SettingAvailability = 'live' | 'unimplemented'

/** 这一行读到的视图；`keyedBy` 行由页面把实例键与投影事实拼进来。 */
export type SettingView = unknown

/** 控件可选项只许来自这里声明的集合，不许在行里手写列表。 */
export type SettingOptionsSource =
  | 'news-push-thresholds'
  | 'calendar-reminder-leads'
  | 'calendar-reminder-importance'
  | 'calendar-landed-filter'
  | 'calendar-landed-scopes'
  | 'calendar-landed-country-codes'
  | 'collection-presets'
  | 'notification-surfaces'

/** 本版五种控件；文本输入与动作按钮不进注册表（契约 §1.1）。 */
export type SettingField =
  | { readonly kind: 'switch' }
  | { readonly kind: 'select'; readonly optionsFrom: SettingOptionsSource }
  | { readonly kind: 'multiSelect'; readonly optionsFrom: SettingOptionsSource }
  | { readonly kind: 'number'; readonly min?: number; readonly max?: number; readonly step?: number; readonly unitKey?: string }
  | { readonly kind: 'readonly' }

/** 平台命令清单：命令写的对照表，也把「写一个不存在的命令」变成编译期错误。 */
export const PLATFORM_COMMANDS = Object.values(IpcChannels)
export type PlatformCommandId = (typeof IpcChannels)[keyof typeof IpcChannels]

/**
 * 默认值的唯一来源：只放共享契约/服务端常量引用，声明里只放这张表的键。
 * 运行期分不出「引用的 false」和「手写的 false」，所以默认值用类型强制（写字面量编译不过）。
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
  /** 按视图里的列表实例化：每源一行 / 每个日历 feed 一行。注册表里不写实例清单。 */
  keyedBy?: 'sourceId' | 'feedId'
  menu: SettingMenuId
  surfaces: readonly SettingSurface[]
  level: SettingLevel
  field: SettingField
  read: Readonly<{ command: string; select: (view: unknown) => unknown }>
  write?: SettingWrite
  /** 值缺失时显示什么：只许是 `SERVER_DEFAULTS` 的键（编译期）。 */
  defaultValueFrom?: ServerDefaultKey
  /**
   * 何时出现：**只依赖 `view`，只有一个参数**；假 = 不渲染，不是禁用。
   *
   * 契约 §1 ⑧ / G10：条件要用的能力事实（如「这个源是否纳入情绪分析」）必须先放进视图，
   * 由页面算视图时一并给出。**不开「渲染层另传上下文」的口子**——口子一开，每行都能自带一个
   * 判断依据，同一份事实就散成多份。视图里缺这条事实 ⇒ 整行不渲染，不许默认 `true`。
   */
  visibleWhen?: (view: SettingView) => boolean
  /**
   * 行名：静态行用 `labelKey`；按实例化的行可用 `labelText(view)` 取视图数据（来源名/feed 名）。
   * `labelText` 只许出现在 `keyedBy` 行上，且**不许写字面量句子**。
   */
  copy?: Readonly<{ labelKey?: string; helpKey?: string }>
  labelText?: (view: SettingView) => string
  availability: SettingAvailability
}>

/** 一个选项：值 + 是否固定勾选（`locked` 的项读者不能取消）。 */
export type SettingOption = Readonly<{ value: string | number; locked?: boolean }>

/**
 * `optionsFrom` 的选项集合：**数据在注册表，句子在文案表**。页面只把这些值交给控件，
 * 不另抄一份列表；`notification-surfaces` 的 `center` 是固定勾选项（通知中心恒收）。
 */
export const SETTING_OPTION_SETS: Readonly<Record<SettingOptionsSource, readonly SettingOption[]>> = Object.freeze({
  'news-push-thresholds': Object.freeze([{ value: 'low' }, { value: 'medium' }, { value: 'high' }]),
  'calendar-reminder-leads': Object.freeze(CALENDAR_REMINDER_LEAD_MINUTES.map((value) => ({ value }))),
  'calendar-reminder-importance': Object.freeze([{ value: 'high' }, { value: 'medium' }, { value: 'low' }]),
  'calendar-landed-filter': Object.freeze([{ value: 'surprise-only' }, { value: 'also-matched' }]),
  'calendar-landed-scopes': Object.freeze([{ value: 'us' }, { value: 'all' }, { value: 'custom' }]),
  'calendar-landed-country-codes': Object.freeze(CALENDAR_LANDED_COUNTRY_CODES.map((value) => ({ value }))),
  'collection-presets': Object.freeze([{ value: 'manual' }, { value: 'balanced' }, { value: 'frequent' }]),
  'notification-surfaces': Object.freeze([
    // 中心恒收：选项在、但固定勾选且不能取消；不靠「少一项」表达。
    { value: 'center', locked: true },
    { value: 'channel' },
    { value: 'toast' },
    { value: 'desktop' }
  ])
})

/** 从 `unknown` 视图里取具名字段；取不到就是 `undefined`，不让渲染层猜。 */
export function readViewField(view: unknown, field: string): unknown {
  if (typeof view !== 'object' || view === null) return undefined
  return field in view ? (view as Record<string, unknown>)[field] : undefined
}

/** 读一份「面 → 勾没勾」的选择；只认布尔值，别把字符串 truthy 当勾上。 */
export function readSelection(value: unknown, surface: string): boolean | undefined {
  const selected = readViewField(value, surface)
  return typeof selected === 'boolean' ? selected : undefined
}

/** 两个选择之间**第一个变化的面**：命令一次只收一个面的增量。 */
export function firstChangedSurface(before: unknown, after: unknown): string | undefined {
  if (typeof after !== 'object' || after === null) return undefined
  const keys = new Set(Object.keys(after as Record<string, unknown>))
  if (typeof before === 'object' && before !== null) {
    for (const key of Object.keys(before as Record<string, unknown>)) keys.add(key)
  }
  for (const key of keys) {
    if (readSelection(before, key) !== readSelection(after, key)) return key
  }
  return undefined
}
