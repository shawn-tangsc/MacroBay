import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { ChevronDown, Info } from 'lucide-react'

import { ExpectationChart, type ExpectationPoint } from './ExpectationChart'
import { MiniReleaseCalendar } from './MiniReleaseCalendar'
import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import { CalendarDayEventList } from '../../features/macro/economic-calendar/CalendarDayEventList'
import { CalendarInspector } from '../../features/macro/economic-calendar/CalendarInspector'
import { MarketCalendarInspector } from '../../features/macro/economic-calendar/MarketCalendarEvents'
import type { EconomicCalendarText } from '../../features/macro/economic-calendar/economicCalendarText'
import type { CalendarDayItem } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import { productText } from '../../shared/i18n/productText'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { calendarDisplayDate, calendarDisplayTime } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import { useCalendarMonthReleases } from './useCalendarMonthReleases'
import { PolicyPathCard, PolicyPathUnavailable, type PolicyPathCardText } from './PolicyPathCard'
import { policyPathMonth } from './policyPathMonth'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import {
  expectationBp, expectationEventMoves, matchedRelevantKey, POLICY_PATH_EVENT_RELEVANT_SERIES_IDS
} from '../../../contracts/policyPath'
import type { MacroIndicatorCardFact, MacroIndicatorCardKey } from '../../../service/intelligence/macro-calendar/macroIndicatorCardFacts'
import { Drawer } from '@platform/ui/components/drawer'
import { macroIndicatorDrawerText, type MacroIndicatorDrawerText } from './macroIndicatorDrawerText'
import { nextMeasuredSize } from './macroIndicatorDrawerMeasure'
import { IndicatorCards, type IndicatorCardGroup } from './IndicatorCards'
import { MACRO_INDICATOR_GROUPS } from '../../../service/intelligence/macro-calendar/macroIndicatorCardGroups'

import './macroIndicatorDrawer.css'

/**
 * 关键指标 · 预期变化。
 *
 * 两条数据的来路不同，这里说清，免得下一个人以为整张抽屉都是装饰：
 * - **利率数学期望曲线与政策利率卡读真数据**：曲线来自同一次读数里的逐点序列（`probability.series`），
 *   政策卡复用宿主已经读到的那一份，抽屉里不再取第二遍。
 * - **迷你日历与右列当日事件也是真数据**：走宿主那一次按月读（与曲线标注同一份），
 *   抽屉里没有示例日程；读不到画错误态、没有事件画空态、正在读画等待态，不回退任何示意数据。
 *
 * 版式逐项照 `2026-11-13-K11-b.html`（1280 抽屉、正文 1248、左列 828 + 右列 403、间距 16）。
 */


/**
 * 图上标注用的短名：取**让这条发布命中清单的那个指标**的名字，其次主 measure，最后日历标题。
 *
 * 为什么先看 `measureKeys`：一次发布覆盖多个指标，主 measure 可能不是解释这次跳动的那个
 * （CPI 那行的主 measure 是核心月率，命中清单的却是整体年率）。
 */
function shortEventLabel(
  event: Readonly<{ label: string; eventNameKey?: string; measureKeys?: readonly string[]; seriesId?: string }>,
  text: MacroIndicatorDrawerText
): string {
  if (event.seriesId === 'usa-policy-rate-decision') return text.eventNames.decision
  if (event.seriesId === 'usa-monetary-policy-minutes') return text.eventNames.minutes
  const matched = matchedRelevantKey({ at: '', label: event.label, ...(event.measureKeys ? { measureKeys: event.measureKeys } : {}) })
  return nameOfMetricKey(matched ?? event.eventNameKey, text) ?? event.label
}

function nameOfMetricKey(key: string | undefined, text: MacroIndicatorDrawerText): string | undefined {
  switch (key) {
    case 'US.CPI.NSA.YOY': return text.eventNames.cpi
    case 'US.CORE_CPI.NSA.YOY': return text.eventNames.coreCpi
    case 'US.NONFARM.SA.CHANGE': return text.eventNames.payrolls
    case 'US.CORE_PCE.NSA.YOY': return text.eventNames.corePce
    default: return undefined
  }
}

