import { Button } from 'antd'
import { CircleSlash, TriangleAlert } from 'lucide-react'

import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
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
 * 三态（规范 `2026-11-11-source-availability-styles.md` §二）：这张卡只有**一条读数、一个源**
 * （`alternative-fear-greed`），判不出「哪一行坏了」，所以是**整卡级遮罩**——卡框与标题照常，
 * 只在读数区盖一层（`.mi-source-veil-host` / `.mi-source-veil`），遮罩里一句状态词 + 恰一颗按钮。
 * 「没配置」在这张卡上**到不了**（源是注册表里的固定条目，读者没有「配一个源」的动作），所以不画那一态。
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
  // 「没配置」不在这里：这张卡的源是注册表里的固定条目，读者没有「配一个源」的动作，那一态永远到不了，
  // 画它就是一段跑不到的代码。所以只有两种：没启用（宿主给）、暂时读不到（读数给）。
  const veil = cellOff
    ? { state: 'disabled' as const, sentence: `${dataText('pages.intelligence.portal.data.sourcesNotEnabled')}（${cellOff.sourceLabel}）`, action: dataText('pages.intelligence.portal.data.enableSources'), onAction: cellOff.onOpenSources }
    : fearGreedState.state === 'unavailable'
      ? { state: 'unreadable' as const, sentence: dataText('pages.intelligence.portal.data.temporarilyUnavailable'), action: dataText('pages.intelligence.portal.data.retry'), onAction: onRetry }
      : undefined
  const VeilIcon = veil?.state === 'unreadable' ? TriangleAlert : CircleSlash
  return <>
    <section className="mi-crypto-dashboard__sentiment" aria-labelledby="mi-sentiment-heading"><h2 id="mi-sentiment-heading">{text.sentiment.title}</h2>
      <div className="mi-crypto-dashboard__sentiment-gauge" data-sentiment-gauge>
      {/* 整卡级遮罩：卡框与标题照常（不把卡换掉），只把读数区盖住，图例留在遮罩外面。
          遮罩里恰好一颗按钮：没启用 → 去启用，读不到 → 再试一次。 */}
      {veil
        ? <>
          <div className="mi-source-veil-host" data-veiled="true">
            <div className="mi-source-veil" data-state={veil.state}>
              <p className="mi-source-state" data-state={veil.state}>
                <VeilIcon aria-hidden="true" className="mi-source-state__icon" size={14} />
                <span>{veil.sentence}</span>
              </p>
              <Button onClick={veil.onAction} size="small">{veil.action}</Button>
            </div>
          </div>
          <p>{text.sentiment.gaugeMarkers.fear} · {text.sentiment.gaugeMarkers.neutral} · {text.sentiment.gaugeMarkers.greed}</p>
        </>
        : fearGreedState.state === 'available' || fearGreedState.state === 'stale' ? <>
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
      </> : fearGreedState.state === 'empty'
        ? <StateView state="empty" reasonCode="not-yet" />
        // 走到这里的只剩「还在读」：`unavailable` 已经被上面的遮罩接走（遮罩必须压过其它分支）。
        : <LoadingState label={text.fearGreed.loading} minHeight={120} />}
      </div>
    </section>
  </>
}
