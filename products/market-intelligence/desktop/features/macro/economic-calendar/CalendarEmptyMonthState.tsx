import type { ReactElement } from 'react'

import { StateView } from '@platform/ui/components/state'

import type { EconomicCalendarText } from './economicCalendarText'

/**
 * A month with nothing in it.
 *
 * **No action on purpose** (product, 2026-11-09): this page has no range to widen — it draws one
 * month at a time, and what changes which month is the page header's previous/next/this-month
 * controls, which are on screen already. A second entry in the empty state would be the same screen
 * offering the same move twice.
 *
 * The product's own sentence ("本月没有已发布事件") rides the reason slot through the
 * product-sentence entry, so the specific wording survives the shared surface.
 */
export function CalendarEmptyMonthState({ text, month, dataStartDate }: {
  text: EconomicCalendarText
  /** 这一屏画的是哪个月（`YYYY-MM`）。 */
  month: string
  /** 库里最早一天有数据的日期；`undefined`＝不知道（按「没有事件」写），`null`＝库里还没有任何数据。 */
  dataStartDate?: string | null
}): ReactElement {
  /**
   * **「这个月没有发布」和「我们还没有这个月的数据」是两句话**：前者是那一个月确实空着，
   * 后者是我们的数据起点在那之后、读者往前翻当然空。起点从库里最早一天派生（`dataStartDate`），
   * 不写死日期；不知道起点时退回「没有事件」——不知道不等于「早于起点」，那也是一次编造。
   */
  const beforeDataStart = dataStartDate !== undefined && dataStartDate !== null && month < dataStartDate.slice(0, 7)
  // 两个分支各写各的 `productReason`：键必须是字面量，守卫靠它判前缀（三元拼出来的键它读不出）。
  if (beforeDataStart) {
    return <StateView
      className="mi-economic-calendar__empty-state"
      state="empty"
      reasonCode="nothing-in-window"
      size="lg"
      productReason={{ key: 'mi.calendar.before-data-start', resolve: () => text.status.beforeDataStart }}
    />
  }
  return <StateView
    className="mi-economic-calendar__empty-state"
    state="empty"
    reasonCode="nothing-in-window"
    size="lg"
    productReason={{ key: 'mi.calendar.empty-month', resolve: () => text.status.empty }}
  />
}