export function MacroIndicatorDrawer({ locale, open = true, onClose, onConfigure, onRetryPolicy, policyReading, policyText, onOpenPolicyDetail, releaseEvents, cardFacts, cardFactsUnreadable, now, readMarketEvents }: Readonly<{
  locale: 'zh-CN' | 'en-US'
  /**
   * 受控开关。宿主**常挂**这个组件、只翻 `open`，关闭动画与「焦点回原位」才跑得完；
   * 条件挂载会让它在关的瞬间被卸载，antd 收不到关闭完成，焦点也就回不去「详情」。
   */
  open?: boolean
  onClose: () => void
  /**
   * 曲线与政策利率卡读**同一份读数**：宿主已经读到的那一份，抽屉里不再取第二遍。
   * 读不到时不编数——曲线与卡各自走「读不到」形态。
   */
  policyReading?: PolicyPathReading
  policyText: PolicyPathCardText
  onOpenPolicyDetail?: () => void
  /**
   * 曲线窗口内已发生的发布/事件（有名字、有时刻），用来在曲线上标注「这一刻动了多少」。
   *
   * 由宿主从**它已经读到的日历结果**里取；抽屉不为此另发一次日历请求。缺省就是没有标注。
   */
  releaseEvents?: readonly Readonly<{ at: string; label: string; eventNameKey?: string; measureKeys?: readonly string[]; seriesId?: string }>[]
  /**
   * 三张简化卡的取值事实（按 `metric_key` 取，新源优先、缺则旧源）。
   *
   * 缺席且 `cardFactsUnreadable` 为假 = 这一路还没读完：卡上什么都不写，
   * 也不写「未提供」——那是「来源没给」，不是「还没读到」。
   */
  cardFacts?: readonly MacroIndicatorCardFact[]
  /** 读数**没读出来**（IPC 失败/端口没通）：卡写「暂时读不到」，与三态里的「未提供」分开。 */
  cardFactsUnreadable?: boolean
  /**
   * 抽屉的「现在」（规范 UTC 毫秒）。今天、已发布/待发布、以及本月那次读的快照都用它。
   *
   * 缺席才退回 `new Date()`：单挂组件（用例、别的落点）没有宿主时钟。
   */
  now?: string
  /**
   * 这个月的市场事件：**宿主已有的那次按月读**，与曲线标注同一份。
   *
   * 不许在这里另开通道——两处各读一次，格子里有点、右列却没有行。
   */
  readMarketEvents?: (month: string, asOf: string) => Promise<readonly unknown[] | null>
  /**
   * 右列的行**没有动作**：日期详情只以抽屉形态出现（用户 2026-11-13 定），而这里还没有接上
   * 「复用同一个详情抽屉」。按红线不画假控件——行渲染成非交互形态，不传 `onSelect`。
   *
   * 翻案条件：产品确认「日详情抽屉保留、且能带日期打开」时，才在同一条通道上打开**同一个**抽屉；
   * 不许为了这个入口新开页面、不许跳日历页。
   */
  /**
   * 读数没读出来时的唯一动作：重读一次，不跳转。
   *
   * **必填**：错误态不带动作出不去（StateView 的 `error.unreadable` 规定要有），而一个点了没反应的
   * 「再试一次」正是要禁的假按钮。宿主必须给出真实的重新读入口。
   */
  onRetryPolicy: () => void
  /** 「配置日历」的去处；宿主给不出落点时按钮禁用，不画假按钮。 */
  onConfigure?: () => void
}>): React.ReactElement {
  const text: MacroIndicatorDrawerText = macroIndicatorDrawerText[locale]
  // 平台 Drawer 与 Popover 都只收键；这张表把本抽屉的键映到产品自己的文案表（查表，不是 key→句子的分支）。
  const drawerKeys: Readonly<Record<string, string>> = {
    'mk.title': text.title,
    'mk.rateNote': text.rateNote,
    'mk.rateNoteAria': text.rateNoteAria,
    'mk.cardWhy': text.missingCurrentWhy,
    'mk.cardWhyAria': text.missingCurrentWhyAria,
    'mk.carousel.prev': text.carousel.prev,
    'mk.carousel.next': text.carousel.next
  }
  const resolveDrawerKey = (key: string): string => drawerKeys[key] ?? ''
  // 复用日历页那套行组件，文案用同一份产品表，不另写一套词汇。
  const calendarText = productText[locale].pages.intelligence.portal.calendar
  const dayListRef = useRef<HTMLDivElement | null>(null)
  // The right column scrolls on its own; the drawer body does not.
  const timeZone = useShellTimeZone()
  /**
   * 「现在」只取一次：宿主给了就用宿主的，没给才在挂载时取。
   *
   * **读操作不许把「每次渲染都变的现在时刻」放进依赖。** 这里踩过一次：`asOf` 每渲染都是新字符串，
   * 按月的读跟着无限重读——用例表现为整文件挂死，真机上表现为反复打接口 + 界面忽明忽暗，
   * 后者比用例挂死更难发现。要么在挂载时取一次，要么按分钟粒度节流。
   */
  const fallbackNow = useMemo(() => new Date().toISOString(), [])
  const nowInstant = now ?? fallbackNow
  const today = calendarDisplayDate(nowInstant, timeZone)
  // 月份与选中日是两个真状态：换月清掉选中的那一天，由「今天 / 最近一个有事件的日子」重新定。
  const [month, setMonth] = useState(today.slice(0, 7))
  const [pickedDay, setPickedDay] = useState<Readonly<{ month: string; day: string }> | undefined>(undefined)
  const releases = useCalendarMonthReleases({
    enabled: open,
    month,
    asOf: nowInstant,
    locale,
    ...(readMarketEvents ? { readMarketEvents } : {})
  })
  const eventDays = useMemo(() => new Set(releases.events.map((event) => calendarDisplayDate(event.scheduledAt, timeZone))),
    [releases.events, timeZone])
  const selectedDay = pickedDay !== undefined && pickedDay.month === month
    ? pickedDay.day
    : defaultDayFor(month, eventDays, today)
  const dayEvents = useMemo(() => releases.events
    .filter((event) => calendarDisplayDate(event.scheduledAt, timeZone) === selectedDay)
    .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt)),
  [releases.events, selectedDay, timeZone])
  const changeMonth = (next: string): void => { setMonth(next); setPickedDay(undefined) }
  // 右列按「能不能解释利率路径」筛，与曲线标注同一把尺子（判据来自契约，不在这里另写一份）。
  const dayLayers = useMemo(() => splitDayLayers(dayEvents), [dayEvents])
  /**
   * 三张卡的分组来自数据层的唯一出处（`MACRO_INDICATOR_GROUPS`）：这里只把键译成文案，
   * 不另写一份分组——设置页也从同一张表派生，两处不会各长各的。
   */
  const cardGroups = useMemo<readonly IndicatorCardGroup[]>(() => MACRO_INDICATOR_GROUPS.map((group) => ({
    id: group.id,
    title: text.cards[group.titleKey].title,
    rows: group.rows.map((row) => ({
      metricKey: row.metricKey,
      label: text.cardRows[row.labelKey],
      kind: row.kind
    }))
  })), [text])

  // 核心层为空、但这一天还有别的发布时**默认展开**：收起会让页面同时写着「没有事件」和「其他 27 条」，
  // 中间空一大片。显式切换过就按读者的选择，换一天再回到默认。
  const othersDefaultOpen = dayLayers.core.length === 0 && dayLayers.other.length > 0
  const [othersExpanded, setOthersExpanded] = useState<boolean | undefined>(undefined)
  /** 右列点一条事件 → 与经济日历页同一个详情抽屉（`CalendarInspector`，左侧 inline 浮层）。 */
  const [detailEvent, setDetailEvent] = useState<MarketCalendarEvent | undefined>(undefined)
  const showOthers = othersExpanded ?? othersDefaultOpen
  // 展开态跟着日期走，不跟着抽屉走。
  useEffect(() => { setOthersExpanded(undefined) }, [selectedDay])
  /**
   * 图的尺寸：0 表示**还没量到**。
   *
   * 结构约定（这块已经三次跑出格子：横条、面板被裁、整张图压到右边的卡上）：
   * **图、读数面板、事件标注，任何一部分都不许出现在自己的盒子之外。**
   * 所以尺寸只认量到的值，量不到就不画；不要用「先给一个默认宽高」「给个地板」
   * 「用 overflow 裁掉」这三种方式兜底——前两种会画到格子外，第三种会把面板一起裁掉。
   */
  const [plotWidth, setPlotWidth] = useState(0)
  const [plotHeight, setPlotHeight] = useState(0)
  const plotRef = useRef<HTMLDivElement | null>(null)
  const heroRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  const measure = useCallback(() => {
    // 写回值永远来自「量到的那个数」：量不到（首帧 clientWidth=0）就保持上一次的值，
    // 不给自己任何地板宽度/高度——地板正是「量 340 写 380」这种自激的入口。
    const host = plotRef.current
    setPlotWidth((previous) => nextMeasuredSize(previous, host ? Math.floor(host.clientWidth) : 0))
    // 行高由卡片内容决定：量卡本身（它的第一个子元素），不是量被拉伸过的槽位。
    const card = heroRef.current?.firstElementChild ?? heroRef.current
    if (card) setPlotHeight((previous) => nextMeasuredSize(previous, Math.ceil(card.getBoundingClientRect().height)))
  }, [])

  /**
   * 用**回调 ref** 量尺寸，而不是挂在组件上的 `useLayoutEffect`。
   *
   * 抽屉的内容是 antd 在打开后挂进来的：组件的 layout effect 第一次跑时 `.mk-plot` 还没挂上
   * （实测 `plotRef.current === null`），于是尺寸一直是 0；以前用 560/264 的初始值掩盖了这件事，
   * 而那个假尺寸正是「整张图比格子宽、压到右边卡片」的来源。回调 ref 在节点真正挂上时触发，
   * 量到的就是真实盒子；ResizeObserver 跟上后续的尺寸变化。
   */
  const attachPlot = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    plotRef.current = node
    if (!node) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    if (heroRef.current) observer.observe(heroRef.current)
    observerRef.current = observer
  }, [measure])

  const attachHero = useCallback((node: HTMLDivElement | null) => {
    heroRef.current = node
    measure()
    if (node && observerRef.current) observerRef.current.observe(node)
  }, [measure])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  // 序列 → 曲线的逐点值。公式只有一份（契约里的 `expectationBp`），这里只负责搬。
  const points = useMemo<readonly ExpectationPoint[]>(() => {
    const series = policyReading?.probability?.series
    if (!series) return []
    return series.flatMap((point) => {
      const bp = expectationBp(point.values)
      return Number.isFinite(bp) ? [{ at: point.at, bp, values: point.values }] : []
    })
  }, [policyReading])
  const latestBp = points[points.length - 1]?.bp
  const delta = policyReading?.probability?.expectationChange24hBp
  // 三种变化句各有各的边界：没有基准说「无历史可比」，不是 +0.0bp；差 0 才说持平。
  const deltaText = delta === undefined
    ? text.rateNoHistory
    : Math.abs(delta) < 0.05
      ? text.rateFlat
      : (delta > 0 ? text.rateDeltaUp : text.rateDeltaDown).replace('{value}', Math.abs(delta).toFixed(1))
  const truncatedDays = policyReading?.probability?.seriesTruncated && points.length > 1
    ? Math.max(1, Math.ceil((Date.parse(points[points.length - 1]!.at) - Date.parse(points[0]!.at)) / 86_400_000))
    : undefined
  const policyMonth = policyReading ? policyPathMonth(policyReading.meetingDate, locale) : ''
  const factOf = (key: MacroIndicatorCardKey): MacroIndicatorCardFact | undefined =>
    cardFacts?.find((fact) => fact.metricKey === key)
  const cpiFact = factOf('US.CPI.NSA.YOY')
  const coreCpiFact = factOf('US.CORE_CPI.NSA.YOY')
  const payrollsFact = factOf('US.NONFARM.SA.CHANGE')
  const pceFact = factOf('US.CORE_PCE.SA.YOY')
  const unemploymentFact = factOf('US.UNEMPLOYMENT.SA.RATE')
  // 事件标注：推动量、±15 分钟窗口、同窗不归因、最多 5 条——规则全在契约里，这里只搬。
  // 图上用短名（完整标题不上图）；名字按身份取，不按标题文本猜。
  const eventMarks = useMemo(() => {
    const series = policyReading?.probability?.series
    if (!series || !releaseEvents?.length) return []
    const named = releaseEvents.map((event) => ({ ...event, label: shortEventLabel(event, text) }))
    return expectationEventMoves(series, named)
  }, [policyReading, releaseEvents, text])

  // 挂到 body：抽屉是 1280 的右侧浮层，如果落在右栏或某个 overflow 容器里，会被祖先裁掉——
  // 表现正是「点了没反应」。portal 让它以视口为参照，和其它浮层同一层。
  // 平台 `Drawer` 的 modal 档：遮罩、锁焦点、点遮罩关闭、Esc、关闭后焦点回位都是它的能力，
  // 不再在非模态壳上补一套手写的行为。
  return <Drawer
    open={open}
    mode="modal"
    size="full"
    className="mk-drawer"
    titleKey="mk.title"
    resolveText={(key: string) => drawerKeys[key] ?? ''}
    footer={<><span>{text.dataBy}</span> <a className="mk-foot-a" href="https://narwhalapi.com" target="_blank" rel="noreferrer">Narwhal API</a></>}
    onClose={onClose}
  >
    <section className="mk-sec" aria-label={text.title}>
      <div className="mk-col-l">
        <div className="mk-sechead">
          {/* 标题与说明图标是一组：图标永远挨着它解释的那一行标题，不被读数和变化值挤开。
              说明句不挂在正文里——正文只留数字，读法收进这颗 ⓘ 的浮层。 */}
          <div className="mk-sec__title">
            <h2 className="mk-sec__t">{text.rateTitle}</h2>
            <Popover
              labelKey="mk.rateNote"
              resolveText={resolveDrawerKey}
              trigger={(triggerProps) => <IconButton {...triggerProps} ariaLabelKey="mk.rateNoteAria"
                icon={Info} size="sm" variant="plain" resolveText={resolveDrawerKey} />} />
          </div>
          {latestBp === undefined
            ? <b className="mk-sec__v mk-sec__v--absent">{text.rateUnreadable}</b>
            : <b className="mk-sec__v">{latestBp.toFixed(1)}<i className="mk-sec__u">{text.rateUnit}</i></b>}
          {latestBp === undefined
            ? null
            : <span className="mk-sec__d" data-flat={delta === undefined || Math.abs(delta) < 0.05 ? 'true' : 'false'}>{deltaText}</span>}
          {truncatedDays === undefined ? null : <span className="mk-sec__note">{text.rateTruncated.replace('{days}', String(truncatedDays))}</span>}
        </div>

        <div className="mk-view">
          <div className="mk-plot" ref={attachPlot}>
            {/* 没量到尺寸（`plotWidth/plotHeight` 为 0）就不画图：占位保留，布局不跳，也不会画到格子外。 */}
            {points.length && plotWidth > 0 && plotHeight > 0
              ? <ExpectationChart points={points} events={eventMarks} height={plotHeight} width={plotWidth}
                latest={delta === undefined ? {} : { changeBp: delta }}
                text={{
                  aria: text.chartAria,
                  outcomes: policyText.shortOutcomes,
                  expectation: text.panelExpectation,
                  vsYesterday: text.panelVsYesterday,
                  flat: text.panelFlat,
                  noHistory: text.rateNoHistory
                }} />
              : points.length
                // 有数据、只是还没量到格子：什么都不画，容器自己占位。别把它画成「没有数据」。
                ? null
                : policyReading
                  ? <StateView state="empty" reasonCode="nothing-in-window" />
                  : <StateView state="error" reasonCode="unreadable"
                    action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRetryPolicy }} />}
          </div>
          {/* 政策利率卡：设计照现有那张「利率路径」卡，数据用宿主已读到的那一份；
              读不到时画既有「读不到」形态，不编数。右边这块占位壳保持 300 宽、随行拉齐。 */}
          <div className="mk-policy-slot" ref={attachHero}>
            {policyReading
              ? <PolicyPathCard reading={policyReading} text={policyText} month={policyMonth} {...(onOpenPolicyDetail ? { onOpen: onOpenPolicyDetail } : {})} />
              : <PolicyPathUnavailable state="unreadable" text={policyText} onRetry={onRetryPolicy} />}
          </div>
        </div>

        <IndicatorCards groups={cardGroups} {...(cardFacts === undefined ? {} : { facts: cardFacts })}
          {...(cardFactsUnreadable === true ? { unreadable: true } : {})}
          text={text} calendarText={calendarText} timeZone={timeZone} now={nowInstant}
          resolveKey={resolveDrawerKey} />
        <MiniReleaseCalendar text={text} month={month} today={today} selectedDay={selectedDay}
          events={releases.events} timeZone={timeZone} now={nowInstant}
          state={releases.state} refreshing={releases.refreshing}
          onSelectDay={(day) => setPickedDay({ month, day })}
          onMonthChange={changeMonth} onRefresh={releases.reload}
          {...(onConfigure === undefined ? {} : { onConfigure })} />
      </div>

      {/* 右列直接复用日历页的当日事件列表（用户 2026-11-13）：三种状态分开，谁也不冒充另一种。 */}
      <div className="mk-col-r" ref={dayListRef}>
        {releases.state === 'unavailable'
          ? <StateView state="error" reasonCode="unreadable"
            action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: releases.reload }} />
          : releases.state === 'ready'
            ? <>
              {/* 自动挑到别的日子时要说清是哪一天、为什么——否则读者以为标题里的日期是「今天」。 */}
              {pickedDay === undefined && selectedDay !== today
                ? <p className="mk-col-r__note" data-day-not-today>{text.mkDay.notToday}</p> : null}
              <CalendarDayEventList
                label={calendarText.dayEvents.listLabel}
                title={calendarText.dayEvents.title.replace('{date}', selectedDay)}
                // 右上角只放「与利率相关 N 条」；核心为 0 时留白，不写「0 条」。
                {...(dayLayers.core.length === 0 ? {} : {
                  summary: text.mkDay.summary.replace('{related}', String(dayLayers.core.length))
                })}
                groups={dayGroups(dayLayers, dayEvents, selectedDay, timeZone, showOthers, text.mkDay.sequence)}
                {...(showOthers ? { hideGroupHeadings: true } : {})}
                {...(dayEvents.length === 0 ? { emptyText: calendarText.unifiedDay.empty } : {})}
                marketSources={[]}
                missingValueLabel={text.mkDay.valueMissing}
                text={calendarText}
                statusNow={nowInstant}
                selectedEventKey={undefined}
                selectedMarketKey={detailEvent?.eventKey}
                onSelect={(item) => setDetailEvent(item.source === 'market' ? item.event : undefined)}
              />
              {/* 次要层就地展开：抽屉里的交互，不跳页、不弹窗（日期详情只以抽屉形态出现）。 */}
              {dayLayers.other.length === 0 ? null : <button className="mk-col-r__more" type="button"
                aria-expanded={showOthers}
                onClick={() => setOthersExpanded(!showOthers)}>
                {(showOthers ? text.mkDay.collapse : text.mkDay.other).replace('{count}', String(dayLayers.other.length))}
                <ChevronDown aria-hidden="true" size={12} data-flip={othersExpanded ? 'true' : 'false'} />
              </button>}
            </>
            : <LoadingState label={calendarText.unifiedDay.loading} minHeight={160} />}
      </div>
      {/* 事件详情：与经济日历页同一个抽屉组件（`CalendarInspector`，左侧 inline、平台上按 Esc/× 关），
          正文也复用同一份 `MarketCalendarInspector`。点另一条就换内容，同一个抽屉不叠第二层。 */}
      {detailEvent === undefined ? null : <CalendarInspector
        contentId={detailEvent.eventKey}
        onClose={() => setDetailEvent(undefined)}
        open
        when={detailEvent.scheduledAt}>
        <MarketCalendarInspector event={detailEvent} source={undefined} text={calendarText} />
      </CalendarInspector>}
    </section>
  </Drawer>
}

