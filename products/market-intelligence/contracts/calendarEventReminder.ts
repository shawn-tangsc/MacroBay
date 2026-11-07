/**
 * 日历事件「开始前」提醒的配置与**三层「与」判定**（情报需求 §十六，v1.2 技术方案 §7）。
 *
 * 三层是同一件事的三个闸，最后只会**收窄**，不会放宽：
 * 1. **批准表**（上限）：两条日历通知各自批准了哪些表面；同一份选择管两条，所以可用面取**交集**；
 * 2. **两个总开关**（总闸）：手机推送、应用内提示各自的总开关；
 * 3. **这一份选择**（最后一道）：读者在「日历事件」详情里勾的那两个勾。
 *
 * 第三层**由平台存**（投递与两个总开关都在平台；产品再存一份必现「页面勾了、推送没按它走」）。
 * 所以这份配置里**没有** `surfaces`：产品读平台给的组选择，只用它做判定。
 *
 * **桌面不在这份类型里**：两条日历通知都没有批桌面，所以它不是「禁用」，而是**不存在**——
 * 给出一个灰着的勾，读者会以为「打开就能弹」。
 */

/** 组键用语义、不用产品名；一份选择同时管「开始前」与「发生后」两条通知。 */
export const CALENDAR_REMINDER_GROUP_KEY = 'calendar-events'

export const CALENDAR_REMINDER_MEMBERS = Object.freeze([
  'market-intelligence.calendar.event-upcoming',
  'market-intelligence.macro.event-landed'
] as const)

export type CalendarReminderMember = (typeof CALENDAR_REMINDER_MEMBERS)[number]

/** 提前档：不加 5 分钟档——扫描周期就是 5 分钟，同量级等于承诺做不到的精度。 */
export const CALENDAR_REMINDER_LEAD_MINUTES = Object.freeze([15, 30, 60, 120] as const)

export type CalendarReminderLeadMinutes = (typeof CALENDAR_REMINDER_LEAD_MINUTES)[number]

export type CalendarReminderImportance = 'high' | 'medium' | 'low'

/** 读者能勾的表面。`center` 不在这里：通知中心恒收，不是可选项。 */
export type CalendarReminderSurface = 'channel' | 'toast'

export const CALENDAR_REMINDER_SURFACES = Object.freeze(['channel', 'toast'] as const)

export type CalendarReminderSettings = Readonly<{
  /** 默认关：打开之前不落记录也不推，这一下必须由读者自己按。 */
  enabled: boolean
  leadMinutes: CalendarReminderLeadMinutes
  /** 默认只推「高」：只勾高时每天约 4–9 条。 */
  importance: readonly CalendarReminderImportance[]
}>

export const DEFAULT_CALENDAR_REMINDER_SETTINGS: CalendarReminderSettings = Object.freeze({
  enabled: false,
  leadMinutes: 60,
  importance: Object.freeze(['high'] as const)
})

export function isCalendarReminderLeadMinutes(value: unknown): value is CalendarReminderLeadMinutes {
  return typeof value === 'number' && (CALENDAR_REMINDER_LEAD_MINUTES as readonly number[]).includes(value)
}

export function isCalendarReminderImportance(value: unknown): value is CalendarReminderImportance {
  return value === 'high' || value === 'medium' || value === 'low'
}

/**
 * 第一条闸：**可用面 = 两条成员批准表的交集**，且只保留读者能勾的那两个。
 *
 * 取交集是有意的：同一份选择管两条通知，若某条没批某个表面，那个勾就对一条生效、对另一条
 * 不生效——读者勾了「应用内提示」，结果只有一半会闪，而页面看起来一切正常。
 */
export function availableCalendarReminderSurfaces(
  approvals: Readonly<Record<CalendarReminderMember, readonly string[]>>
): readonly CalendarReminderSurface[] {
  return CALENDAR_REMINDER_SURFACES.filter((surface) =>
    CALENDAR_REMINDER_MEMBERS.every((member) => approvals[member].includes(surface))
  )
}

/**
 * 三层「与」：批准表 ∩ 总开关 ∩ 这一份选择。
 *
 * **没有「默认开」的特例**：选择里缺省（`undefined`）按「允许」处理——读者把提醒打开、
 * 却没勾任何表面，多半是还没勾过，不是「不要」；而**显式 `false` 才是关**，全关时就一条都不投。
 */
export function decideCalendarReminderSurfaces(input: Readonly<{
  approvals: Readonly<Record<CalendarReminderMember, readonly string[]>>
  /** 两个总开关；缺省按「开」，与平台总开关的默认一致。 */
  master: Readonly<Partial<Record<CalendarReminderSurface, boolean>>>
  selection: Readonly<Partial<Record<CalendarReminderSurface, boolean>>>
}>): Readonly<Record<CalendarReminderSurface, boolean>> {
  const available = availableCalendarReminderSurfaces(input.approvals)
  const decided: Record<CalendarReminderSurface, boolean> = { channel: false, toast: false }
  for (const surface of CALENDAR_REMINDER_SURFACES) {
    decided[surface] = available.includes(surface)
      && input.master[surface] !== false
      && input.selection[surface] !== false
  }
  return decided
}

/** 底层两层都允许、但这一份选择把它们**全部**显式关掉：这条要能被单独判出来。 */
export function isCalendarReminderSelectionSilent(
  decision: Readonly<Record<CalendarReminderSurface, boolean>>
): boolean {
  return !decision.channel && !decision.toast
}
