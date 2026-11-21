import { Button } from 'antd'
import { Info, RefreshCw } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import type { FearGreedSnapshotBucket, SentimentOptionsCardResult } from '../../../../contracts/intelligenceQueryContracts'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { DashboardSentimentOptionsState } from '../../../pages/intelligence/useDashboardSentimentOptionsCard'
import type { DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'
import { SentimentPanel } from './SentimentPanel'
import type { SourceCellOff } from '../shared/sourceCellOff'
import '../../../shared/styles/sourceAvailability.css'

type Text = {
  title: string
  titleInfoLabel: string
  observedAt: string
  provenance: string
  fearGreed: { name: string; axis: string; asOf: string; buckets: Record<FearGreedSnapshotBucket, string> }
  gaugeMarkers: { fear: string; neutral: string; greed: string }
  skew: { name: string; notConnected: string }
  action: { refresh: string; enable: string; viewSource: string }
  loading: string
  empty: string
}

const TEXT_PREFIX = 'pages.intelligence.portal.dashboard.defensivePremium'

/**
 * 恐惧与防跌溢价：左半是恐惧贪婪读数，右半是 BTC 期权偏斜；结论句在图下、跨全宽。
 *
 * 这一版先把最小可见形态落地：仪表、偏斜「未接入」与结论降级。两条曲线随后补，因此这里
 * 不画图，也不假装有图。
 */
export function SentimentOptionsCard({ state, text, onRefresh, onViewSource, cellOff }: Readonly<{
  state: DashboardSentimentOptionsState
  text: Text
  onRefresh: () => void
  onViewSource: () => void
  cellOff?: SourceCellOff
}>): React.ReactElement {
  const dataText = useProductTextKey()
  const result = state.state === 'available' ? state.result : undefined
  const fearGreed = result?.fearGreed
  const skew = result?.optionSkew
  const verdictKey = result ? verdictPath(result) : undefined

  return <section className="mi-defensive-premium" aria-labelledby="mi-defensive-premium-title" data-testid="defensive-premium-card">
    <header className="mi-defensive-premium__header">
      <h2 id="mi-defensive-premium-title">{text.title}</h2>
      <Popover lines={[{ labelKey: `${TEXT_PREFIX}.titleInfo` }]} resolveText={dataText}
        trigger={triggerProps => (
          <IconButton {...triggerProps} ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.titleInfoLabel" icon={Info} resolveText={dataText} size="sm" variant="plain" />
        )} />
      <IconButton ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.action.refresh" icon={RefreshCw} resolveText={dataText} size="sm" variant="plain"
        onSelect={onRefresh} disabled={state.state === 'loading'} className="mi-defensive-premium__refresh" />
      <span className="mi-defensive-premium__window">{dataText(`${TEXT_PREFIX}.window`)}</span>
    </header>

    {state.state === 'loading' ? <LoadingState label={text.loading} minHeight={96} /> : null}
    {state.state === 'unavailable' ? (
      <p className="mi-defensive-premium__state" role="status">{dataText('pages.intelligence.portal.data.temporarilyUnavailable')}</p>
    ) : null}

    {fearGreed || skew ? <div className="mi-defensive-premium__halves">
      <div className="mi-defensive-premium__half" data-half="fear-greed">
        {/* 仪表盘复用既有的恐惧贪婪卡：读数、三态与锚点都由它一份实现，这里不重画一套。 */}
        <SentimentPanel
          fearGreedState={toGaugeState(fearGreed)}
          text={{
            sentiment: { title: text.fearGreed.name, gaugeMarkers: text.gaugeMarkers },
            fearGreed: { loading: text.loading, empty: text.empty, observedAt: text.fearGreed.asOf, buckets: text.fearGreed.buckets }
          }}
          onRetry={onRefresh}
          {...(cellOff === undefined ? {} : { cellOff })} />
      </div>

      <div className="mi-defensive-premium__half" data-half="skew">
        <h3>{text.skew.name}</h3>
        {skew?.state === 'not-connected' ? <>
          <p className="mi-defensive-premium__state">{text.skew.notConnected}</p>
          <Button size="small" onClick={onViewSource}>{text.action.viewSource}</Button>
        </> : skew?.state === 'available' ? <>
          <p className="mi-defensive-premium__score"><strong>{skew.latest.riskReversal.toFixed(1)}</strong> <span>{dataText(`${TEXT_PREFIX}.skew.unit`)}</span></p>
          <p className="mi-defensive-premium__asof">{dataText(`${TEXT_PREFIX}.skew.asOf`)} {skew.latestDay}</p>
        </> : skew?.state === 'empty' ? <p className="mi-defensive-premium__state">{text.empty}</p>
          : <p className="mi-defensive-premium__state">{dataText('pages.intelligence.portal.data.temporarilyUnavailable')}</p>}
      </div>
    </div> : null}

    {verdictKey ? <p className="mi-defensive-premium__verdict" data-verdict>{dataText(verdictKey)}</p> : null}
    {result ? <p className="mi-defensive-premium__provenance">{text.provenance}</p> : null}
  </section>
}

function toGaugeState(section: SentimentOptionsCardResult['fearGreed'] | undefined): DashboardFearGreedState {
  if (!section) return { state: 'loading' }
  if (section.state === 'empty') return { state: 'empty' }
  if (section.state === 'unavailable') return { state: 'unavailable' }
  return { state: section.stale ? 'stale' : 'available', score: section.score, bucket: section.bucket, observedAt: section.observedAt }
}

/**
 * The conclusion is a lookup, never a sentence built here. Order: an unreadable half explains
 * itself first; then a half without a value degrades the combination; only two usable halves earn
 * a combination sentence.
 */
export function verdictPath(result: SentimentOptionsCardResult): string | undefined {
  const bucket = result.fearGreed.state === 'available' ? result.fearGreed.bucket : undefined
  const side = bucket === undefined ? undefined : bucket === 'extreme-fear' || bucket === 'fear' ? 'fear' : bucket === 'neutral' ? 'neutral' : 'greed'
  const direction = result.optionSkew.state === 'available' && result.optionSkew.direction.kind !== 'unknown'
    ? result.optionSkew.direction.kind
    : undefined

  if (result.fearGreed.state === 'unavailable') {
    return direction ? `${TEXT_PREFIX}.verdict.fgMissing.${direction}` : `${TEXT_PREFIX}.degraded.fearGreed`
  }
  if (result.optionSkew.state === 'unavailable') {
    return side ? `${TEXT_PREFIX}.verdict.${side}.skewMissing` : `${TEXT_PREFIX}.degraded.skew`
  }
  if (!side) return undefined
  if (result.optionSkew.state !== 'available' || direction === undefined) return `${TEXT_PREFIX}.verdict.${side}.skewMissing`
  return `${TEXT_PREFIX}.verdict.${side}.${direction}`
}