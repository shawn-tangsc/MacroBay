import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { ChevronDown, Info } from 'lucide-react'

import { ExpectationChart, type ExpectationPoint } from './ExpectationChart'
import { MiniReleaseCalendar } from './MiniReleaseCalendar'
import { CalendarEventsCatalog } from './CalendarEventsCatalog'
import type { CatalogText } from './CalendarEventsCatalogDialog'
import { calendarCountryLabel } from '../../features/macro/economic-calendar/calendarCountryLabel'
import type { CatalogRow } from './calendarEventCatalogModel'
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
import { useUnmappedMonthObservations } from './useUnmappedMonthObservations'
import { mergeCalendarDaySources } from '../../features/macro/economic-calendar/unmappedCalendarMerge'
import { PolicyPathCard, PolicyPathUnavailable, type PolicyPathCardText } from './PolicyPathCard'
import { policyPathMonth } from './policyPathMonth'
import { useExpectationSeries } from './useExpectationSeries'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import {
  matchedRelevantConcept, POLICY_PATH_EVENT_RELEVANT_SERIES_IDS
} from '../../../contracts/policyPath'
import type { MacroIndicatorCardFact } from '../../../service/intelligence/macro-calendar/macroIndicatorCardFacts'
import { tierOfMetricKey } from '../../../service/intelligence/macro-calendar/marketCalendarReleaseGroups'
import { Drawer } from '@platform/ui/components/drawer'
import { createPortal } from 'react-dom'
import { macroIndicatorDrawerText, type MacroIndicatorDrawerText } from './macroIndicatorDrawerText'
import { nextMeasuredSize } from './macroIndicatorDrawerMeasure'
import { IndicatorCards, type IndicatorCardGroup } from './IndicatorCards'
import { MACRO_INDICATOR_GROUPS } from '../../../service/intelligence/macro-calendar/macroIndicatorCardGroups'
// 「一个指标 → 一个码」的只读合成索引：事件短名按概念归一，加变体不用改这里。
import { metricConceptOf } from '../../../service/intelligence/macro-calendar/marketCalendarMetricCatalog'

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