/**
 * 下一次发布：在**同一次按月读**的结果里按身份找「现在之后」最近的一条。
 *
 * 找不到就返回 `undefined`，调用方**不画这一格**——写「未提供」会让人以为今天该有一次发布。
 * 日期用与日历一致的显示时区算，再取 `MM-DD`（跨年时补上年，避免把 1 月写成去年）。
 */
function nextReleaseOf(events: readonly Readonly<{ scheduledAt: string; measureKeys?: readonly string[] }>[], keys: readonly string[], nowInstant: string, timeZone: string): string | undefined {
  const nowMs = Date.parse(nowInstant)
  const next = events
    .filter((event) => Date.parse(event.scheduledAt) > nowMs)
    .filter((event) => (event.measureKeys ?? []).some((key) => keys.includes(key)))
    .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt))[0]
  if (next === undefined) return undefined
  const day = calendarDisplayDate(next.scheduledAt, timeZone)
  return day.slice(0, 4) === calendarDisplayDate(nowInstant, timeZone).slice(0, 4) ? day.slice(5) : day
}

/**
 * 选中哪一天：今天有事件就是今天；否则取**离今天最近**的那一个有事件的日子（同日距离取靠后的）。
 * 这个月一条事件都没有时仍选今天（今天不在本月就取 1 号），右列给空态，不是给一个空标题。
 */
