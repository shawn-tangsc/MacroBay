import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { LoadingState } from '@platform/ui/components/loading'

import { ExpectationChart } from './ExpectationChart'
import { MiniReleaseCalendar } from './MiniReleaseCalendar'
import { MiSideDrawer } from './MiSideDrawer'
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
    groups: [
      {
        kind: 'indicator' as const, count: 48, shown: [
          { time: '01:00', country: '美国', name: '上周EIA原油库存变化(万桶)(至1106)', surprise: 'beat', value: '+519.93%', assets: { qqq: '-0.35%', btc: '+0.16%', eth: '-0.05%', usd: '-0.02%' } },
          { time: '21:30', country: '美国', name: '10月生产者物价指数(年率)', surprise: 'inline', value: '', assets: { qqq: '+0.87%', btc: '-0.54%', eth: '+0.69%', usd: '+0.25%' } },
          { time: '21:30', country: '美国', name: '10月核心生产者物价指数(年率)', surprise: 'beat', value: '+2.56%', assets: { qqq: '-0.20%', btc: '-0.56%', eth: '-0.50%', usd: '-0.02%' } }
        ]
      },
      {
        kind: 'centralBank' as const, count: 9, shown: [
          { time: '02:10', country: '美国', name: '旧金山联储主席戴利发表讲话', surprise: 'none' as const, value: '', assets: { qqq: '—', btc: '—', eth: '—', usd: '—' } }
        ]
      }
    ]
  }
} as const

