import type { UnmappedCalendarObservation } from '../../../../service/intelligence/macro-calendar/rendering/marketCalendarUnmappedMonthRead'
import { calendarCountryLabel } from './calendarCountryLabel'
import { calendarDisplayTime } from './economicCalendarDayModel'
import type { EconomicCalendarText } from './economicCalendarText'

/**
 * 「未入标准表」那一组里的一行：**不进标准表的观测，照样是一条事件**。
 *
 * 三条与标准表行**故意不同**（用户 2026-11-16 定）：
 * - 行首 `data-unmapped="true"` + 那根 2px 竖标：读者一眼能分清「这条没进标准表」；
 * - **没有状态、没有重要性、没有类型字形**——这些都是标准表才有的判断，未映射行没有，
 *   也**不许为了齐整给它编一个**；
 * - 国家照常显示（原值 → 名字 → 「未知国家」都走同一个函数），时间没有就写「待定」。
 *
 * 它复用标准表行的类名与栅格（时间 | 国家 | 标题），所以两种行混在一起时列是对齐的。
 */
export function UnmappedCalendarEventRow({ observation, text, timeZone, unmappedAria }: Readonly<{
  observation: UnmappedCalendarObservation
  text: EconomicCalendarText
  timeZone: string
  /** 读屏在可访问名末尾补的那句（视觉上不重复，行内不写字）。 */
  unmappedAria: string
}>): React.ReactElement {
  const country = calendarCountryLabel({ countryCode: observation.countryCode }, text)
  // 没有时刻就是「待定」——**不编一个 00:00**：那会让读者以为它发生在半夜。
  const time = observation.scheduledAt === undefined
    ? text.unifiedDay.timePending
    : calendarDisplayTime(observation.scheduledAt, timeZone)
  return <div className="mi-economic-calendar__event" data-unmapped="true" data-unmapped-key={observation.key}
    aria-label={`${time} ${country} ${observation.title} · ${unmappedAria}`}>
    <span className="mi-economic-calendar__event-time">{time}</span>
    {/* 这一格**永远有内容**（名字 → 原值 → 未知国家），所以属性也永远在：没有它，读者看不出
        这一行「有国家这一格、只是不知道是哪国」。 */}
    <span className="mi-economic-calendar__event-country" data-event-country>{country}</span>
    <span className="mi-economic-calendar__event-title">{observation.title}</span>
  </div>
}
