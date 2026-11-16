import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import type { MarketCalendarEvent, MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import {
  assessMarketCalendarSurprise,
  toCalendarSurpriseView,
  type MarketCalendarSurpriseAssessment
} from '../../../../contracts/macro/marketCalendarSurprise'
import { formatReadableAnalysisValue } from '../../../../contracts/marketAnalysisReadableText'
import type { EconomicCalendarText } from './economicCalendarText'
import { calendarCountryLabel } from './calendarCountryLabel'
import { calendarDisplayDate, calendarDisplayTime } from './economicCalendarDayModel'
import { MarketCalendarSourceStatus } from './MarketCalendarSourceStatus'

/**
 * 来源显示名：**feed id → 名字**，认不出用「未标来源」，都不是就退回旧的通用名。
 *
 * 顺序按定稿：`sourceFeedId`（行上的真值）优先，旧 `source` 兜底。绝不把 feed id 原串印给读者，
 * 也不把「不知道来源」写成「没有这条发布」。
 */
export function sourceLabel(text: { market: { source: string
  sourceByFeed?: Readonly<Record<string, string>>; sourceUnknown?: string } }, source: string): string {
  if (source === 'unspecified') return text.market.sourceUnknown ?? text.market.source
  return text.market.sourceByFeed?.[source] ?? text.market.source
}

export function MarketCalendarInspector({ event, source, text }: { event: MarketCalendarEvent; source?: MarketCalendarSource; text: EconomicCalendarText }) {
  const timeZone = useShellTimeZone()
  const language = useShellLanguage()
  const timeZoneLabel = formatShellTimeZoneLabel(timeZone, language)
  const formatTime = useShellTimeFormat()
  const surprise = assessMarketCalendarSurprise(event.providerActual, event.consensus)
  // CalendarObservedDataTimePolicy: a paged read may advance a source past the observation the reader
  // selected, so the live source and the observation legitimately disagree. The observation is still
  // shown — with **its own** values and the time it belongs to — and the disagreement is reported by
  // the status line below rather than blanking the pane. The newer source's time is never attached to
  // the older reading: that is the rule this used to enforce by rendering nothing at all.
  const sourceAgrees = source !== undefined && source.eventType === event.eventType &&
    source.sourceObservedAt === event.sourceObservedAt
  /**
   * 「事件内容」那一段能说的两件事，都只从**这条记录自己的字段**取（用户 2026-11-13 #7）。
   *
   * 覆盖指标分三档，不许合并成一句话：
   * - 记录里带了 `measureKeys` → 列出来；
   * - 带了但是空数组 → 这条事件本来就不覆盖指标（讲话、会议），写「这条事件不覆盖指标」；
   * - 字段根本没带 → 源这一条没给，写「源未给出」。
   * 后两种是「没有」的两种来路，混成一句读者就分不清是源没给还是本来没有。
   */
  const measureKeys = event.measureKeys
  const coverageText = measureKeys === undefined
    ? text.details.valueNotProvided
    : measureKeys.length === 0
      ? text.details.contentCoverageNone
      : measureKeys.join(' · ')
  /** 事件标识：身份键优先，其次源自己的事件 id；两样都没有才写「源未给出」。 */
  const identityText = event.eventNameKey ?? event.seriesId ?? text.details.valueNotProvided
  /**
   * 层级那一行的一句话：子项给母名，母项给分项列表（`、` 连接）。
   * 需要的名字不齐时返回 `undefined`——**整行不显示**，比画一个「所属指标：源未给出」更少误导：
   * 这一行本来就是补充信息，没有就不占位。
   */
  const hierarchy = event.hierarchy
  const hierarchyText = hierarchy === undefined
    ? undefined
    : hierarchy.kind === 'child'
      ? hierarchy.parentName === undefined ? undefined
        : text.details.hierarchyOwned.replace('{name}', hierarchy.parentName)
      : hierarchy.childNames === undefined || hierarchy.childNames.length === 0 ? undefined
        : text.details.hierarchyChildren.replace('{names}',
          hierarchy.childNames.join(text.details.hierarchySeparator))
  const shownSource: MarketCalendarSource = sourceAgrees
    ? source
    : { eventType: event.eventType, status: 'success', sourceObservedAt: event.sourceObservedAt }
  return <aside className="mi-economic-calendar__inspector mi-market-calendar__inspector" aria-live="polite">
    <p>{sourceLabel(text, event.source)} · {text.market.kinds[event.eventType]}</p><h2>{event.title}</h2>
    <p><MarketCalendarSourceStatus source={shownSource} text={text} variant="full" /></p>
    <dl className="mi-economic-calendar__metadata">
      {/* 合并后同一期可能发过多次（GDP 二读/三读）：**每一次排期都列出来**，只写合并后的那一个，
          读者会把二读当初值。序号是事实（第几次），时间也是事实，两者之间不写阶段名。 */}
      <div><dt>{text.details.time}</dt><dd>
        {event.releaseDates !== undefined && event.releaseDates.length > 1
          ? <span data-release-dates>{event.releaseDates.map((date, index) => <span key={date} data-release-date>
            {text.details.releaseOrdinal.replace('{index}', String(index + 1))} · {date}{index === event.releaseDates!.length - 1 ? '' : '　'}
          </span>)}</span>
          : <>{calendarDisplayDate(event.scheduledAt, timeZone)} {calendarDisplayTime(event.scheduledAt, timeZone)} {timeZoneLabel}</>}
      </dd></div>
      <div><dt>{text.market.observed}</dt><dd>{formatTime(event.sourceObservedAt, 'second')}</dd></div>
      <div><dt>{text.details.source}</dt><dd data-market-country>{calendarCountryLabel(event, text)} · {sourceLabel(text, event.source)}</dd></div>
      {/* 源没给重要性就是「未提供」：不许挑一档顶上去（读者会以为那是源的判断）。 */}
      <div data-market-importance><dt>{text.details.importance}</dt><dd>{event.importance === undefined
        ? text.market.missingValue
        : text.market.importance[event.importance as 'high' | 'medium' | 'low']}</dd></div>
    </dl>
    {/* 事件内容（用户 2026-11-13 #7；边界由 Chief 2026-11-16 划）：只用记录里已有的字段，
        取不到就如实说，不拿别的事件凑。数据里还没有一句话式的事件描述，所以这一段现在能给的是
        「它覆盖哪些指标」与「它是哪一条」；描述从哪来要产品定，落到库里之后在这里加一行。 */}
    <section className="mi-calendar-content" data-calendar-content>
      <h3>{text.details.content}</h3>
      <dl className="mi-economic-calendar__metadata">
        <div data-content-coverage><dt>{text.details.contentCoverage}</dt><dd>{coverageText}</dd></div>
        <div data-content-identity><dt>{text.details.contentIdentity}</dt><dd>{identityText}</dd></div>
        {/* 指标层级（用户 2026-11-17）：子项说清「属于谁」，母项列出「由哪些分项组成」。
            名字由服务端从层级表取；两样都拿不到时**整行不画**，不留空标签。 */}
        {hierarchyText === undefined ? null : <div data-content-hierarchy>
          <dt>{text.details.contentHierarchy}</dt><dd>{hierarchyText}</dd>
        </div>}
      </dl>
    </section>
    {event.eventType === 'economic-indicator' ? <div className="mi-economic-calendar__values">
      {(['consensus', 'providerActual', 'providerPrevious'] as const).map(key => <div key={key} data-market-value={key}>
        <span>{text.market[key]}</span><strong>{event[key]?.displayValue ?? text.market.missingValue}</strong>
      </div>)}
      {/* 预期差读契约同一函数：三种语态与看板卡片逐字一致，缺少预期时不出现任何数字。 */}
      {event.providerActual ? <div data-market-value="surprise" data-surprise={toCalendarSurpriseView(surprise)}>
        <span>{text.market.surprise}</span><strong>{surpriseText(surprise, text, language)}</strong>
      </div> : null}
    </div> : null}
    {event.officialLink ? <div data-linked-official-values>
      <div data-linked-value="officialActual"><span>{text.market.officialActual}</span><strong>{event.officialLink.officialActual?.displayValue ?? text.market.missingValue}</strong></div>
      <div data-linked-value="officialPrevious"><span>{text.market.officialPrevious}</span><strong>{event.officialLink.officialPrevious?.displayValue ?? text.market.missingValue}</strong></div>
      <p data-linked-time-source>{event.officialLink.timeDisplaySource === 'official-scheduled' ? text.market.linkedTimeOfficial : event.officialLink.timeDisplaySource === 'provider-scheduled' ? text.market.linkedTimeProvider : text.market.linkedTimePending} · {event.officialLink.displayScheduledAt ?? text.market.missingValue}</p>
    </div> : null}
    <p className="mi-economic-calendar__comparison-rule">{text.market.comparison}</p>
  </aside>
}

/** The drawer's sentence for one assessment; no number is printed without a presentation. */
function surpriseText(
  assessment: MarketCalendarSurpriseAssessment,
  text: EconomicCalendarText,
  locale: 'zh-CN' | 'en-US'
): string {
  const direction = toCalendarSurpriseView(assessment)
  if (direction === 'consensus-unavailable') {
    return assessment.reason === 'missing-consensus' ? text.market.surpriseUnavailable : text.market.surpriseNotComparable
  }
  const label = direction === 'beat' ? text.market.surpriseBeat
    : direction === 'miss' ? text.market.surpriseMiss : text.market.surpriseInline
  if (direction === 'inline' || assessment.presentation === null) return label
  return `${label} ${formatReadableAnalysisValue(assessment.presentation.value, assessment.presentation.unit, locale)}`
}
