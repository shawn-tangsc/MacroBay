import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { Info, Settings } from 'lucide-react'

import { getSource } from '../../../service/intelligence/application/providerRegistry'
import type { MacroIndicatorCardFact, MacroIndicatorCardKey } from '../../../service/intelligence/macro-calendar/macroIndicatorCardFacts'
import { calendarDisplayDate, calendarDisplayTime } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import type { EconomicCalendarText } from '../../features/macro/economic-calendar/economicCalendarText'
import { calendarUpcomingPolicy } from './calendarUpcomingPolicy'
import type { MacroIndicatorDrawerText } from './macroIndicatorDrawerText'
import { releaseCountdownFor } from './releaseCountdown'

/** 盘口那一档的来源名从源注册表取，不在这里写死品牌名。 */
const MARKET_PROVIDER_SOURCE_ID = 'policy-path-market'

const DAY_MS = 24 * 60 * 60 * 1000

export type IndicatorCardModel = Readonly<{
  metricKey: MacroIndicatorCardKey
  title: string
  unit: string
  /** 同一份读数里还要显示的另一个 measure（CPI 的核心年率、非农的失业率）。 */
  extraMetricKey?: MacroIndicatorCardKey
  extraLabel?: string
  /** 已发布卡那行的字段名（「下次发布」）。 */
  nextLabel?: string
}>

export type NextReleaseState =
  | Readonly<{ kind: 'date'; text: string }>
  | Readonly<{ kind: 'unreadable' }>
  | Readonly<{ kind: 'none' }>

type CardInput = Readonly<{
  card: IndicatorCardModel
  facts: ReadonlyMap<string, MacroIndicatorCardFact>
  /** 这一路读完了没有：没读完就画骨架，不画「暂无排期」这种断言。 */
  loaded: boolean
  unreadable?: boolean
  text: MacroIndicatorDrawerText
  calendarText: EconomicCalendarText
  timeZone: string
  now: string
  resolveKey: (key: string) => string
  onOpenExpectationSettings?: (metricKey: MacroIndicatorCardKey) => void
  nextReleaseOf?: (metricKey: MacroIndicatorCardKey) => NextReleaseState
}>

/**
 * 三张关键指标卡：**一个卡位、两种卡**。
 *
 * - 3 天内有过发布 → 已发布卡（值没到也是这张：那正是最该被看见的窗口）；
 * - 否则 → 下一期卡：期次与发布时刻、预期（值 + 来源）、观测、预期状态、距发布；
 *   **「较上期」不在这种卡上**——还没有实际值，「较」没有基准。最新一张已发布读数只作脚注，
 *   复用同一份事实，不另读一次。
 *
 * 判据只有时间，窗口取自 `calendarUpcomingPolicy.releasedWindowDays`（唯一出处）。
 */
export function IndicatorCards(input: Readonly<{
  cards: readonly IndicatorCardModel[]
  /** 缺席 = 这一路还没读完：卡上什么都不写，也不画「没有」。 */
  facts?: readonly MacroIndicatorCardFact[]
  unreadable?: boolean
  text: MacroIndicatorDrawerText
  calendarText: EconomicCalendarText
  timeZone: string
  now: string
  resolveKey: (key: string) => string
  /** 预期配置面板由配置线那边提供；没有这个回调就不画齿轮——不放假控件。 */
  onOpenExpectationSettings?: (metricKey: MacroIndicatorCardKey) => void
  /** 已发布卡上的「下次发布」：日期 / 读不到 / 没有，三态分开（由宿主那一次按月读给出）。 */
  nextReleaseOf?: (metricKey: MacroIndicatorCardKey) => NextReleaseState
}>): React.ReactElement {
  const byKey = new Map((input.facts ?? []).map((fact) => [fact.metricKey, fact]))
  return (
    <div className="mk-strip">
      {input.cards.map((card) => (
        <IndicatorCard key={card.metricKey} card={card} facts={byKey} loaded={input.facts !== undefined} unreadable={input.unreadable}
          text={input.text} calendarText={input.calendarText} timeZone={input.timeZone}
          now={input.now} resolveKey={input.resolveKey}
          {...(input.onOpenExpectationSettings === undefined ? {} : { onOpenExpectationSettings: input.onOpenExpectationSettings })}
          {...(input.nextReleaseOf === undefined ? {} : { nextReleaseOf: input.nextReleaseOf })} />
      ))}
    </div>
  )
}

