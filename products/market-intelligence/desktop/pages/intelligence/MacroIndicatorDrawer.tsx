import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'

import { ExpectationChart } from './ExpectationChart'
import { MiniReleaseCalendar } from './MiniReleaseCalendar'
import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import { CalendarDayEventList } from '../../features/macro/economic-calendar/CalendarDayEventList'
import type { CalendarDayItem } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import { productText } from '../../shared/i18n/productText'
import { PolicyPathCard, PolicyPathUnavailable, type PolicyPathCardText } from './PolicyPathCard'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import { Drawer } from '@platform/ui/components/drawer'
import { macroIndicatorDrawerText, type MacroIndicatorDrawerText } from './macroIndicatorDrawerText'

import './macroIndicatorDrawer.css'

/**
 * 关键指标 · 预期变化 — **静态页面**。
 *
 * 这一版只做画面：所有数字、事件、日期都是 `MOCK` 里的示意数据，组件不读库、不取数、不连任何源。
 * 布局与尺寸逐项照 `2026-11-13-K11-b.html`（1280 抽屉、正文 1248、左列 828 + 右列 403、间距 16）。
 *
 * 刻意不做的事：不在这一版里接真实数据，也不因为「真实数据没有这一项」去调布局。数据是假的，
 * 版式是验过的。
 */