export function MacroIndicatorDrawer({ locale, open = true, onClose, onConfigure, onRetryPolicy, policyReading, policyText, onOpenPolicyDetail, releaseEvents, cardFacts, cardFactsUnreadable, calendarBlock, now, readMarketEvents }: Readonly<{
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
   * 右列顶部那块「接下来要看的」（用户 2026-11-15 定的顺序：块在上、事件列表在下）。
   * 元素由 layout 用**它自己那份 `cardData`** 构造后注入——抽屉不再读一遍日历。
   */
  calendarBlock?: React.ReactNode
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
  /**
   * 右列两层分组（类型在外、指标组内再分分级）：判据在 `macroIndicatorDrawerModel`，
   * 这里只把文案函数交过去。**tab 的条数也从这一份算**，不另数一遍。
   */
  const dayGroupsList = useMemo(() => dayGroups(dayEvents, selectedDay, timeZone, text.mkDay.sequence,
    (eventType, count) => calendarText.unifiedDay.groupCount
      .replace('{type}', calendarText.market.kinds[eventType]).replace('{count}', String(count)),
    (tier, count) => text.mkDay.tierGroup
      .replace('{tier}', text.mkDay.tiers[tier]).replace('{count}', String(count))),
  [dayEvents, selectedDay, timeZone, calendarText, text])
  /**
   * 未映射观测（进不了标准表的那批）：**只在日历里显示**，经渲染专用 IPC 读（契约 §10）。
   * 读不到时 `state: 'unavailable'`——列表据此说「读不到」，不报 0 条。
   */
  const unmappedMonth = useUnmappedMonthObservations({ enabled: open, month, locale })
  /**
   * 两个来源合成一天：排序、去重（服务侧已剔除被标准表接管的行，这里再兜一层）、
   * 计数都在 `mergeCalendarDaySources` 一处判。**规则不写在这里**，接线只换数据。
   */
  const standardDayItems = useMemo(() => dayEvents.map((event) => ({
    source: 'market' as const,
    key: `market:${event.eventKey}`,
    date: selectedDay,
    time: calendarDisplayTime(event.scheduledAt, timeZone),
    event
  })), [dayEvents, selectedDay, timeZone])
  const mergedDay = useMemo(() => mergeCalendarDaySources({
    date: selectedDay, timeZone, standard: standardDayItems, unmapped: unmappedMonth.entries
  }), [selectedDay, timeZone, standardDayItems, unmappedMonth.entries])
  const unmappedGroup = mergedDay.groups.find((group) => group.kind === 'unmapped')
  /** 当天未映射条数（tab 上的数字用它；读不到时**不显示数字**）。 */
  const unmappedCount = unmappedGroup === undefined ? 0 : unmappedGroup.rows.length
  /**
   * 当天的 tab（用户 2026-11-16：两个来源分 tab 看，不混在一列）。
   *
   * **跨日期保持**：读者在找同一类东西，翻到别的日子不该让他重选一遍。
   */
  const [dayTab, setDayTab] = useState<'standard' | 'unmapped'>('standard')
  /** tab 上的数字是**当天那个 tab 的条数**；两个来源各自算，不混。 */
  const standardCount = useMemo(() => dayGroupsList.reduce((total, group) =>
    total + group.items.length + (group.subgroups ?? []).reduce((sum, subgroup) => sum + subgroup.items.length, 0), 0),
  [dayGroupsList])
  /** tab 文案走抽屉自己的那张表（`mkDay.*`），不在这里拼字。 */
  const drawerCopy = (key: string): string => (text.mkDay as unknown as Readonly<Record<string, string>>)[key] ?? key
  const dayTabItems = useMemo(() => [
    { value: 'standard', labelKey: 'tabStandard', labelParams: { count: String(standardCount) } },
    // 读不到时**不带数字**：数量未知写 0 就是把「读不到」画成「没有」。
    unmappedMonth.state === 'unavailable'
      ? { value: 'unmapped', labelKey: 'tabUnmappedUnknown' }
      : { value: 'unmapped', labelKey: 'tabUnmapped', labelParams: { count: String(unmappedCount) } }
  ], [standardCount, unmappedMonth.state, unmappedCount])
  /**
   * 事件目录弹框。**范围 = 本月**（`releases.events`），标题也如实这么写：
   * 全量读口（`queryEvents`）是另一笔，到位之后这里换成那个读口、标题才改回「全部事件」。
   */
  const [catalogOpen, setCatalogOpen] = useState(false)
  /** 事件目录弹框的文案：只建一次，**键 → 文案的真表查找**也在这一份上做。 */
  const catalogCopyText = useMemo<CatalogText>(() => ({
    title: text.mkDay.catalogTitle, nameFilter: text.mkDay.catalogNameFilter,
    countryFilter: text.mkDay.catalogCountryFilter, importanceFilter: text.mkDay.catalogImportanceFilter,
    importanceAny: '', columns: text.mkDay.catalogColumns, sourceLabelTag: text.mkDay.catalogSourceLabelTag,
    loading: '', unavailable: '', noMatch: '', pageSizeLabel: '', importance: text.mkDay.catalogImportance
  }), [text])
  /** 图标按钮的读屏名：**真表查找**（键 → 文案），不在解析器里写比较。 */
  const catalogCopy = useMemo<Readonly<Record<string, string>>>(
    () => ({ 'intelligence.calendar.eventCatalog.open': text.mkDay.catalogOpenAria }), [text])

  /** 方格计数用：未映射观测按天累计（读者看到的是「今天有几件事」，两个来源都算）。 */
  const unmappedCountByDay = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of unmappedMonth.entries) counts.set(entry.scheduledDate, (counts.get(entry.scheduledDate) ?? 0) + 1)
    return counts
  }, [unmappedMonth.entries])
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

  /** 右列点一条事件 → 与经济日历页同一个详情抽屉（`CalendarInspector`，左侧 inline 浮层）。 */
  const [detailEvent, setDetailEvent] = useState<MarketCalendarEvent | undefined>(undefined)
  // 展开态跟着日期走，不跟着抽屉走。
  // 这一天的事件**全部列出**：不分「核心 / 其他」两层、也不折叠（用户 2026-11-14）。
  // 收起会让读者以为当天只有三条、实际三十多条；事件被藏起来就是没显示。
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

  // 序列与事件标注：与看板首页那张图**同一份**推导（`useExpectationSeries`），不各写一遍。
  const { points, latestBp, delta, truncatedDays, eventMarks } = useExpectationSeries(policyReading, releaseEvents, text)
  const policyMonth = policyReading ? policyPathMonth(policyReading.meetingDate, locale) : ''
  // 三种变化句各有各的边界：没有基准说「无历史可比」，不是 +0.0bp；差 0 才说持平。
  const deltaText = delta === undefined
    ? text.rateNoHistory
    : Math.abs(delta) < 0.05
      ? text.rateFlat
      : (delta > 0 ? text.rateDeltaUp : text.rateDeltaDown).replace('{value}', Math.abs(delta).toFixed(1))
  // 挂到 body：抽屉是 1280 的右侧浮层，如果落在右栏或某个 overflow 容器里，会被祖先裁掉——
  // 表现正是「点了没反应」。portal 让它以视口为参照，和其它浮层同一层。
  // 平台 `Drawer` 的 modal 档：遮罩、锁焦点、点遮罩关闭、Esc、关闭后焦点回位都是它的能力，
  // 不再在非模态壳上补一套手写的行为。
  return <Drawer
    open={open}
    mode="modal"
    size="full"
    className="mk-drawer"
    /* 内层（事件详情）打开时会通过 antd 的 context 推开外层抽屉 180px；这一格是**外层自己的**
       推开距离，设成 0 它才不会往左挪——加在详情上是没用的（那只控制详情的子抽屉）。 */
    push={false}
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
          unmappedCountByDay={unmappedCountByDay}
          events={releases.events} timeZone={timeZone} now={nowInstant}
          state={releases.state} refreshing={releases.refreshing}
          onSelectDay={(day) => setPickedDay({ month, day })}
          onMonthChange={changeMonth} onRefresh={releases.reload}
          onOpenCatalog={() => setCatalogOpen(true)}
          catalogAriaOf={(key) => catalogCopy[key] ?? key}
          {...(onConfigure === undefined ? {} : { onConfigure })} />
      </div>

      {/* 右列直接复用日历页的当日事件列表（用户 2026-11-13）：三种状态分开，谁也不冒充另一种。 */}
      <div className="mk-col-r" ref={dayListRef}>
        {/* 块在上：同一份 calendarData 渲染出来的节点，抽屉不复制写法、也不再读一次。 */}
        {calendarBlock === undefined ? null : <div data-drawer-calendar-block>{calendarBlock}</div>}
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
                groups={dayGroupsList}
                {...(dayEvents.length === 0 ? { emptyText: calendarText.unifiedDay.empty } : {})}
                marketSources={[]}
                missingValueLabel={text.mkDay.valueMissing}
                sourceTabs={{
                  value: dayTab,
                  onChange: (value) => setDayTab(value === 'unmapped' ? 'unmapped' : 'standard'),
                  items: dayTabItems,
                  ariaLabelKey: 'tabsAria',
                  resolveText: drawerCopy,
                  unmapped: {
                    observations: unmappedGroup === undefined ? [] : unmappedGroup.rows.flatMap((row) => row.kind === 'unmapped' ? [row.observation] : []),
                    timeZone,
                    aria: text.mkDay.unmappedAria,
                    emptyText: text.mkDay.unmappedEmpty,
                    emptyNote: text.mkDay.unmappedEmptyNote.replace('{count}', String(standardCount)),
                    unavailableText: text.mkDay.unmappedUnavailable,
                    unavailableNote: text.mkDay.unmappedUnavailableNote,
                    unavailable: unmappedMonth.state === 'unavailable'
                  }
                }}
                text={calendarText}
                statusNow={nowInstant}
                selectedEventKey={undefined}
                selectedMarketKey={detailEvent?.eventKey}
                onSelect={(item) => setDetailEvent(item.source === 'market' ? item.event : undefined)}
              />
            </>
            : <LoadingState label={calendarText.unifiedDay.loading} minHeight={160} />}
      </div>
      {/* 事件详情：与经济日历页同一个抽屉组件（`CalendarInspector`，左侧 inline、平台上按 Esc/× 关），
          正文也复用同一份 `MarketCalendarInspector`。点另一条就换内容，同一个抽屉不叠第二层。 */}
      {/* 事件详情要从**整个应用的左缘**滑出，所以挂到 `document.body`：
          指标抽屉自身带 transform 动画，`position: fixed` 的子孙会锚到它身上（第一版就弹在抽屉里）。
          挂到 body 之后它没有 transform 祖先，`inset: 0` 就是整窗，抽屉从窗口左边进来、满高。 */}
      {detailEvent === undefined ? null : createPortal(
        <div className="mk-detail-overlay">
          <CalendarInspector
            contentId={detailEvent.eventKey}
            onClose={() => setDetailEvent(undefined)}
            open
            when={detailEvent.scheduledAt}>
            <MarketCalendarInspector event={detailEvent} source={undefined} text={calendarText} />
          </CalendarInspector>
        </div>, document.body)}
    </section>
    <CalendarEventsCatalog open={catalogOpen} onClose={() => setCatalogOpen(false)} locale={locale}
      calendarText={calendarText} catalog={catalogCopyText} text={catalogCopyText} />
  </Drawer>
}

// 纯函数与卡片文案分别搬进两个聚焦模块（这里只留组件本体）；对外仍从本文件转出，
// 现有调用点与用例一行不用改。
import { nextReleaseOf, defaultDayFor, dayGroups, dayTierOf, splitDayLayers, type DayTier, type DayLayers } from './macroIndicatorDrawerModel'
import {
  cardValueClass, cardSourceLabel, previousText, CardWhy, consensusText,
  cardValueText, cardChangeText, cardStateText, formatCardNumber, formatCardPeriod
} from './macroIndicatorCardCopy'

export {
  nextReleaseOf, defaultDayFor, dayGroups, dayTierOf, splitDayLayers,
  type DayTier, type DayLayers
} from './macroIndicatorDrawerModel'
export {
  cardValueClass, cardSourceLabel, previousText, CardWhy, consensusText,
  cardValueText, cardChangeText, cardStateText, formatCardNumber, formatCardPeriod
} from './macroIndicatorCardCopy'