function IndicatorCard(input: CardInput): React.ReactElement {
  const fact = input.facts.get(input.card.metricKey)
  // 还没读完就画骨架：这时候画「暂无排期 / 暂无预期」，读者会以为我们查过了。
  const variant = input.loaded ? cardVariant(fact, input.now) : 'released'
  return (
    <article className="mk-card" data-variant={variant} data-metric-key={input.card.metricKey}>
      {variant === 'released'
        ? <ReleasedCard {...input} fact={fact} />
        : <UpcomingCard {...input} fact={fact} />}
    </article>
  )
}

/**
 * 卡位该显示哪一种卡：**只看时间**（3 天内有过发布 → 已发布卡）。
 * 没有发布时刻（比如一次都还没收录）直接按下一期卡处理：那种卡不假装有本期读数。
 */
export function cardVariant(fact: MacroIndicatorCardFact | undefined, now: string): 'released' | 'upcoming' {
  const releasedAt = fact?.releasedAt
  if (releasedAt === undefined) return 'upcoming'
  const elapsed = Date.parse(now) - Date.parse(releasedAt)
  if (!Number.isFinite(elapsed)) return 'upcoming'
  return elapsed < calendarUpcomingPolicy.releasedWindowDays * DAY_MS ? 'released' : 'upcoming'
}

function ReleasedCard(input: CardInput & Readonly<{ fact: MacroIndicatorCardFact | undefined }>): React.ReactElement {
  const { fact, card, text, calendarText, timeZone, unreadable, resolveKey } = input
  const extra = card.extraMetricKey === undefined ? undefined : input.facts.get(card.extraMetricKey)
  const change = cardChangeText(fact, text)
  const stateText = cardStateText(fact, text, unreadable)
  const previous = previousText(fact, text, timeZone)
  return (
    <>
      <div className="mk-card__h"><h3>{card.title}</h3>
        {fact?.state === 'missing-current' ? <CardWhy resolveKey={resolveKey} /> : null}</div>
      <div className="mk-card__v"><b className={cardValueClass(fact, unreadable)}>{cardValueText(fact, text, unreadable)}</b>
        <span>{card.unit}</span></div>
      {change === undefined ? null : <p className="mk-card__chg">{change}</p>}
      {stateText === undefined ? null : <p className="mk-card__na-line">{stateText}</p>}
      <dl className="mk-card__facts">
        {card.extraLabel === undefined ? null
          : <div><dt>{card.extraLabel}</dt><dd>{cardValueText(extra, text, unreadable)}</dd></div>}
        <div><dt>{text.cardStates.expectedLabel}</dt><dd>{consensusText(fact, text, timeZone, input.now)}</dd></div>
        {previous === undefined ? null : <div><dt>{text.previousLabel}</dt><dd>{previous}</dd></div>}
        {input.nextReleaseOf === undefined ? null : nextReleaseRow(input.nextReleaseOf(card.metricKey), text, card)}
      </dl>
      <div className="mk-card__f">{cardSourceLabel(fact, text, calendarText)}<span>{text.detail}</span></div>
    </>
  )
}

/**
 * 下一期卡（界面设计 2026-11-14 定稿）。
 *
 * 卡头一行四样：**指标名 → 倒计时 tag → 齿轮（预期设置）→ 来源**。
 * 卡面只放数据：下次发布、预期值 + 出处、成交量（仅盘口）、观测时刻、预期状态。
 * 「为什么缺、为什么不显示」一句都不进正面——那是 ⓘ/面板的事。
 */