export function defaultDayFor(month: string, eventDays: ReadonlySet<string>, today: string): string {
  if (eventDays.has(today) && today.startsWith(`${month}-`)) return today
  const todayMs = Date.parse(`${today}T00:00:00.000Z`)
  let best: string | undefined
  let bestGap = Number.POSITIVE_INFINITY
  for (const day of [...eventDays].filter((value) => value.startsWith(`${month}-`)).sort()) {
    const gap = Math.abs(Date.parse(`${day}T00:00:00.000Z`) - todayMs)
    if (gap <= bestGap) { best = day; bestGap = gap }
  }
  if (best !== undefined) return best
  return today.startsWith(`${month}-`) ? today : `${month}-01`
}

/** 按事件类型分组；顺序与日历页一致（指标 → 财经 → 央行），组内按时刻升序。 */
function dayGroups(layers: DayLayers, allDay: readonly MarketCalendarEvent[], date: string, timeZone: string, othersExpanded: boolean, sequence: string): readonly Readonly<{ eventType: MarketCalendarEvent['eventType']; items: readonly CalendarDayItem[] }>[] {
  const shown = othersExpanded ? [...layers.core, ...layers.other] : layers.core
  const order: MarketCalendarEvent['eventType'][] = ['economic-indicator', 'financial-event', 'central-bank-activity']
  // 同一时刻、同一类型、同名的多条（源只给类型名时就是这样）：加序号，否则读者以为渲染重复。
  // **分母按当天同类型总数**算，不按当前显示了几条——否则展开前后 `2/4` 会变成 `2/9`，像重新排序。
  const totals = new Map<string, number>()
  for (const event of allDay) {
    if (event.eventType !== 'economic-indicator') continue
    totals.set(`${event.scheduledAt}|${event.title}`, (totals.get(`${event.scheduledAt}|${event.title}`) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return order
    .map(eventType => ({
      eventType,
      items: shown.filter(event => event.eventType === eventType)
        .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt))
        .map((event): CalendarDayItem => {
          const identity = `${event.scheduledAt}|${event.title}`
          const total = totals.get(identity) ?? 1
          const index = (seen.get(identity) ?? 0) + 1
          seen.set(identity, index)
          return {
            key: event.eventKey, date, time: calendarDisplayTime(event.scheduledAt, timeZone), source: 'market',
            event: total > 1
              ? { ...event, title: sequence.replace('{name}', event.title).replace('{index}', String(index)).replace('{total}', String(total)) }
              : event
          }
        })
    }))
    .filter(group => group.items.length > 0)
}

/**
 * 右列的三层（产品经理口径，Chief 2026-11-13 裁决）：判据只有身份，**不看 importance、不看名字**。
 *
 * - 核心层：四个必标 `metric_key` 的发布 + FOMC 决议/纪要——和曲线标注完全同一把尺子；
 * - 次要层：其余经济指标，折成一行「其他 N 条」，就地展开；
 * - 不进层：央行讲话/报告/资产负债表、商品库存、财经事件——不进列表，也不进「其他」的计数。
 */
type DayLayers = Readonly<{ core: readonly MarketCalendarEvent[]; other: readonly MarketCalendarEvent[] }>

export function splitDayLayers(events: readonly MarketCalendarEvent[]): DayLayers {
  const core: MarketCalendarEvent[] = []
  const other: MarketCalendarEvent[] = []
  for (const event of events) {
    if (event.eventType !== 'economic-indicator') continue
    const relevant = matchedRelevantKey({
      at: event.scheduledAt, label: event.title,
      ...(event.eventNameKey === undefined ? {} : { eventNameKey: event.eventNameKey }),
      ...(event.measureKeys === undefined ? {} : { measureKeys: event.measureKeys }),
      ...(event.seriesId === undefined ? {} : { seriesId: event.seriesId })
    }) !== undefined
      || (event.seriesId !== undefined && (POLICY_PATH_EVENT_RELEVANT_SERIES_IDS as readonly string[]).includes(event.seriesId))
    ;(relevant ? core : other).push(event)
  }
  return { core: core.slice(0, 8), other }
}

/** 主值是「未提供 / 暂时读不到」时不占读数那档字号：那几个字一旦放大，会比真实数字更抢眼（界面设计定）。 */
function cardValueClass(fact: MacroIndicatorCardFact | undefined, unreadable?: boolean): string | undefined {
  return !unreadable && fact?.state === 'provided' ? undefined : 'mk-card__na'
}

/**
 * 卡片页脚的数据来源：**按事实里真实的 provider 显示**。
 *
 * 原来这里写死「FRED」——而这条链路一次 FRED 都没调用过，那个标签是在替数据编出处。
 * 没有 provider（例如本期确实没有值）就**不写这一句**，不拿一个名字填空。
 */
function cardSourceLabel(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, calendarText: EconomicCalendarText): React.ReactNode {
  const provider = fact?.source
  if (provider === 'fred') return <span>{text.sourceFred}</span>
  // Narwhal 用日历那份既有文案；旧源即将删除，不赋品牌名。
  return provider === 'narwhal' ? <span>{calendarText.market.source}</span> : null
}

/** 「上一期」的字段值：值 + 出处 · 期次（官方序列才有出处）；读不到写「暂时读不到」。 */
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

/** 卡头的 ⓘ：解释「为什么没有这个数」。卡面正文不放解释性句子。 */
function CardWhy({ resolveKey }: Readonly<{ resolveKey: (key: string) => string }>): React.ReactElement {
  return <Popover
    labelKey="mk.cardWhy"
    resolveText={resolveKey}
    trigger={(triggerProps) => <IconButton {...triggerProps} ariaLabelKey="mk.cardWhyAria"
      icon={Info} size="sm" variant="plain" resolveText={resolveKey} />} />
}

/**
 * 「预期」一格：有共识就写值 + 出处与观测时刻（三样齐全才显示），没有就写「暂无共识」。
 * 不写「未提供」——那是「本期没值」，共识没有是另一件事。
 */
function consensusText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, timeZone: string, nowInstant: string): string {
  const consensus = fact?.consensus
  if (consensus === undefined) return text.cardStates.noConsensus
  const day = calendarDisplayDate(consensus.asOf, timeZone)
  const short = day.slice(0, 4) === calendarDisplayDate(nowInstant, timeZone).slice(0, 4) ? day.slice(5) : day
  return `${formatCardNumber(consensus.value, fact?.unit)} · ${text.cardStates.consensusSource
    .replace('{source}', fact?.source === 'fred' ? text.sourceFred : '').replace('{asOf}', short)}`
    .replace(' ·  · ', ' · ')
}

