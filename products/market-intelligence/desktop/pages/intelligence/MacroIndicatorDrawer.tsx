import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { Info } from 'lucide-react'

import { ExpectationChart, type ExpectationPoint } from './ExpectationChart'
import { MiniReleaseCalendar } from './MiniReleaseCalendar'
import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import { CalendarDayEventList } from '../../features/macro/economic-calendar/CalendarDayEventList'
import type { CalendarDayItem } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import { productText } from '../../shared/i18n/productText'
import { PolicyPathCard, PolicyPathUnavailable, type PolicyPathCardText } from './PolicyPathCard'
import { policyPathMonth } from './policyPathMonth'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import { expectationBp, expectationEventMoves, matchedRelevantKey } from '../../../contracts/policyPath'
import type { MacroIndicatorCardFact, MacroIndicatorCardKey } from '../../../service/intelligence/macro-calendar/macroIndicatorCardFacts'
import { Drawer } from '@platform/ui/components/drawer'
import { macroIndicatorDrawerText, type MacroIndicatorDrawerText } from './macroIndicatorDrawerText'
import { nextMeasuredSize } from './macroIndicatorDrawerMeasure'

import './macroIndicatorDrawer.css'

/**
 * 关键指标 · 预期变化。
 *
 * 两条数据的来路不同，这里说清，免得下一个人以为整张抽屉都是装饰：
 * - **利率数学期望曲线与政策利率卡读真数据**：曲线来自同一次读数里的逐点序列（`probability.series`），
 *   政策卡复用宿主已经读到的那一份，抽屉里不再取第二遍。
 * - **三张简化卡、迷你日历、右列当日事件仍是示意数据**：它们的取值与下次发布日还没接，
 *   所以各自带着「示意数据」标记；撤标记之前必须先把真数据接上。
 *
 * 版式逐项照 `2026-11-13-K11-b.html`（1280 抽屉、正文 1248、左列 828 + 右列 403、间距 16）。
 */
const MOCK = {
  minical: {
    /** 每格：[日, 状态]。状态决定圆点颜色。 */
    weeks: [
      [[26, 'none'], [27, 'none'], [28, 'none'], [29, 'none'], [30, 'none'], [31, 'none'], [1, 'done']],
      [[2, 'none'], [3, 'none'], [4, 'none'], [5, 'done'], [6, 'done'], [7, 'none'], [8, 'none']],
      [[9, 'none'], [10, 'done'], [11, 'none'], [12, 'done'], [13, 'today'], [14, 'none'], [15, 'none']],
      [[16, 'todo'], [17, 'none'], [18, 'todo'], [19, 'none'], [20, 'todo'], [21, 'none'], [22, 'none']],
      [[23, 'none'], [24, 'none'], [25, 'todo'], [26, 'none'], [27, 'none'], [28, 'none'], [29, 'none']],
      [[30, 'none'], [1, 'none'], [2, 'none'], [3, 'none'], [4, 'none'], [5, 'none'], [6, 'none']]
    ] as const
  },
  day: {
    date: '2026-11-13', total: 57,
    /** 复用日历页那套行组件，所以这里给的是它认的 `MarketCalendarEvent`。 */
    events: [
      marketEvent('mock-eia', '上周EIA原油库存变化(万桶)(至1106)', '01:00', 'economic-indicator', '+519.93%', '-0.35%'),
      marketEvent('mock-ppi', '10月生产者物价指数(年率)', '21:30', 'economic-indicator', '+2.56%', '+0.87%'),
      marketEvent('mock-daly', '旧金山联储主席戴利发表讲话', '02:10', 'central-bank-activity', null, null)
    ]
  }
} as const

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