function UpcomingCard(input: CardInput & Readonly<{ fact: MacroIndicatorCardFact | undefined }>): React.ReactElement {
  const { fact, card, text, calendarText, unreadable, timeZone, now, onOpenExpectationSettings } = input
  const next = fact?.next
  const tag = next === undefined ? undefined : countdownTag(next, text, now, timeZone)
  const market = next?.expected?.provenance === 'market-implied'
  return (
    <>
      <div className="mk-card__h">
        <i className="mk-card__dot" aria-hidden="true" />
        <h3>{card.title}</h3>
        {tag === undefined ? null : <span className="mk-tag" data-soon={tag.soon ? 'true' : 'false'}>{tag.label}</span>}
        {onOpenExpectationSettings === undefined ? null
          : <IconButton ariaLabelKey="mk.expectationSettingsAria" icon={Settings} size="sm" variant="plain"
            resolveText={input.resolveKey} onSelect={() => onOpenExpectationSettings(card.metricKey)} />}
        <em>{sourceLabelOf(fact, calendarText, text)}</em>
      </div>
      <p className="mk-card__na-line" data-next-header>
        {next === undefined
          ? text.nextCard.headerNoSchedule
          : text.nextCard.header.replace('{period}', formatCardPeriod(next.period))
            .replace('{date}', calendarDisplayDate(next.releaseAt, timeZone).slice(5))}
      </p>
      <dl className="mk-card__facts">
        {next === undefined
          // 连排期都没有：不摆一个空的「预期 未提供」——那会看起来像查过了、只是没数。
          ? null
          : <div><dt>{text.nextCard.expected.replace('{period}', formatCardPeriod(next.period))}</dt>
            <dd>{expectedText(next, text, fact?.unit)}</dd></div>}
        {next?.expected === undefined || market
          ? null
          : <div><dt>{text.nextCard.observed}</dt><dd>{calendarDisplayTime(next.expected.asOf, timeZone)}</dd></div>}
        {next?.expected?.marketVolume === undefined ? null
          : <div><dt>{text.nextCard.volume}</dt><dd>{`$${Math.round(next.expected.marketVolume).toLocaleString('en-US')}`}</dd></div>}
        {market
          ? <div><dt>{text.nextCard.observed}</dt>
            <dd>{`${calendarDisplayTime(next!.expected!.asOf, timeZone)} ${text.nextCard.beforeRelease}`}</dd></div>
          : null}
        <div><dt>{text.nextCard.state}</dt><dd>{expectedStateText(next, text)}</dd></div>
      </dl>
      <div className="mk-card__f">
        {next === undefined || next.releaseAt === undefined
          ? <span>{text.nextCard.releaseDateUnknown}</span>
          : <span>{releaseMoment(next, timeZone, text)}</span>}
        <span>{text.detail}</span>
      </div>
    </>
  )
}

/** 预期那一格：有值就写「来源 · 值」，没有就按原因写状态——**有值必然带来源**。 */
function expectedText(next: MacroIndicatorCardFact['next'], text: MacroIndicatorDrawerText, unit?: MacroIndicatorCardFact['unit']): string {
  const expected = next?.expected
  if (expected === undefined) return text.cardStates.notAvailable
  return expected.provenance === 'market-implied'
    ? text.nextCard.marketExpected.replace('{provider}', marketProviderName())
      .replace('{value}', approxNumber(expected.value, unit))
    : text.nextCard.providerExpected.replace('{value}', formatCardNumber(expected.value, unit))
}

function expectedStateText(next: MacroIndicatorCardFact['next'], text: MacroIndicatorDrawerText): string {
  if (next === undefined) return text.nextCard.stateNoSchedule
  if (next.expected !== undefined) {
    return next.expected.provenance === 'market-implied' ? text.nextCard.stateMarket : text.nextCard.stateProvider
  }
  return next.expectedState === 'unreadable' ? text.cardStates.unreadable : text.nextCard.stateNone
}

function releaseMoment(next: NonNullable<MacroIndicatorCardFact['next']>, timeZone: string, text: MacroIndicatorDrawerText): string {
  const day = calendarDisplayDate(next.releaseAt, timeZone)
  return next.timePrecision === 'minute'
    ? `${day.slice(5)} ${calendarDisplayTime(next.releaseAt, timeZone)}`
    : `${day.slice(5)} ${text.nextCard.dateOnly}`
}

