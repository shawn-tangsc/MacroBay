import type {
  CalendarLandedFilter,
  CalendarReminderImportance,
  CalendarReminderLeadMinutes,
  CalendarReminderSettings
} from '../../../contracts/calendarEventReminder'
import {
  normalizeCalendarLandedCountries,
  type CalendarLandedCountrySelection
} from '../../../contracts/calendarLandedCountries'

const PRODUCT_ID = 'market-intelligence'

/**
 * 「日历事件 · 开始前」配置的读写（设置页第四条详情的「开始前」段）。
 *
 * 页面**只读服务结果、只写这一段**：三层「与」由服务端算，页面不自己推。
 * 写的返回就是服务端认下的那份，页面拿它渲染，不做本地乐观更新。
 */
export type CalendarReminderSettingsView = Readonly<{
  enabled: boolean
  leadMinutes: CalendarReminderLeadMinutes
  importance: readonly CalendarReminderImportance[]
  landedFilter: CalendarLandedFilter
  landedCountries: CalendarLandedCountrySelection
}>

/** 写的两个结果：存上了、没存上。页面在后者保留读者刚选的值，并说"这次没存上"。 */
export type CalendarReminderWriteOutcome =
  | Readonly<{ state: 'saved'; settings: CalendarReminderSettingsView }>
  | Readonly<{ state: 'not-saved'; settings: CalendarReminderSettingsView }>

type Invoke = (productId: string, method: string, payload?: unknown) => Promise<unknown>

function invoke(): Invoke | undefined {
  const products = (window as unknown as { platform?: { products?: { invoke?: Invoke } } }).platform?.products
  return products?.invoke ? products.invoke.bind(products) : undefined
}

function toView(value: unknown): CalendarReminderSettingsView {
  if (!value || typeof value !== 'object') throw new Error('calendar reminder settings: unexpected shape')
  const raw = value as Partial<CalendarReminderSettings>
  if (typeof raw.enabled !== 'boolean') throw new Error('calendar reminder settings: missing enabled')
  return {
    enabled: raw.enabled,
    leadMinutes: raw.leadMinutes ?? 60,
    importance: raw.importance ?? ['high'],
    landedFilter: raw.landedFilter ?? 'surprise-only',
    landedCountries: normalizeCalendarLandedCountries(raw.landedCountries)
  }
}

export type CalendarReminderClient = Readonly<{
  read: () => Promise<CalendarReminderSettingsView>
  write: (patch: Readonly<Partial<CalendarReminderSettingsView>>) => Promise<CalendarReminderWriteOutcome>
}>

export const intelligenceReminderClient: CalendarReminderClient = {
  async read() {
    const send = invoke()
    if (send === undefined) throw new Error('product IPC bridge is unavailable')
    return toView(await send(PRODUCT_ID, 'intelligence.getCalendarReminderSettings'))
  },
  async write(patch) {
    const send = invoke()
    if (send === undefined) throw new Error('product IPC bridge is unavailable')
    const raw = await send(PRODUCT_ID, 'intelligence.setCalendarReminderSettings', patch)
    // 服务端回的是判别式结果；形状不对就当作失败，不猜成"存上了"。
    if (!raw || typeof raw !== 'object') throw new Error('calendar reminder settings: unexpected write result')
    const record = raw as { state?: unknown; settings?: unknown }
    const settings = toView(record.settings)
    return record.state === 'saved' ? { state: 'saved', settings } : { state: 'not-saved', settings }
  }
}
