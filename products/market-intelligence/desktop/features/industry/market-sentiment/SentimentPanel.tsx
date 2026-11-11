import { Button } from 'antd'
import { CircleSlash, TriangleAlert } from 'lucide-react'

import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import { FearGreedGaugePresentationPolicy, type DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { SourceCellOff } from '../shared/sourceCellOff'
import '../../../shared/styles/sourceAvailability.css'

/**
 * 市场情绪卡（恐惧与贪婪读数）。
 *
 * 2026-11-11 从 `pages/intelligence/CryptoIntelligenceDashboard.tsx` 抽出来：那个文件是由多线共用的页面，
 * 卡片住在这里以后，这一张的改动不再和别人抢同一个文件。抽出来那一笔是**纯搬迁**（props、渲染、文案
 * 全原样，只补了一条「渲染与搬迁前一致」的等价断言）。
 *
 * 三态（界面设计 2026-11-11 定稿，用户当场否掉遮罩）：**不盖遮罩**。
 * - 图照常画：弧线、刻度、三个标签（「极恐 · 中性 · 贪恐」）——缺的是读数，不是整张图；
 * - 不画指针与中间那颗读数圆盘：那是指向一个不存在的分数；
 * - 状态句 + 恰一颗 `size="small"` 按钮放在**图下方、卡内一行**（12 号字、行高 32、上距 8），
 *   不进图、不居中盖图。三态：没启用（去启用）/ 读不到（再试一次）/ 空（暂无读数，无按钮）。
 * 「没配置」在这张卡上**到不了**（源是注册表里的固定条目，读者没有「配一个源」的动作），所以不画那一态。
 *
 * 宽度：卡根 `width: 100%` + `min-width: 0`、图容器 `width: 100%`——**卡宽由卡片内容区决定，
 * 不由内容宽决定**；空态与有数据态卡宽因此相同（用户看到过 112px 的窄条，就是这个坑）。
 */
type Text = {
  sentiment: {
    title: string
    gaugeMarkers: { fear: string; neutral: string; greed: string }
  }
  fearGreed: {
    loading: string
    /** 读到了这一期、但库里没有这一期的观测值（不是读失败）。 */
    empty: string
    observedAt: string
    buckets: Record<'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed', string>
  }
}

export function SentimentPanel({ fearGreedState, text, onRetry, cellOff }: Readonly<{
  fearGreedState: DashboardFearGreedState
  text: Text
  onRetry: () => void
  /**
   * 这一格被读者关掉了：宿主给（来源配置属于宿主，卡片不自己推断）。给了就盖遮罩、**不再看读数**——
   * 关掉一格时这一次根本不会去读，状态会停在等待态，按读数画就会画成一个转圈。
   */
  cellOff?: SourceCellOff
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const dataText = useProductTextKey() as (key: string) => string
  // 三态按优先级：这一格被读者关掉（宿主给）> 读数说读不到 > 读到了但这一期没有值。
  // 「没配置」不在这里：这张卡的源是注册表里的固定条目，读者没有「配一个源」的动作，那一态永远到不了。
  const row = cellOff
    ? {
        tone: 'disabled' as const,
        icon: CircleSlash,
        sentence: `${dataText('pages.intelligence.portal.data.sourcesNotEnabled')}（${cellOff.sourceLabel}）`,
        action: { label: dataText('pages.intelligence.portal.data.enableSources'), run: cellOff.onOpenSources }
      }
    : fearGreedState.state === 'unavailable'
      ? {
          tone: 'unreadable' as const,
          icon: TriangleAlert,
          sentence: dataText('pages.intelligence.portal.data.temporarilyUnavailable'),
          action: { label: dataText('pages.intelligence.portal.data.retry'), run: onRetry }
        }
      : fearGreedState.state === 'empty'
        ? { tone: 'empty' as const, icon: undefined, sentence: text.fearGreed.empty, action: undefined }
        : undefined
  // 只有真有读数的两种才画指针与圆盘；等待态仍是加载，不许画成「没有」。
  const reading = row === undefined && (fearGreedState.state === 'available' || fearGreedState.state === 'stale')
    ? fearGreedState
    : undefined
  const Icon = row?.icon

  return <section className="mi-crypto-dashboard__sentiment" aria-labelledby="mi-sentiment-heading"><h2 id="mi-sentiment-heading">{text.sentiment.title}</h2>
    <div className="mi-crypto-dashboard__sentiment-gauge" data-sentiment-gauge>
      {reading
        // The readout disc sits on the pivot and is painted after the needle, so the score can
        // own the centre again: the needle starts underneath the disc instead of crossing it.
        ? <>
          <span className="mi-crypto-dashboard__sentiment-dial">
            <GaugeFigure reading={reading} />
            <strong>{reading.score}</strong>
          </span>
          <span data-gauge-bucket-text={FearGreedGaugePresentationPolicy.bucketTones[reading.bucket]}>{text.fearGreed.buckets[reading.bucket]}</span>
          <small>{text.fearGreed.observedAt} {formatTime(reading.observedAt)}</small>
          <p>{text.sentiment.gaugeMarkers.fear} · {text.sentiment.gaugeMarkers.neutral} · {text.sentiment.gaugeMarkers.greed}</p>
        </>
        : row
          // 没读数：图照画（弧线、刻度、标签），指针与圆盘不画——它们指向一个不存在的分数。
          ? <>
            <GaugeFigure />
            <p>{text.sentiment.gaugeMarkers.fear} · {text.sentiment.gaugeMarkers.neutral} · {text.sentiment.gaugeMarkers.greed}</p>
          </>
          // 走到这里的只剩「还在读」。
          : <LoadingState label={text.fearGreed.loading} minHeight={120} />}
    </div>
    {/* 图下方卡内一行：状态句 + 恰一颗按钮（空态没有可点的动作）。左右跟卡内距，不进图、不居中盖图。 */}
    {row
      ? <div className="mi-crypto-dashboard__sentiment-state" data-sentiment-state={row.tone}>
        <p className="mi-source-state" {...(row.tone === 'empty' ? {} : { 'data-state': row.tone })}>
          {Icon ? <Icon aria-hidden="true" className="mi-source-state__icon" size={14} /> : null}
          <span>{row.sentence}</span>
        </p>
        {row.action ? <Button onClick={row.action.run} size="small">{row.action.label}</Button> : null}
      </div>
      : null}
  </section>
}

/**
 * 表和刻度一份实现：`reading` 给了才画指针与读数圆盘。没读数时少画两样，
 * 但弧线、刻度与标签照旧——三态之间卡片形状不跳。
 */
function GaugeFigure({ reading }: Readonly<{ reading?: Readonly<{ score: number; bucket: 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed' }> }>): React.ReactElement {
  const policy = FearGreedGaugePresentationPolicy
  return <svg aria-hidden="true" viewBox={policy.svgViewBox}>
    {policy.arcSegments.map((segment, index) => <path key={segment.tone} className="mi-crypto-dashboard__gauge-segment" d={segment.path} data-gauge-segment={index} data-gauge-tone={segment.tone} />)}
    {policy.ticks.map((tick) => <path key={tick.score} className="mi-crypto-dashboard__gauge-tick" d={tick.path} />)}
    {reading === undefined ? null : <>
      <g transform={`rotate(${policy.needleDegrees(reading.score)} ${policy.needleOrigin})`}>
        <path className="mi-crypto-dashboard__gauge-needle"
          data-gauge-bucket={policy.bucketTones[reading.bucket]}
          d={policy.needlePath} />
      </g>
      <circle className="mi-crypto-dashboard__gauge-readout"
        data-gauge-bucket={policy.bucketTones[reading.bucket]}
        cx={policy.readout.cx} cy={policy.readout.cy}
        r={policy.readout.radius} />
    </>}
  </svg>
}