/** 距发布那个 tag：形态由 `releaseCountdownFor` 定，文案按键装配。 */
function countdownTag(
  next: NonNullable<MacroIndicatorCardFact['next']>,
  text: MacroIndicatorDrawerText,
  now: string,
  timeZone: string
): Readonly<{ label: string; soon: boolean }> | undefined {
  const countdown = releaseCountdownFor({
    now,
    nowDate: calendarDisplayDate(now, timeZone),
    releaseAt: next.releaseAt,
    releaseDate: calendarDisplayDate(next.releaseAt, timeZone),
    ...(next.timePrecision === undefined ? {} : { timePrecision: next.timePrecision })
  })
  if (countdown.kind === 'past') return undefined
  if (countdown.kind === 'days') {
    return countdown.days === 0
      ? { label: text.countdown.today, soon: false }
      : { label: text.countdown.days.replace('{days}', String(countdown.days)), soon: false }
  }
  if (countdown.kind === 'countdown') {
    return { label: text.countdown.hoursMinutes.replace('{hours}', String(countdown.hours)).replace('{minutes}', String(countdown.minutes)), soon: true }
  }
  return { label: text.countdown.minutes.replace('{minutes}', String(countdown.minutes)), soon: true }
}

/** 脚注：最新一张已发布读数（复用同一份事实，不另读一次）。 */
function latestNote(
  fact: MacroIndicatorCardFact | undefined,
  card: IndicatorCardModel,
  text: MacroIndicatorDrawerText,
  timeZone: string,
  unreadable?: boolean
): React.ReactNode {
  if (unreadable === true) return <span>{text.nextCard.latestUnreadable}</span>
  if (fact === undefined || fact.value === undefined) return <span>{text.nextCard.latestNone}</span>
  return (
    <span>
      {text.nextCard.latest
        .replace('{period}', formatCardPeriod(fact.period))
        .replace('{value}', cardValueText(fact, text))
        .replace('{source}', sourceName(fact, text))
        .replace('{at}', calendarDisplayTime(fact.releasedAt ?? '', timeZone))}
    </span>
  )
}

function sourceLabelOf(fact: MacroIndicatorCardFact | undefined, calendarText: EconomicCalendarText, text: MacroIndicatorDrawerText): string {
  if (fact?.source === 'fred') return text.sourceFred
  if (fact?.source === 'narwhal') return calendarText.market.source
  return ''
}

function sourceName(fact: MacroIndicatorCardFact, text: MacroIndicatorDrawerText): string {
  if (fact.source === 'fred') return text.sourceFred
  return text.nextCard.latestSourceCalendar
}

function marketProviderName(): string {
  return getSource(MARKET_PROVIDER_SOURCE_ID)?.displayName ?? ''
}

/** 盘口反推的是档位中点，不是精确值：写「约」，并且不加正负号（和旁边的实际值区分开）。 */
function approxNumber(value: number, unit: MacroIndicatorCardFact['unit']): string {
  if (unit === 'percent') return `约 ${value.toFixed(1)}%`
  return `约 ${Math.round(value)}K`
}

/** 「下次发布」：没有这一格就不画——写「未提供」会让人以为今天该有一次发布。 */
function nextReleaseRow(state: NextReleaseState, text: MacroIndicatorDrawerText, card: IndicatorCardModel): React.ReactNode {
  if (state.kind === 'none') return null
  return (
    <div>
      <dt>{nextReleaseLabel(card)}</dt>
      <dd>{state.kind === 'date' ? state.text : text.cardStates.unreadable}</dd>
    </div>
  )
}

function nextReleaseLabel(card: IndicatorCardModel): string {
  return card.nextLabel ?? ''
}

function cardValueClass(fact: MacroIndicatorCardFact | undefined, unreadable?: boolean): string | undefined {
  return !unreadable && fact?.state === 'provided' ? undefined : 'mk-card__na'
}

