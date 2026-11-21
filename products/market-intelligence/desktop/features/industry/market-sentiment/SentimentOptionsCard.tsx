import { Button } from 'antd'
import { Info, RefreshCw } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import type { OptionSkewDirection, SentimentOptionsCardResult } from '../../../../contracts/intelligenceQueryContracts'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { DashboardSentimentOptionsState } from '../../../pages/intelligence/useDashboardSentimentOptionsCard'
import type { DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'
import { SentimentPanel } from './SentimentPanel'
import { FearGreedChart, SkewChart } from './DefensivePremiumCharts'
import type { SourceCellOff } from '../shared/sourceCellOff'
import type { DefensivePremiumCardText } from './defensivePremiumCardText'
import '../../../shared/styles/sourceAvailability.css'

const TEXT_PREFIX = 'pages.intelligence.portal.dashboard.defensivePremium'
const TITLE_ID = 'mi-defensive-premium-title'
const FEAR_GREED_HEADING_ID = 'mi-defensive-premium-fear-greed-heading'
const SKEW_HEADING_ID = 'mi-defensive-premium-skew-heading'

/**
 * 恐惧与防跌溢价：左半是恐惧贪婪读数与 30 天走势，右半是 BTC 期权偏斜与它自己的曲线；
 * 结论句在图下、跨全宽。
 *
 * 两条线各画各的轴：指数 0–100 和百分点不能叠在一张图上。偏斜没接入就写未接入，不画一条假平线。
 */
export function SentimentOptionsCard({ state, text, onRefresh, onViewSource, cellOff }: Readonly<{
  state: DashboardSentimentOptionsState
  text: DefensivePremiumCardText
  onRefresh: () => void
  onViewSource: () => void
  cellOff?: SourceCellOff
}>): React.ReactElement {
  const dataText = useProductTextKey()
  const result = state.state === 'available' ? state.result : undefined
  const fearGreed = result?.fearGreed
  const skew = result?.optionSkew
  const verdictKey = result ? verdictPath(result) : undefined
  const percentile = fearGreed?.state === 'available' ? fearGreed.percentile : undefined

  return <section className="mi-defensive-premium" aria-labelledby={TITLE_ID} data-testid="defensive-premium-card">
    <header className="mi-defensive-premium__header">
      <h2 id={TITLE_ID}>{text.title}</h2>
      <Popover lines={[{ labelKey: `${TEXT_PREFIX}.titleInfo` }]} resolveText={dataText}
        trigger={triggerProps => (
          <IconButton {...triggerProps} ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.titleInfoLabel" icon={Info} resolveText={dataText} size="sm" variant="plain" />
        )} />
      <IconButton ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.action.refresh" icon={RefreshCw} resolveText={dataText} size="sm" variant="plain"
        onSelect={onRefresh} disabled={state.state === 'loading'} className="mi-defensive-premium__refresh" />
      <span className="mi-defensive-premium__window">{dataText(`${TEXT_PREFIX}.window`)}</span>
      {/* 「查看来源」是卡级动作，跟着「未接入」这件事走、落在标题行；行内不再放按钮。 */}
      {skew?.state === 'not-connected' ? <Button size="small" onClick={onViewSource} className="mi-defensive-premium__source-action">
        {text.action.viewSource}
      </Button> : null}
    </header>

    {state.state === 'loading' ? <LoadingState label={text.loading} minHeight={120} /> : null}
    {state.state === 'unavailable' ? (
      <p className="mi-defensive-premium__state" role="status">{dataText('pages.intelligence.portal.data.temporarilyUnavailable')}</p>
    ) : null}

    {fearGreed || skew ? <div className="mi-defensive-premium__halves">
      <div className="mi-defensive-premium__half" data-half="fear-greed">
        <div className="mi-defensive-premium__half-head">
          <h3 id={FEAR_GREED_HEADING_ID}>{text.fearGreed.name}</h3>
          <Popover resolveText={dataText} lines={[
            { labelKey: `${TEXT_PREFIX}.fearGreed.info.volatility` },
            percentile
              ? { labelKey: `${TEXT_PREFIX}.fearGreed.info.percentile`, params: { percentile: String(percentile.value) } }
              : { labelKey: `${TEXT_PREFIX}.fearGreed.info.percentileInsufficient` },
            { labelKey: `${TEXT_PREFIX}.fearGreed.info.sourceDay` }
          ]} trigger={triggerProps => (
            <IconButton {...triggerProps} ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.fearGreed.infoLabel" icon={Info} resolveText={dataText} size="sm" variant="plain" />
          )} />
        </div>
        {/* 仪表盘复用既有的恐惧贪婪卡：读数、三态与锚点都由它一份实现，这里不重画一套。 */}
        <SentimentPanel
          fearGreedState={toGaugeState(fearGreed)}
          showTitle={false}
          titleId={FEAR_GREED_HEADING_ID}
          text={{
            sentiment: { title: text.fearGreed.name, gaugeMarkers: text.gaugeMarkers },
            fearGreed: { loading: text.loading, empty: text.empty, observedAt: text.fearGreed.asOf, buckets: text.fearGreed.buckets }
          }}
          onRetry={onRefresh}
          {...(cellOff === undefined ? {} : { cellOff })} />
        {fearGreed?.state === 'available' && fearGreed.points.length > 0
          ? <FearGreedChart points={fearGreed.points} ariaLabel={text.chart.fearGreedAria} axisLabel={text.fearGreed.axis} />
          : null}
      </div>

      <div className="mi-defensive-premium__half" data-half="skew">
        <div className="mi-defensive-premium__half-head">
          <h3 id={SKEW_HEADING_ID}>{text.skew.name}</h3>
          <Popover resolveText={dataText} lines={[
            { labelKey: `${TEXT_PREFIX}.skew.info.definition` },
            { labelKey: `${TEXT_PREFIX}.skew.info.relative` },
            { labelKey: `${TEXT_PREFIX}.skew.info.since` },
            { labelKey: `${TEXT_PREFIX}.skew.info.sourceDay` }
          ]} trigger={triggerProps => (
            <IconButton {...triggerProps} ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.skew.infoLabel" icon={Info} resolveText={dataText} size="sm" variant="plain" />
          )} />
        </div>
        {skew?.state === 'not-connected' ? <p className="mi-defensive-premium__state">{text.skew.notConnected}</p>
          : skew?.state === 'available' ? <>
            <p className="mi-defensive-premium__score"><strong>{skew.latest.riskReversal.toFixed(1)}</strong> <span>{text.skew.unit}</span></p>
            <p className="mi-defensive-premium__asof">{text.skew.asOf} {skew.latestDay}</p>
            {skew.points.length > 0
              ? <SkewChart points={skew.points} ariaLabel={text.chart.skewAria} axisLabel={text.skew.name} unit={text.skew.unit} />
              : null}
            <SkewDirectionSentence direction={skew.direction} latestDay={skew.latestDay} text={text} />
          </> : skew?.state === 'empty' ? <p className="mi-defensive-premium__state">{text.empty}</p>
            : <p className="mi-defensive-premium__state">{dataText('pages.intelligence.portal.data.temporarilyUnavailable')}</p>}
      </div>
    </div> : null}

    {verdictKey ? <p className="mi-defensive-premium__verdict" data-verdict>{dataText(verdictKey)}</p> : null}
    {result ? <p className="mi-defensive-premium__provenance">{text.provenance}</p> : null}
  </section>
}

/** 方向未知时说明是哪种未知：不够几天 / 停在哪天 / 中间断档。三句各有自己的键，不共用一个泛句。 */
function SkewDirectionSentence({ direction, latestDay, text }: Readonly<{
  direction: OptionSkewDirection
  latestDay: string
  text: DefensivePremiumCardText
}>): React.ReactElement | null {
  if (direction.kind !== 'unknown') return null
  const sentence = direction.reason === 'insufficient'
    ? text.skew.direction.insufficient
    : direction.reason === 'discontinuous'
      ? text.skew.direction.discontinuous
      : text.skew.direction.stale.replace('{time}', latestDay)
  return <p className="mi-defensive-premium__direction" data-skew-direction={direction.reason}>{sentence}</p>
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
