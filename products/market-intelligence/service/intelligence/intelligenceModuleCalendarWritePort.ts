import { readStandardWriteFailures } from './application/calendarStandardWriteReader'
import type { CalendarStandardWriteLayer } from './macro-calendar/calendarStandardWriteLayer'
import type { SourceWriteFailureView } from './application/calendarStandardWriteReader'

/**
 * 标准表**写库失败**的 late-bound 读口（用户 2026-11-19/20）。
 *
 * 与 `setPolicyPathQuery` / `bindBriefingCalendarRefresh` 同形：装配根在日历后端建好之后把写入层
 * 交进来，`sourcesService` 取视图时**现读、不缓存**（回填/迁移落完立刻生效）。
 *
 * **未绑定时 `readFailures()` 返回 undefined**——视图里不出现任何写失败字段，那是「还没接上」，
 * 不是「没失败」。读口本身的四态（失败/没失败/还没写过/读不到）在 `calendarStandardWriteReader`，
 * 这里只做「读一次并翻译」，不重复判断。
 */
export type CalendarStandardWriteLayerReader = () => Pick<CalendarStandardWriteLayer, 'get'>

export type CalendarStandardWritePort = Readonly<{
  /** 装配根调用一次；重复绑定以最后一次为准（晚绑定，不缓存）。 */
  bind: (read: CalendarStandardWriteLayerReader) => void
  /** sources 侧读口；未绑定 → undefined。 */
  readFailures: () => SourceWriteFailureView | undefined
}>

export function createCalendarStandardWritePort(): CalendarStandardWritePort {
  let reader: CalendarStandardWriteLayerReader | undefined
  return {
    bind: (read) => { reader = read },
    readFailures: () => (reader === undefined ? undefined : readStandardWriteFailures(reader()))
  }
}