function cardValueText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, unreadable?: boolean): string {
  if (unreadable) return text.cardStates.unreadable
  if (fact === undefined) return ''
  if (fact.state === 'provided' && fact.value !== undefined) return formatCardNumber(fact.value, fact.unit)
  return text.cardStates.notAvailable
}

function cardChangeText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText): string | undefined {
  if (fact?.state !== 'provided' || fact.value === undefined || fact.previousAsPublished === undefined) return undefined
  return text.cardStates.vsPrevious.replace('{value}', formatDelta(fact.value - fact.previousAsPublished, fact.unit))
}

function cardStateText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, unreadable?: boolean): string | undefined {
  if (unreadable || fact === undefined) return undefined
  if (fact.state === 'provided') return undefined
  if (fact.state === 'not-recorded') return text.cardStates.notRecorded
  return fact.period === undefined
    ? text.cardStates.missingCurrentNoPeriod
    : text.cardStates.missingCurrent.replace('{period}', formatCardPeriod(fact.period))
}

function previousText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, timeZone: string): string | undefined {
  if (fact === undefined) return undefined
  if (fact.previousUnreadable === true) return text.cardStates.unreadable
  if (fact.previousAsPublished === undefined) return undefined
  const value = formatCardNumber(fact.previousAsPublished, fact.unit)
  if (fact.previousSource === 'fred' && fact.previousObservedAt !== undefined) {
    return text.cardStates.previousPeriodFrom
      .replace('{value}', value)
      .replace('{source}', text.sourceFred)
      .replace('{period}', formatCardPeriod(fact.previousObservedAt.slice(0, 7)))
  }
  return value
}

/** 「预期」一格（已发布卡）：值 + 出处与观测时刻，三样齐全才显示；没有写「暂无预期」。 */
function consensusText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, timeZone: string, nowInstant: string): string {
  const consensus = fact?.consensus
  if (consensus === undefined) return text.cardStates.noConsensus
  const day = calendarDisplayDate(consensus.asOf, timeZone)
  const short = day.slice(0, 4) === calendarDisplayDate(nowInstant, timeZone).slice(0, 4) ? day.slice(5) : day
  return text.cardStates.consensusSource
    .replace('{source}', text.nextCard.providerExpected).replace('{value}', formatCardNumber(consensus.value, fact?.unit))
    .replace('{asOf}', short)
}

function cardSourceLabel(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, calendarText: EconomicCalendarText): React.ReactNode {
  const provider = fact?.source
  if (provider === 'fred') return <span>{text.sourceFred}</span>
  return provider === 'narwhal' ? <span>{calendarText.market.source}</span> : null
}

/** 卡头的 ⓘ：解释「为什么没有这个数」。卡面正文不放解释性句子。 */
function CardWhy({ resolveKey }: Readonly<{ resolveKey: (key: string) => string }>): React.ReactElement {
  return <Popover
    labelKey="mk.cardWhy"
    resolveText={resolveKey}
    trigger={(triggerProps) => <IconButton {...triggerProps} ariaLabelKey="mk.cardWhyAria"
      icon={Info} size="sm" variant="plain" resolveText={resolveKey} />} />
}

function formatCardNumber(value: number, unit: MacroIndicatorCardFact['unit']): string {
  if (unit === 'thousands') return `${value > 0 ? '+' : ''}${Math.round(value)}K`
  if (unit === 'percent') return `${value.toFixed(1)}%`
  return String(value)
}

function formatDelta(value: number, unit: MacroIndicatorCardFact['unit']): string {
  if (unit === 'thousands') return `${value > 0 ? '+' : ''}${Math.round(value)}K`
  if (unit === 'percent') return `${value > 0 ? '+' : ''}${value.toFixed(1)}pp`
  return String(value)
}

/** `2026-10` → `10 月`；别的形状原样返回（不猜）。 */
function formatCardPeriod(period: string | undefined): string {
  const match = /^\d{4}-(\d{2})$/.exec(period ?? '')
  return match ? `${Number(match[1])} 月` : (period ?? '')
}
