import { useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { ChevronLeft, ChevronRight, Info } from 'lucide-react'

import type { MacroIndicatorCardFact, MacroIndicatorCardKey } from '../../../service/intelligence/macro-calendar/macroIndicatorCardFacts'
import { calendarDisplayDate, calendarDisplayTime } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import type { EconomicCalendarText } from '../../features/macro/economic-calendar/economicCalendarText'
import type { MacroIndicatorDrawerText } from './macroIndicatorDrawerText'
import { releaseCountdownFor } from './releaseCountdown'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// 行量纲的唯一定义在数据层（分组表所在模块），这里只引用，不另立一份。
import type { MacroIndicatorRowKind } from '../../../service/intelligence/macro-calendar/macroIndicatorCardGroups'
type IndicatorRowKind = MacroIndicatorRowKind

export type IndicatorRow = Readonly<{ metricKey: MacroIndicatorCardKey; label: string; kind: IndicatorRowKind }>

export type IndicatorCardGroup = Readonly<{
  id: string
  title: string
  /** 四行，顺序即左右两卡的**逐行对齐**顺序（行位永不删、不折、不藏）。 */
  rows: readonly IndicatorRow[]
}>

/**
 * 三张关键指标卡：**每个指标一行，左「已发布」、右「下次发布」，两卡同时在场**。
 * 结构照 `2026-11-14-核心指标卡片-正常态.html` 还原：head（点 / 名 / tag / 来源）、
 * when（期次与时刻）、四行「标签 · 值 · 预期差」、卡底一句来源与口径。
 */
export function IndicatorCards(input: Readonly<{
  groups: readonly IndicatorCardGroup[]
  /** 缺席 = 这一路还没读完：卡上什么都不写，也不画「没有」。 */
  facts?: readonly MacroIndicatorCardFact[]
  unreadable?: boolean
  text: MacroIndicatorDrawerText
  calendarText: EconomicCalendarText
  timeZone: string
  now: string
  resolveKey: (key: string) => string
  /** 卡头的两个箭头；由轮播容器注入，两种页共用同一组入口。 */
  nav?: React.ReactNode
}>): React.ReactElement {
  const byKey = new Map((input.facts ?? []).map((fact) => [fact.metricKey, fact]))
  return (
    <div className="mk-strip">
      {input.groups.map((group) => (
        <Carousel key={group.id} group={group} byKey={byKey} {...input} />
      ))}
    </div>
  )
}

type CardInput = Readonly<{
  group: IndicatorCardGroup
  byKey: ReadonlyMap<string, MacroIndicatorCardFact>
  facts?: readonly MacroIndicatorCardFact[]
  unreadable?: boolean
  text: MacroIndicatorDrawerText
  calendarText: EconomicCalendarText
  timeZone: string
  now: string
  resolveKey: (key: string) => string
  /** 卡头的两个箭头；由轮播容器注入，两页共用同一组入口。 */
  nav?: React.ReactNode
}>


/**
 * 一个指标一个卡位、卡里两页：**已发布**（左）与**下次发布**（右）。
 *
 * 四个切换入口都有：卡头两个真实箭头、卡下两个圆点、焦点在卡上时的键盘左右键、
 * 以及浏览器的横向滚动手势（不作为唯一入口——桌面用户不一定有触控板）。
 * 两页各 4 行、卡高固定，切换只换内容，行位不变。
 */
function Carousel(input: CardInput): React.ReactElement {
  // 默认打开**未来**那页：读者打开这张卡，想看的就是「接下来会怎样」；已发布页往左翻。
  const [page, setPage] = useState<'past' | 'next'>('next')
  const { group, text } = input
  const move = (next: 'past' | 'next'): void => setPage(next)
  const nav = (
    <span className="mk-nav">
      <IconButton ariaLabelKey="mk.carousel.prev" icon={ChevronLeft} size="sm" variant="plain"
        resolveText={input.resolveKey} onSelect={() => move('past')} />
      <IconButton ariaLabelKey="mk.carousel.next" icon={ChevronRight} size="sm" variant="plain"
        resolveText={input.resolveKey} onSelect={() => move('next')} />
    </span>
  )
  return (
    <div className="mk-carousel" data-pair={group.id} role="group" tabIndex={0}
      aria-label={group.title}
      onKeyDown={(event) => {
        // 只处理左右键；不拦其它键，输入框里的左右键仍归输入框。
        if (event.key === 'ArrowLeft') { event.preventDefault(); move('past') }
        if (event.key === 'ArrowRight') { event.preventDefault(); move('next') }
      }}>
      {/* 一刻只挂一页：屏幕阅读器不该把看不见的那页也读一遍。 */}
      {page === 'past'
        ? <PastCard {...input} nav={nav} />
        : <NextCard {...input} nav={nav} />}
    </div>
  )
}

/** 左卡：这一期已发布的值 + 预期差。超过 3 天不挂 tag，整卡降权。 */
function PastCard(input: CardInput): React.ReactElement {
  const { group, byKey, text, calendarText, timeZone, unreadable, resolveKey, now } = input
  const facts = group.rows.map((row) => byKey.get(row.metricKey))
  const lead = facts.find((fact) => fact !== undefined)
  const tag = publishedTag(lead, text, now)
  const loaded = input.facts !== undefined
  return (
    <article className="mk-card mk-card--past" data-card="released">
      <div className="mk-card__head">
        <span className="mk-dot" />
        <h4>{group.title}</h4>
        {tag === undefined ? null : <span className="mk-tag mk-tag--past">{tag}</span>}
        {input.nav}
        <span className="mk-src">{sourceLabelOf(lead, calendarText, text)}</span>
      </div>
      <div className="mk-when">
        {loaded && lead?.period !== undefined && lead.releasedAt !== undefined
          ? text.cardFace.whenPublished.replace('{period}', lead.period).replace('{time}', stamp(lead.releasedAt, timeZone))
          : ''}
        {lead?.state === 'missing-current' ? <CardWhy resolveKey={resolveKey} /> : null}
      </div>
      <div className="mk-rows">
        {group.rows.map((row) => <ReleasedRow key={row.metricKey} row={row} fact={byKey.get(row.metricKey)}
          text={text} unreadable={unreadable} loaded={loaded} />)}
      </div>
      <div className="mk-card__foot">
        <span>{sourceLine(lead, text, calendarText, timeZone)}</span>
      </div>
    </article>
  )
}

function ReleasedRow(input: Readonly<{
  row: IndicatorRow
  fact: MacroIndicatorCardFact | undefined
  text: MacroIndicatorDrawerText
  unreadable?: boolean
  loaded: boolean
}>): React.ReactElement {
  const { row, fact, text, unreadable, loaded } = input
  const value = unreadable || !loaded ? undefined : fact?.state === 'provided' ? fact.value : undefined
  const missing = loaded && !unreadable && value === undefined
  const chip = chipText(fact, row, text)
  return (
    <div className="mk-vrow">
      <dt>{row.label}</dt>
      <dd {...(missing ? { 'data-na': 'true' } : {})}>{value === undefined
        ? (unreadable ? text.cardStates.unreadable : loaded ? text.cardStates.notAvailable : '')
        : formatValue(value, row.kind)}</dd>
      <span className="mk-chipwrap">{chip === undefined ? null : <span className={`mk-chip mk-chip--${chip.tone}`}>{chip.label}</span>}</span>
    </div>
  )
}

/** 右卡：下一期同一批码的预期；**行位与左卡逐行对齐**，缺就写「暂无预期」。 */
function NextCard(input: CardInput): React.ReactElement {
  const { group, byKey, text, calendarText, timeZone, now } = input
  const facts = group.rows.map((row) => byKey.get(row.metricKey))
  const lead = facts.find((fact) => fact !== undefined)
  const next = lead?.next
  const tag = next === undefined ? undefined : countdownTag(next, text, now, timeZone)
  const loaded = input.facts !== undefined
  const rows = group.rows.map((row) => ({ row, fact: byKey.get(row.metricKey) }))
  const missing = rows.filter((entry) => entry.fact?.next?.expected === undefined).length
  // 四行全都没有预期：只剩一句「本期暂无预期（盘未开）」——写「另 4 项」会暗示还有别的内容。
  // 一到三行缺：逐行写「暂无预期」，不折叠（折叠会把「少数有值」也一起藏掉）。
  const allMissing = missing === rows.length
  const shown = allMissing ? [] : rows
  const market = rows.some((entry) => entry.fact?.next?.expected?.provenance === 'market-implied')
  const volume = rows.map((entry) => entry.fact?.next?.expected?.marketVolume).find((entry) => entry !== undefined)
  const observedAt = rows.map((entry) => entry.fact?.next?.expected?.asOf)
    .filter((entry): entry is string => entry !== undefined).sort().pop()
  return (
    <article className="mk-card mk-card--next" data-card="upcoming">
      <div className="mk-card__head">
        <span className="mk-dot" />
        <h4>{group.title}</h4>
        {tag === undefined ? null : <span className="mk-tag" data-tier={tag.tier}>{tag.label}</span>}
        {input.nav}
        <span className="mk-src">{sourceLabelOf(lead, calendarText, text)}</span>
      </div>
      <div className="mk-when">
        {!loaded ? ''
          : next === undefined
            ? text.cardFace.noSchedule
            : text.cardFace.whenNext.replace('{period}', next.period)
              .replace('{date}', calendarDisplayDate(next.releaseAt, timeZone).slice(5))}
      </div>
      {allMissing
        // 整页只剩一句话：它在卡片里水平+垂直居中，否则贴着左上角，看着像没加载完。
        ? <div className="mk-card__empty">{text.cardFace.expectedAllMissing}</div>
        : <div className="mk-rows">
          {shown.map((entry) => (
            <div className="mk-vrow" key={entry.row.metricKey}>
              <dt>{entry.row.label}</dt>
              <dd {...(entry.fact?.next?.expected === undefined ? { 'data-na': 'true' } : {})}>
                {expectedValueText(entry.fact, entry.row, text)}
              </dd>
              <span className="mk-chipwrap" />
            </div>
          ))}
        </div>}
      <div className="mk-card__foot">
        {allMissing
          ? null
          : <span>{stateLine({ rows, text, timeZone, market, volume, observedAt })}</span>}
      </div>
    </article>
  )
}

/** 右卡一整行的文字：有预期写值（盘口那档带「约」），没有就是「暂无预期」。 */
function expectedValueText(fact: MacroIndicatorCardFact | undefined, row: IndicatorRow, text: MacroIndicatorDrawerText): string {
  const expected = fact?.next?.expected
  if (expected === undefined) return text.cardFace.expectedMissing
  return expected.provenance === 'market-implied'
    ? text.cardFace.approx.replace('{value}', formatValue(expected.value, row.kind))
    : formatValue(expected.value, row.kind)
}

/**
 * 右卡底部那一行：有盘写成交量与观测（并注明是发布前取的），有值没盘写状态与观测，
 * 都没有就写「暂无预期」——三种情形读者要能分开。
 */
function stateLine(input: Readonly<{
  rows: readonly Readonly<{ fact: MacroIndicatorCardFact | undefined }>[]
  text: MacroIndicatorDrawerText
  timeZone: string
  market: boolean
  volume: number | undefined
  observedAt: string | undefined
}>): string {
  const { rows, text, timeZone, market, volume, observedAt } = input
  if (volume !== undefined) {
    return `${text.cardFace.volume.replace('{value}', `$${Math.round(volume).toLocaleString('en-US')}`)} · ${text.cardFace.observed.replace('{time}', `${calendarDisplayTime(observedAt ?? '', timeZone)} ${text.cardFace.beforeRelease}`)}`
  }
  if (observedAt !== undefined) {
    return `${text.cardFace.expectedState.replace('{state}', market ? text.cardFace.stateMarket : text.cardFace.stateProvider)} · ${text.cardFace.observed.replace('{time}', calendarDisplayTime(observedAt, timeZone))}`
  }
  const noSchedule = rows.every((entry) => entry.fact?.next === undefined)
  return text.cardFace.expectedState.replace('{state}', noSchedule ? text.cardFace.stateNoSchedule : text.cardFace.expectedMissing)
}

/** 预期差那一格：方向只有三种，`0.0pp` 是「正好」不是「没有」。 */
function chipText(
  fact: MacroIndicatorCardFact | undefined,
  row: IndicatorRow,
  text: MacroIndicatorDrawerText
): Readonly<{ label: string; tone: 'up' | 'down' | 'flat' }> | undefined {
  const value = fact?.value
  const expected = fact?.consensus?.value
  if (value === undefined || expected === undefined) return undefined
  const diff = value - expected
  const flat = Math.abs(diff) <= (row.kind === 'change' ? 0.5 : 0.05)
  const label = `${formatDiff(flat ? 0 : diff, row.kind)} · ${flat ? text.cardFace.chipFlat : diff > 0 ? text.cardFace.chipUp : text.cardFace.chipDown}`
  return { label, tone: flat ? 'flat' : diff > 0 ? 'up' : 'down' }
}

/** 已发布页的时间标签：**无条件渲染**，文案按阶梯往下来（分钟 → 小时 → 昨天/前天 → N 天前）。 */
function publishedTag(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, now: string): string | undefined {
  const releasedAt = fact?.releasedAt
  if (releasedAt === undefined) return undefined
  const elapsed = Date.parse(now) - Date.parse(releasedAt)
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined
  // 取整方向与倒计时相反：已过的时间向下取整，<1 分钟统一写 1 分钟（不出现「0 分钟」）。
  if (elapsed < HOUR_MS) return text.published.minutes.replace('{minutes}', String(Math.max(1, Math.floor(elapsed / MINUTE_MS))))
  if (elapsed < DAY_MS) return text.published.hours.replace('{hours}', String(Math.floor(elapsed / HOUR_MS)))
  const days = Math.floor(elapsed / DAY_MS)
  if (days === 1) return text.published.yesterday
  if (days === 2) return text.published.beforeYesterday
  return text.published.daysAgo.replace('{days}', String(days))
}

/** 距发布那个 tag：形态由 `releaseCountdownFor` 定，文案按键装配。 */
function countdownTag(
  next: NonNullable<MacroIndicatorCardFact['next']>,
  text: MacroIndicatorDrawerText,
  now: string,
  timeZone: string
): Readonly<{ label: string; tier: 'far' | 'near' | 'imminent' }> | undefined {
  const countdown = releaseCountdownFor({
    now,
    nowDate: calendarDisplayDate(now, timeZone),
    releaseAt: next.releaseAt,
    releaseDate: calendarDisplayDate(next.releaseAt, timeZone),
    ...(next.timePrecision === undefined ? {} : { timePrecision: next.timePrecision })
  })
  if (countdown.kind === 'past') return undefined
  if (countdown.kind === 'days') {
    // 7 天以外也是强调色（只是不加粗）：它提醒「还有多少天」，不该看起来像次要信息。
    return countdown.days === 0
      ? { label: text.countdown.today, tier: 'imminent' }
      : { label: text.countdown.days.replace('{days}', String(countdown.days)), tier: countdown.days <= 7 ? 'near' : 'far' }
  }
  if (countdown.kind === 'countdown') {
    return { label: text.countdown.hoursMinutes.replace('{hours}', String(countdown.hours)).replace('{minutes}', String(countdown.minutes)), tier: 'imminent' }
  }
  return { label: text.countdown.minutes.replace('{minutes}', String(countdown.minutes)), tier: 'imminent' }
}

/** 值：人数类带号（+165K），年率与失业率不带正号，月率与时薪带正负号。 */
function formatValue(value: number, kind: IndicatorRowKind): string {
  if (kind === 'change') return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Math.round(value))}K`
  const size = Math.abs(value).toFixed(1)
  if (kind === 'yoy' || kind === 'rate') return `${value < 0 ? '−' : ''}${size}%`
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${size}%`
}