const MOCK = {
  /** 加权期望曲线，单位 bp（与原型同一组数，右端是「此刻」）。 */
  expectation: [-28, -27.8, -27.6, -27.4, -27.2, -27, -26.8, -26.6, -26, -23.48, -20.22, -16.59, -12.72, -8.64, -4.39, 0, 0.5, 1.9, 3.3, 4.7, 6.1, 7.5, 8.9, 10.3, 11, 9.4, 7.8, 6.2, 4.6, 3, 1.4, 3.4, 5.4, 7.4, 9.4, 11.4, 13.4, 15.4, 17.4, 19.4, 21.4, 23.4, 25.4, 27.4, 29.4, 31.4],
  eventMarks: [{ index: 16, name: 'CPI 年率', impact: 8.6 }, { index: 24, name: '新增就业', impact: -6.2 }],
  rate: {
    // 顶上这个数与原型一致：取曲线末值，差值是末值减前值（原型同一算法）。
    headline: '31.4', delta: '↑ +2.0bp · 较上一日',
    policy: { mostLikely: '90.0%', label: '12 月加息 25bp', hike25: 90, hike50: 6.4, other: 3.6 },
    facts: { meeting: '12月9日 · 26 天', range: '3.75–4.00%', sep: '4.1%', vote: '维持 · 10–2' }
  },
  cards: {
    cpi: { value: '3.7%', change: '↗ 0.1pp', core: '2.6%', next: '12-10', diffYoy: '−0.2pp', diffCore: '−0.2pp' },
    payrolls: { value: '+165K', change: '较上期（未修正）+136K', unemployment: '4.1%', next: '12-04' },
    pce: { value: '3.1%', next: '12-23', stamp: '11-13 08:00 · 已更新' }
  },
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

export function MacroIndicatorDrawer({ locale, open = true, onClose, onConfigure, policyReading, policyText, onOpenPolicyDetail }: Readonly<{
  locale: 'zh-CN' | 'en-US'
  /**
   * 受控开关。宿主**常挂**这个组件、只翻 `open`，关闭动画与「焦点回原位」才跑得完；
   * 条件挂载会让它在关的瞬间被卸载，antd 收不到关闭完成，焦点也就回不去「详情」。
   */
  open?: boolean
  onClose: () => void
  /**
   * 政策利率卡是**唯一接真数据**的一块：用宿主已经读到的那一份 `reading`，抽屉里不再取第二遍。
   * 读不到时不编数——走既有的「读不到」形态。
   */
  policyReading?: PolicyPathReading
  policyText: PolicyPathCardText
  onOpenPolicyDetail?: () => void
  /** 「配置日历」的去处；宿主给不出落点时按钮禁用，不画假按钮。 */
  onConfigure?: () => void
}>): React.ReactElement {
  const text: MacroIndicatorDrawerText = macroIndicatorDrawerText[locale]
  // 平台 Drawer 只收键；这张表把本抽屉的键映到产品自己的文案表（查表，不是 key→句子的分支）。
  const drawerKeys: Readonly<Record<string, string>> = { 'mk.title': text.title }
  // 复用日历页那套行组件，文案用同一份产品表，不另写一套词汇。
  const calendarText = productText[locale].pages.intelligence.portal.calendar
  const dayListRef = useRef<HTMLDivElement | null>(null)
  // The right column scrolls on its own; the drawer body does not.
  const [selectedDay] = useState(MOCK.day.date)
  const [plotWidth, setPlotWidth] = useState(560)
  const [plotHeight, setPlotHeight] = useState(264)
  const plotRef = useRef<HTMLDivElement | null>(null)
  const heroRef = useRef<HTMLDivElement | null>(null)

  // The prototype measures both boxes before drawing: the plot fills the column, and the plot's
  // height is the hero card's own height (`--top-h`). Same two measurements, same order.
  useLayoutEffect(() => {
    const measure = () => {
      const host = plotRef.current
      if (host) setPlotWidth(Math.max(380, Math.floor(host.clientWidth)))
      // 行高由卡片内容决定：量卡本身（它的第一个子元素），不是量被拉伸过的槽位。
      const card = heroRef.current?.firstElementChild ?? heroRef.current
      if (card) setPlotHeight(Math.max(200, Math.ceil(card.getBoundingClientRect().height)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (plotRef.current) observer.observe(plotRef.current)
    if (heroRef.current) observer.observe(heroRef.current)
    return () => observer.disconnect()
  }, [])

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
          <h2 className="mk-sec__t">{text.rateTitle}</h2>
          <b className="mk-sec__v">{MOCK.rate.headline}<i className="mk-sec__u">{text.rateUnit}</i></b>
          <span className="mk-sec__d">{MOCK.rate.delta}</span>
          <span className="mk-mocktag">{text.mockTag}</span>
          <span className="mk-sec__note">{text.rateNote}</span>
        </div>

        <div className="mk-view">
          <div className="mk-plot" ref={plotRef}>
            <ExpectationChart values={MOCK.expectation} events={MOCK.eventMarks.map(mark => ({ index: mark.index, label: mark.name, impact: mark.impact }))} height={plotHeight} width={plotWidth} />
          </div>
          {/* 政策利率卡：设计照现有那张「利率路径」卡，数据用宿主已读到的那一份；
              读不到时画既有「读不到」形态，不编数。右边这块占位壳保持 300 宽、随行拉齐。 */}
          <div className="mk-policy-slot" ref={heroRef}>
            {policyReading
              ? <PolicyPathCard reading={policyReading} text={policyText} month={''} {...(onOpenPolicyDetail ? { onOpen: onOpenPolicyDetail } : {})} />
              : <PolicyPathUnavailable state="unreadable" text={policyText} />}
          </div>
        </div>

        <div className="mk-strip">
          <article className="mk-card">
            <div className="mk-card__h"><h3>{text.cards.cpi.title}</h3><em>{text.cards.cpi.state}</em></div>
            <div className="mk-card__v"><b>{MOCK.cards.cpi.value}</b><span>{text.cards.cpi.unit}</span><i>{MOCK.cards.cpi.change}</i></div>
            <p className="mk-card__exp">{text.expectedDiff.replace('{yoy}', MOCK.cards.cpi.diffYoy).replace('{core}', MOCK.cards.cpi.diffCore)}</p>
            <dl className="mk-card__facts">
              <div><dt>{text.cards.cpi.core}</dt><dd>{MOCK.cards.cpi.core}</dd></div>
              <div><dt>{text.cards.cpi.next}</dt><dd>{MOCK.cards.cpi.next}</dd></div>
            </dl>
            <div className="mk-card__f"><span>{text.source}</span><span>{text.detail}</span></div>
          </article>
          <article className="mk-card">
            <div className="mk-card__h"><h3>{text.cards.payrolls.title}</h3><em>{text.cards.payrolls.state}</em></div>
            <div className="mk-card__v"><b>{MOCK.cards.payrolls.value}</b><span>{text.cards.payrolls.unit}</span><i>{MOCK.cards.payrolls.change}</i></div>
            <dl className="mk-card__facts">
              <div><dt>{text.cards.payrolls.unemployment}</dt><dd>{MOCK.cards.payrolls.unemployment}</dd></div>
              <div><dt>{text.cards.payrolls.next}</dt><dd>{MOCK.cards.payrolls.next}</dd></div>
            </dl>
            <div className="mk-card__f"><span>{text.sourceBls}</span><span>{text.detail}</span></div>
          </article>
          <article className="mk-card">
            <div className="mk-card__h"><h3>{text.cards.pce.title}</h3><em>{text.cards.pce.state}</em></div>
            <div className="mk-card__v"><b>{MOCK.cards.pce.value}</b><span>{text.cards.pce.unit}</span></div>
            <dl className="mk-card__facts"><div><dt>{text.cards.pce.next}</dt><dd>{MOCK.cards.pce.next}</dd></div></dl>
            <p className="mk-card__st">{MOCK.cards.pce.stamp}</p>
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
    source: '0xRouter', sourceObservedAt: '2026-11-13T00:00:00.000Z', coverage: 'observed-unverified'
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