/**
 * 主值三态分开写：
 * - 读到了 → 按单位写（percent 一位小数、thousands 带符号 K）；
 * - 读到了、这一期没值 → 「未提供」；
 * - **没读到** → 「暂时读不到」；还在读（没有事实、也没报失败）→ 空白，先不落一个字。
 */
function cardValueText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, unreadable?: boolean): string {
  if (unreadable) return text.cardStates.unreadable
  if (fact === undefined) return ''
  if (fact.state === 'provided' && fact.value !== undefined) return formatCardNumber(fact.value, fact.unit)
  return text.cardStates.notAvailable
}

/**
 * 「较上期（未修正）」：只用**首发布**的上一期值。
 *
 * 来源当前的 `previous` 可能是修订值（非农首发布 29、修订后 60），拿它算会把 +136K 写成 +105K。
 * 缺首发布值就整块不显示这一行——不拿修订值顶，也不回填 0。
 */
function cardChangeText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText): string | undefined {
  if (fact?.state !== 'provided' || fact.value === undefined || fact.previousAsPublished === undefined) return undefined
  const delta = fact.value - fact.previousAsPublished
  const signed = fact.unit === 'thousands'
    ? `${delta > 0 ? '+' : ''}${Math.round(delta)}K`
    : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}pp`
  return text.cardStates.vsPrevious.replace('{value}', signed)
}

/** 值级缺失时那一行：写清是哪一期、是「发布了没值」还是「本月没发布」；读不到时不写这一行。 */
function cardStateText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, unreadable?: boolean): string | undefined {
  if (unreadable || !fact || fact.state === 'provided') return undefined
  if (fact.state === 'not-recorded') return text.cardStates.notRecorded
  // 期次不知道时不许留一个悬空的「 · 」：那句话要能独立成立。
  const base = fact.period === undefined
    ? text.cardStates.missingCurrentNoPeriod
    : text.cardStates.missingCurrent.replace('{period}', formatCardPeriod(fact.period))
  // 卡面只写状态词；「上一期」是另一个字段，单独一行渲染。
  return base
}

function formatCardNumber(value: number, unit: MacroIndicatorCardFact['unit']): string {
  if (unit === 'thousands') return `${value > 0 ? '+' : ''}${Math.round(value)}K`
  if (unit === 'percent') return `${value.toFixed(1)}%`
  // 两个源都没声明单位时不替它编一个：数字照写，不挂 `%` 也不挂 `K`。
  return String(value)
}

/** `2026-10` → `10 月`；别的形状原样返回（不猜）。 */
function formatCardPeriod(period: string | undefined): string {
  const match = /^\d{4}-(\d{2})$/.exec(period ?? '')
  return match ? `${Number(match[1])} 月` : (period ?? '')
}