/** 预期差：百分比用 pp、人数用 K；`0` 写 `0.0pp` 且不带符号（它表示「正好」）。 */
function formatDiff(diff: number, kind: IndicatorRowKind): string {
  if (kind === 'change') {
    return `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(Math.round(diff))}K`
  }
  return `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff).toFixed(1)}pp`
}

function stamp(instant: string, timeZone: string): string {
  return `${calendarDisplayDate(instant, timeZone).slice(5)} ${calendarDisplayTime(instant, timeZone)}`
}

function sourceLine(
  fact: MacroIndicatorCardFact | undefined,
  text: MacroIndicatorDrawerText,
  calendarText: EconomicCalendarText,
  timeZone: string
): string {
  const source = sourceLabelOf(fact, calendarText, text)
  if (fact?.releasedAt === undefined) return source
  return text.cardFace.sourceLine.replace('{source}', source).replace('{time}', stamp(fact.releasedAt, timeZone))
}

function sourceLabelOf(fact: MacroIndicatorCardFact | undefined, calendarText: EconomicCalendarText, text: MacroIndicatorDrawerText): string {
  if (fact?.source === 'fred') return text.sourceFred
  if (fact?.source === 'narwhal') return calendarText.market.source
  return ''
}

/** 卡头的 ⓘ：解释「为什么没有这个数」。卡面正文不放解释性句子。 */
function CardWhy({ resolveKey }: Readonly<{ resolveKey: (key: string) => string }>): React.ReactElement {
  return <Popover
    labelKey="mk.cardWhy"
    resolveText={resolveKey}
    trigger={(triggerProps) => <IconButton {...triggerProps} ariaLabelKey="mk.cardWhyAria"
      icon={Info} size="sm" variant="plain" resolveText={resolveKey} />} />
}
