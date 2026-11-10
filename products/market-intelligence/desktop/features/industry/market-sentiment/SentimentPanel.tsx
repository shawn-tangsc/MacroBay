import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import { FearGreedGaugePresentationPolicy, type DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'

/**
 * 市场情绪卡（恐惧与贪婪读数）。
 *
 * 2026-11-11 从 `pages/intelligence/CryptoIntelligenceDashboard.tsx` 抽出来：那个文件是由多线共用的页面，
 * 卡片住在这里以后，这一张的改动不再和别人抢同一个文件。**纯搬迁**：props、渲染、文案全原样，
 * 抽出来那一笔只补了一条「渲染与搬迁前一致」的等价断言。
 */
type Text = {
  sentiment: {
    title: string
    gaugeMarkers: { fear: string; neutral: string; greed: string }
  }
  fearGreed: {
    loading: string
    observedAt: string
    buckets: Record<'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed', string>
  }
}

export function SentimentPanel({ fearGreedState, text, onRetry }: Readonly<{
  fearGreedState: DashboardFearGreedState
  text: Text
  onRetry: () => void
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  return <>
    <section className="mi-crypto-dashboard__sentiment" aria-labelledby="mi-sentiment-heading"><h2 id="mi-sentiment-heading">{text.sentiment.title}</h2>
      <div className="mi-crypto-dashboard__sentiment-gauge" data-sentiment-gauge>
      {/* 读到但偏旧也是读数：显示分数与它真实的观测时间，不当成「读不到」——那是把源说坏了。 */}
      {fearGreedState.state === 'available' || fearGreedState.state === 'stale' ? <>
        {/* The readout disc sits on the pivot and is painted after the needle, so the score can
            own the centre again: the needle starts underneath the disc instead of crossing it. */}
        <span className="mi-crypto-dashboard__sentiment-dial">
          <svg aria-hidden="true" viewBox={FearGreedGaugePresentationPolicy.svgViewBox}>{FearGreedGaugePresentationPolicy.arcSegments.map((segment, index) => <path key={segment.tone} className="mi-crypto-dashboard__gauge-segment" d={segment.path} data-gauge-segment={index} data-gauge-tone={segment.tone} />)}{FearGreedGaugePresentationPolicy.ticks.map((tick) => <path key={tick.score} className="mi-crypto-dashboard__gauge-tick" d={tick.path} />)}<g transform={`rotate(${FearGreedGaugePresentationPolicy.needleDegrees(fearGreedState.score)} ${FearGreedGaugePresentationPolicy.needleOrigin})`}>
            <path className="mi-crypto-dashboard__gauge-needle"
              data-gauge-bucket={FearGreedGaugePresentationPolicy.bucketTones[fearGreedState.bucket]}
              d={FearGreedGaugePresentationPolicy.needlePath} />
          </g>
          <circle className="mi-crypto-dashboard__gauge-readout"
            data-gauge-bucket={FearGreedGaugePresentationPolicy.bucketTones[fearGreedState.bucket]}
            cx={FearGreedGaugePresentationPolicy.readout.cx} cy={FearGreedGaugePresentationPolicy.readout.cy}
            r={FearGreedGaugePresentationPolicy.readout.radius} />
          </svg>
          <strong>{fearGreedState.score}</strong>
        </span>
        <span data-gauge-bucket-text={FearGreedGaugePresentationPolicy.bucketTones[fearGreedState.bucket]}>{text.fearGreed.buckets[fearGreedState.bucket]}</span><small>{text.fearGreed.observedAt} {formatTime(fearGreedState.observedAt)}</small><p>{text.sentiment.gaugeMarkers.fear} · {text.sentiment.gaugeMarkers.neutral} · {text.sentiment.gaugeMarkers.greed}</p>
      </> : fearGreedState.state === 'loading'
        ? <LoadingState label={text.fearGreed.loading} minHeight={120} />
        : fearGreedState.state === 'empty'
          ? <StateView state="empty" reasonCode="not-yet" />
          : <StateView state="error" reasonCode="unavailable"
              action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRetry }} />}
      </div>
    </section>
  </>
}