export function MacroIndicatorDrawer({ locale, open = true, onClose, onConfigure, onRetryPolicy, policyReading, policyText, onOpenPolicyDetail, releaseEvents, cardFacts, cardFactsUnreadable }: Readonly<{
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
    'mk.rateNoteAria': text.rateNoteAria
  }
  const resolveDrawerKey = (key: string): string => drawerKeys[key] ?? ''
  // 复用日历页那套行组件，文案用同一份产品表，不另写一套词汇。
  const calendarText = productText[locale].pages.intelligence.portal.calendar
  const dayListRef = useRef<HTMLDivElement | null>(null)
  // The right column scrolls on its own; the drawer body does not.
  const [selectedDay] = useState(MOCK.day.date)
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
  const pceFact = factOf('US.CORE_PCE.NSA.YOY')
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

        <div className="mk-strip">
          <article className="mk-card">
            <div className="mk-card__h"><h3>{text.cards.cpi.title}</h3></div>
            <div className="mk-card__v"><b className={cardValueClass(cpiFact, cardFactsUnreadable)}>{cardValueText(cpiFact, text, cardFactsUnreadable)}</b><span>{text.cards.cpi.unit}</span></div>
            {cardChangeText(cpiFact, text) === undefined ? null : <p className="mk-card__chg">{cardChangeText(cpiFact, text)}</p>}
            {cardStateText(cpiFact, text, cardFactsUnreadable) === undefined ? null : <p className="mk-card__na-line">{cardStateText(cpiFact, text, cardFactsUnreadable)}</p>}
            <dl className="mk-card__facts">
              <div><dt>{text.cards.cpi.core}</dt><dd>{cardValueText(coreCpiFact, text, cardFactsUnreadable)}</dd></div>
              <div><dt>{text.cards.cpi.next}</dt><dd>{text.cardStates.notAvailable}</dd></div>
            </dl>
            <div className="mk-card__f"><span>{text.source}</span><span>{text.detail}</span></div>
          </article>
          <article className="mk-card">
            <div className="mk-card__h"><h3>{text.cards.payrolls.title}</h3></div>
            <div className="mk-card__v"><b className={cardValueClass(payrollsFact, cardFactsUnreadable)}>{cardValueText(payrollsFact, text, cardFactsUnreadable)}</b><span>{text.cards.payrolls.unit}</span></div>
            {cardChangeText(payrollsFact, text) === undefined ? null : <p className="mk-card__chg">{cardChangeText(payrollsFact, text)}</p>}
            {cardStateText(payrollsFact, text, cardFactsUnreadable) === undefined ? null : <p className="mk-card__na-line">{cardStateText(payrollsFact, text, cardFactsUnreadable)}</p>}
            <dl className="mk-card__facts">
              <div><dt>{text.cards.payrolls.unemployment}</dt><dd>{text.cardStates.notAvailable}</dd></div>
              <div><dt>{text.cards.payrolls.next}</dt><dd>{text.cardStates.notAvailable}</dd></div>
            </dl>
            <div className="mk-card__f"><span>{text.sourceBls}</span><span>{text.detail}</span></div>
          </article>
          <article className="mk-card">
            <div className="mk-card__h"><h3>{text.cards.pce.title}</h3></div>
            <div className="mk-card__v"><b className={cardValueClass(pceFact, cardFactsUnreadable)}>{cardValueText(pceFact, text, cardFactsUnreadable)}</b><span>{text.cards.pce.unit}</span></div>
            {cardChangeText(pceFact, text) === undefined ? null : <p className="mk-card__chg">{cardChangeText(pceFact, text)}</p>}
            {cardStateText(pceFact, text, cardFactsUnreadable) === undefined ? null : <p className="mk-card__na-line">{cardStateText(pceFact, text, cardFactsUnreadable)}</p>}
            <dl className="mk-card__facts"><div><dt>{text.cards.pce.next}</dt><dd>{text.cardStates.notAvailable}</dd></div></dl>
            <div className="mk-card__f"><span>{text.source}</span><span>{text.detail}</span></div>
          </article>
        </div>

        <MiniReleaseCalendar text={text} {...(onConfigure === undefined ? {} : { onConfigure })} />
      </div>

      {/* 右列直接复用日历页的当日事件列表：它自带的「超预期」「资产涨跌」两行保留（用户 2026-11-13）。 */}
      <div className="mk-col-r" ref={dayListRef}>
        <CalendarDayEventList
          label={calendarText.dayEvents.listLabel}
          title={calendarText.dayEvents.title.replace('{date}', MOCK.day.date)}
          summary={calendarText.unifiedDay.total.replace('{count}', String(MOCK.day.total)) + ' · ' + calendarText.unifiedDay.grouped}
          groups={dayGroups(MOCK.day.events)}
          marketSources={[]}
          text={calendarText}
          statusNow={MOCK.day.date + 'T00:00:00.000Z'}
          selectedEventKey={undefined}
          selectedMarketKey={undefined}
          onSelect={() => undefined}
        />
      </div>
    </section>
  </Drawer>
}

/** 一条 mock 的市场事件：只为把复用的行组件喂饱，字段与真实形状一致。 */
function marketEvent(key: string, title: string, time: string, eventType: MarketCalendarEvent['eventType'], actual: string | null, change: string | null): MarketCalendarEvent {
  return {
    eventKey: key, title, countryCode: 'US', countryName: '美国', eventType, importance: 'high',
    scheduledAt: `2026-11-13T${time}:00.000Z`,
    consensus: { displayValue: '—' }, providerPrevious: { displayValue: change ?? '—' },
    providerActual: actual === null ? null : { displayValue: actual },
    source: 'Narwhal', sourceObservedAt: '2026-11-13T00:00:00.000Z', coverage: 'observed-unverified'
  }
}

/** 按事件类型分组；顺序与日历页一致（指标 → 财经 → 央行）。 */
function dayGroups(events: readonly MarketCalendarEvent[]): readonly Readonly<{ eventType: MarketCalendarEvent['eventType']; items: readonly CalendarDayItem[] }>[] {
  const order: MarketCalendarEvent['eventType'][] = ['economic-indicator', 'financial-event', 'central-bank-activity']
  return order
    .map(eventType => ({
      eventType,
      items: events.filter(event => event.eventType === eventType).map((event): CalendarDayItem => ({
        key: event.eventKey, date: '2026-11-13', time: event.scheduledAt.slice(11, 16), source: 'market', event
      }))
    }))
    .filter(group => group.items.length > 0)
}

/** 主值是「未提供 / 暂时读不到」时不占读数那档字号：那几个字一旦放大，会比真实数字更抢眼（界面设计定）。 */
function cardValueClass(fact: MacroIndicatorCardFact | undefined, unreadable?: boolean): string | undefined {
  return !unreadable && fact?.state === 'provided' ? undefined : 'mk-card__na'
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
  return fact.previousAsPublished === undefined
    ? base
    : `${base} · ${text.cardStates.previousPeriod.replace('{value}', formatCardNumber(fact.previousAsPublished, fact.unit))}`
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