export function MacroIndicatorDrawer({ locale, onClose, onOpenCalendar, onConfigure }: Readonly<{
  locale: 'zh-CN' | 'en-US'
  onClose: () => void
  /** 「配置日历」的去处；宿主给不出落点时按钮禁用，不画假按钮。 */
  onConfigure?: () => void
  /**
   * 页头那个「经济日历 ↗」真的会打开经济日历（宿主传 `onOpenCalendar`）。
   * 它和右栏日历卡上的入口指向同一个去处——登记为 K2 待定项，不做只画不动的假按钮。
   */
  onOpenCalendar?: () => void
}>): React.ReactElement {
  const text: MacroIndicatorDrawerText = macroIndicatorDrawerText[locale]
  // The right column scrolls on its own; the drawer body does not.
  const [selectedDay] = useState(MOCK.day.date)
  const [zoom, setZoom] = useState<1 | 2>(1)
  const [plotWidth, setPlotWidth] = useState(560)
  const [plotHeight, setPlotHeight] = useState(264)
  const plotRef = useRef<HTMLDivElement | null>(null)
  const heroRef = useRef<HTMLElement | null>(null)

  // The prototype measures both boxes before drawing: the plot fills the column, and the plot's
  // height is the hero card's own height (`--top-h`). Same two measurements, same order.
  useLayoutEffect(() => {
    const measure = () => {
      const host = plotRef.current
      if (host) setPlotWidth(Math.max(380, Math.floor(host.clientWidth)))
      const hero = heroRef.current
      if (hero) setPlotHeight(Math.max(200, Math.ceil(hero.getBoundingClientRect().height)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (plotRef.current) observer.observe(plotRef.current)
    if (heroRef.current) observer.observe(heroRef.current)
    return () => observer.disconnect()
  }, [])

  // 挂到 body：抽屉是 1280 的右侧浮层，如果落在右栏或某个 overflow 容器里，会被祖先裁掉——
  // 表现正是「点了没反应」。portal 让它以视口为参照，和其它浮层同一层。
  return createPortal(<MiSideDrawer
    title={text.title}
    placement="right"
    actions={onOpenCalendar ? <button className="mk-hlink" type="button" onClick={onOpenCalendar}>{text.calendarLink} ↗</button> : null}
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
            <div className="mk-zoom" role="group" aria-label={text.zoom}>
              {[1, 2].map(level => <button key={level} type="button" aria-pressed={zoom === level} onClick={() => setZoom(level as 1 | 2)}>{level}x</button>)}
            </div>
            <ExpectationChart values={MOCK.expectation} events={MOCK.eventMarks.map(mark => ({ index: mark.index, label: mark.name, impact: mark.impact }))} height={plotHeight} width={plotWidth} zoom={zoom} />
            {/* 图例是图下方一行小字（原型）；事件数值已经贴在图顶那一行，这里不再列第二遍。 */}
            <div className="mk-legend">
              <span><i className="mk-sw mk-sw--ring" />{text.legendEvent}</span>
              <span><i className="mk-sw mk-sw--hollow" />{text.legendNoEvent}</span>
            </div>
          </div>
          <article className="mk-card mk-card--hero" ref={heroRef}>
            <div className="mk-card__h"><h3>{text.policyRate}</h3><em>{text.policyPending}</em></div>
            <div className="mk-card__v"><b>{MOCK.rate.policy.mostLikely}</b><span>{text.policyExpectation}</span><i>{MOCK.rate.delta}</i></div>
            <span className="mk-card__bar">
              <i style={{ width: `${MOCK.rate.policy.hike25}%` }} /><i style={{ width: `${MOCK.rate.policy.hike50}%` }} /><i style={{ width: `${MOCK.rate.policy.other}%` }} />
            </span>
            <p className="mk-card__mix">
              {text.policyMix.hike25} <b>{MOCK.rate.policy.hike25}%</b> · {text.policyMix.hike50} <b>{MOCK.rate.policy.hike50}%</b> · {text.policyMix.other} <b>{MOCK.rate.policy.other}%</b>
            </p>
            <dl className="mk-card__facts">
              <div><dt>{text.facts.nextMeeting}</dt><dd>{MOCK.rate.facts.meeting}</dd></div>
              <div><dt>{text.facts.range}</dt><dd>{MOCK.rate.facts.range}</dd></div>
              <div><dt>{text.facts.sep}</dt><dd>{MOCK.rate.facts.sep}</dd></div>
              <div><dt>{text.facts.lastVote}</dt><dd>{MOCK.rate.facts.vote}</dd></div>
            </dl>
          </article>
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

      <aside className="mk-col-r" aria-label={text.dayTitle.replace('{date}', selectedDay)}>
        <div className="mk-evhead">
          <h3>{text.dayTitle.replace('{date}', selectedDay)}</h3>
          <p>{text.daySummary.replace('{count}', String(MOCK.day.total))}</p>
        </div>
        <div className="mk-evgroups">
          {MOCK.day.groups.map(group => <section className="mk-evgroup" key={group.kind}>
            <h4>{text.dayGroup.replace('{type}', text.kinds[group.kind]).replace('{count}', String(group.count))}</h4>
            {group.shown.map(row => <article className="mk-evrow" key={`${group.kind}-${row.name}`}>
              <div className="mk-evrow__top"><time>{row.time}</time><span className="mk-evrow__kind" data-kind={group.kind}>{text.kinds[group.kind]}</span></div>
              <p className="mk-evrow__name"><span>{row.country}</span> {row.name}</p>
              {surpriseSentence(row.surprise, row.value, text) === undefined ? null : <p className="mk-evrow__surprise" data-tone={row.surprise}>
                {surpriseSentence(row.surprise, row.value, text)}
              </p>}
              <p className="mk-evrow__assets">
                <span>{text.assets.qqq} {row.assets.qqq}</span><span>{text.assets.btc} {row.assets.btc}</span>
                <span>{text.assets.eth} {row.assets.eth}</span><span>{text.assets.usd} {row.assets.usd}</span>
              </p>
            </article>)}
            {group.count > group.shown.length ? <p className="mk-evmore">{text.more.replace('{count}', String(group.count - group.shown.length))}</p> : null}
          </section>)}
        </div>
        {/* 静的一天是一个读数，不是缺块：这一块在 DOM 里，props 里没有事件时才显示。
            静态页的 mock 那一天有 57 条，所以它现在是 hidden——和原型同一份结构。 */}
        <div className="mk-evempty" hidden={MOCK.day.total > 0}>{text.dayEmpty}</div>
      </aside>
    </section>
  </MiSideDrawer>, document.body)
}

/** One sentence per surprise state; `none` (a central-bank speech) has no number to compare. */
function surpriseSentence(tone: 'beat' | 'miss' | 'inline' | 'none', value: string, text: MacroIndicatorDrawerText): string | undefined {
  switch (tone) {
    case 'beat': return text.surprise.beat.replace('{value}', value)
    case 'miss': return text.surprise.miss.replace('{value}', value)
    case 'inline': return text.surprise.inline
    default: return undefined
  }
}
