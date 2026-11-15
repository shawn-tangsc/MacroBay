import { useCallback, useEffect, useRef, useState } from 'react'

import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import { ExpectationChart } from './ExpectationChart'
import type { PolicyPathCardText } from './PolicyPathCard'
import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'
import { useExpectationSeries, type ExpectationSeriesEvent } from './useExpectationSeries'

/**
 * 看板首页左栏那张「利率数学期望」。
 *
 * 与抽屉里那块**同一份推导**（`useExpectationSeries`）与**同一个组件**（`ExpectationChart`）：
 * 这里只做容器适配——量自己的宽度再画，不写死 682/284。
 * 交互与曲线逻辑一行没有：图上的悬停/选中/读数都还是 `ExpectationChart` 自己的。
 *
 * 事件标签避让是按抽屉宽栏调的，换到这一格（682×330）需要重新验贴边与遮挡——**已知项**，
 * 见提交说明；这里不改 `readoutPlacement` 的规则。
 */
export function ExpectationPanel({ locale, policyText, policyReading, releaseEvents, height = 330, pending = false, onRetry }: Readonly<{
  locale: 'zh-CN' | 'en-US'
  /** 政策路径那份文案：图上的档位短名与抽屉同一份，不另写。 */
  policyText: PolicyPathCardText
  policyReading?: PolicyPathReading
  releaseEvents?: readonly ExpectationSeriesEvent[]
  /** 与钟表卡对齐的高度。 */
  height?: number
  /** 还在等第一次读数：这一格既不画图、也不说「读不到」（读不到 ≠ 还没读）。 */
  pending?: boolean
  /**
   * 读不到时那颗「再试一次」。**必填且无条件**：StateView 的 error 态必须带动作，
   * 而且守卫明确禁止「按条件决定要不要给按钮」——一个状态要么显示、要么不显示，不能按钮可选。
   */
  onRetry: () => void
}>): React.ReactElement {
  const text = macroIndicatorDrawerText[locale]
  const series = useExpectationSeries(policyReading, releaseEvents, text)
  const host = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const attach = useCallback((node: HTMLDivElement | null) => {
    host.current = node
    if (node === null) return
    setWidth(Math.floor(node.getBoundingClientRect().width))
  }, [])
  useEffect(() => {
    const node = host.current
    if (node === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setWidth(Math.floor(node.getBoundingClientRect().width)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  // 绘图区按容器量：减掉左右内距与上下留白（与原型 330 高一致，不写死 264 之外的数）。
  const plotWidth = Math.max(0, width - 52 - 12)
  const plotHeight = height - 16 - 34
  const delta = series.delta
  const deltaText = delta === undefined ? text.rateNoHistory
    : Math.abs(delta) < 0.05 ? text.rateFlat
      : (delta > 0 ? text.rateDeltaUp : text.rateDeltaDown).replace('{value}', Math.abs(delta).toFixed(1))
  return <section className="mk-dash-expectation" style={{ height }} aria-label={text.title}>
    <header className="mk-dash-expectation__head">
      <h2>{text.rateTitle}</h2>
      {series.latestBp === undefined
        ? <b className="mk-dash-expectation__absent">{text.rateUnreadable}</b>
        : <b className="mk-dash-expectation__value">{series.latestBp.toFixed(1)}<i>{text.rateUnit}</i></b>}
      {series.latestBp === undefined ? null : <span>{deltaText}</span>}
    </header>
    <div className="mk-dash-expectation__plot" ref={attach}>
      {pending ? null
        : series.points.length > 0 && plotWidth > 0
        ? <ExpectationChart points={series.points} events={series.eventMarks} height={plotHeight} width={plotWidth}
          latest={delta === undefined ? {} : { changeBp: delta }}
          text={{
            aria: text.chartAria,
            outcomes: policyText.shortOutcomes,
            expectation: text.panelExpectation,
            vsYesterday: text.panelVsYesterday,
            flat: text.panelFlat,
            noHistory: text.rateNoHistory
          }} />
        : series.points.length > 0 ? null
          : policyReading
            ? <StateView state="empty" reasonCode="nothing-in-window" />
            : <StateView state="error" reasonCode="unreadable"
              action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRetry }} />}
    </div>
  </section>
}
