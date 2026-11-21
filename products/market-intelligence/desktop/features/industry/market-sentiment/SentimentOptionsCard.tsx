import { Button } from 'antd'
import { CircleSlash, Info, RefreshCw, TriangleAlert } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { StatusPill } from '@platform/ui/components/status-pill'
import type { OptionSkewCardSection, OptionSkewDirection, SentimentOptionsCardResult } from '../../../../contracts/intelligenceQueryContracts'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { DashboardSentimentOptionsState } from '../../../pages/intelligence/useDashboardSentimentOptionsCard'
import type { DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'
import { SentimentGauge } from './SentimentGauge'
import { ChartPlaceholder, FearGreedChart, SkewChart } from './DefensivePremiumCharts'
import type { SourceCellOff } from '../shared/sourceCellOff'
import type { DefensivePremiumCardText } from './defensivePremiumCardText'
import '../../../shared/styles/sourceAvailability.css'

const TEXT_PREFIX = 'pages.intelligence.portal.dashboard.defensivePremium'
const TITLE_ID = 'mi-defensive-premium-title'
const FEAR_GREED_HEADING_ID = 'mi-defensive-premium-fear-greed-heading'
const SKEW_HEADING_ID = 'mi-defensive-premium-skew-heading'

/**
 * 恐惧与防跌溢价（定稿 §4.2）：内容行三列并排——仪表盘 112、恐惧贪婪格、BTC 偏斜格；
 * 结论单独一行、跨全宽（`grid-column: 1 / -1`）。没有断点、没有右列分支。
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
  const bothUnavailable = fearGreed?.state === 'unavailable' && skew?.state === 'unavailable'
  const bothEmpty = fearGreed?.state === 'empty' && skew?.state === 'empty'
  /** 一张卡只能有一个整块状态面：首读失败、两半都读不到、两半都没有。它下面不出三个格、不出结论。 */
  const wholeCardState: 'error' | 'empty' | undefined = state.state === 'unavailable' || bothUnavailable
    ? 'error'
    : bothEmpty ? 'empty' : undefined
  // 标题行只出一颗动作，按定稿 §4.3⑤ 的优先级：未接入 > 被关掉 > 刷新。
  // 唯一例外是「偏斜未接入、恐惧贪婪读失败」——那一半正在失败，重试才是唯一有用的动作，
  // 「未接入」右格行内已经写了，所以这里拿刷新**换掉**「查看来源」，不是再加上一颗（AC-31）。
  const notConnected = skew?.state === 'not-connected'
  const fearGreedFailed = fearGreed?.state === 'unavailable'
  const showViewSource = wholeCardState === undefined && notConnected && !fearGreedFailed
  const showEnable = wholeCardState === undefined && !notConnected && cellOff !== undefined
  // 首帧（还没有过任何一次读数）标题行不出刷新：那时候按下去只是把同一件事再问一遍（PRD §6）。
  // 「有过读数、正在重读」才留一颗禁用的刷新，保住焦点与入口。
  const firstReading = state.state === 'loading' && state.hadReading !== true
  const showRefresh = !firstReading && wholeCardState === undefined && (notConnected ? fearGreedFailed : !showEnable)
  const verdictKey = result && wholeCardState === undefined ? verdictPath(result) : undefined
  const percentile = fearGreed?.state === 'available' ? fearGreed.percentile : undefined
  const loading = state.state === 'loading'

  return <section className="mi-defensive-premium" aria-labelledby={TITLE_ID} data-testid="defensive-premium-card">
    <header className="mi-defensive-premium__header">
      <h2 id={TITLE_ID}>{text.title}</h2>
      <Popover lines={[{ labelKey: `${TEXT_PREFIX}.titleInfo` }]} resolveText={dataText}
        trigger={triggerProps => (
          <IconButton {...triggerProps} ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.titleInfoLabel" icon={Info} resolveText={dataText} size="sm" variant="plain" />
        )} />
      {/* 整卡只留一颗动作：未接入时是「查看来源」，其余可读状态下是刷新；整块状态面自己带动作，
          标题行不再给第二颗（AC-14）。 */}
      {/* 标题行的动作一律 24 高（`md`）：文字按钮是 24，图标按钮若用 22，换态时标题行会跳 2px。 */}
      {showRefresh ? <IconButton ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.action.refresh" icon={RefreshCw} resolveText={dataText} size="md" variant="plain"
        onSelect={onRefresh} disabled={loading} className="mi-defensive-premium__refresh" /> : null}
      {/* 这一格被读者关掉时，「去启用」也只在标题行；格内不再放按钮（AC-31）。 */}
      {showEnable && cellOff !== undefined
        ? <Button size="small" onClick={cellOff.onOpenSources} className="mi-defensive-premium__source-action">{text.action.enable}</Button>
        : null}
      <span className="mi-defensive-premium__window">{dataText(`${TEXT_PREFIX}.window`)}</span>
      {showViewSource ? <Button size="small" onClick={onViewSource} className="mi-defensive-premium__source-action">
        {text.action.viewSource}
      </Button> : null}
    </header>

    {wholeCardState === 'error' ? <StateView state="error" reasonCode="unreadable"
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRefresh }} />
      : wholeCardState === 'empty' ? <StateView state="empty" reasonCode="not-yet" />
        : <>
          {/* 第一列：仪表盘只回答「落在哪一档」，日期与状态词都在旁边那一格（定稿 §4.4 / §4.5）。 */}
          <SentimentGauge state={toGaugeState(fearGreed)} buckets={text.fearGreed.buckets} titleId={FEAR_GREED_HEADING_ID}
            {...(cellOff === undefined ? {} : { cellOff })} />

          <div className="mi-defensive-premium__cell" data-half="fear-greed">
            <div className="mi-defensive-premium__cell-head">
              <h3 id={FEAR_GREED_HEADING_ID}>{text.fearGreed.name}</h3>
              <Popover resolveText={dataText} lines={[
                { labelKey: `${TEXT_PREFIX}.fearGreed.info.volatility` },
                percentile
                  ? { labelKey: `${TEXT_PREFIX}.fearGreed.info.percentile`, params: { percentile: String(percentile.value) } }
                  : { labelKey: `${TEXT_PREFIX}.fearGreed.info.percentileInsufficient` },
              ]} trigger={triggerProps => (
                <IconButton {...triggerProps} ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.fearGreed.infoLabel" icon={Info} resolveText={dataText} size="sm" variant="plain" />
              )} />
            </div>
            {/* 读数行：这一格只有「截至」，没有方向位——分数与档位词归仪表盘那一列（§4.5 第 2 条）。 */}
            <FearGreedReading cellOff={cellOff} section={fearGreed} loading={loading}
              text={text} dataText={dataText} />
            {loading && cellOff === undefined ? <ChartPlaceholder axisLabel={text.fearGreed.axis} /> : null}
            {/* 这一格被关掉时不出任何曲线（旧读数也不画）：AC-15 与定稿 §5 行 10。 */}
            {cellOff === undefined && fearGreed?.state === 'available' && fearGreed.points.length > 0
              ? <FearGreedChart points={fearGreed.points} axisLabel={text.fearGreed.axis}
                ariaLabel={chartAria({
                  ariaLabel: text.chart.fearGreedAria, summary: text.chart.fearGreedSummary,
                  days: fearGreed.points.map(point => point.day),
                  first: String(fearGreed.points[fearGreed.points.length - 1]!.score),
                  last: String(fearGreed.points[0]!.score)
                })} />
              : null}
          </div>

          <div className="mi-defensive-premium__cell" data-half="skew">
            <div className="mi-defensive-premium__cell-head">
              <h3 id={SKEW_HEADING_ID}>{text.skew.name}</h3>
              <Popover resolveText={dataText} lines={[
                { labelKey: `${TEXT_PREFIX}.skew.info.definition` },
                { labelKey: `${TEXT_PREFIX}.skew.info.relative` },
                { labelKey: `${TEXT_PREFIX}.skew.info.since` },
              ]} trigger={triggerProps => (
                <IconButton {...triggerProps} ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.skew.infoLabel" icon={Info} resolveText={dataText} size="sm" variant="plain" />
              )} />
            </div>
            {skew === undefined && loading ? <>
              {/* 与正常态同构的占位：读数行、图框；转圈叠在图框里，不另占一行。 */}
              <p className="mi-defensive-premium__reading" aria-hidden="true">&nbsp;</p>
              <ChartPlaceholder axisLabel={text.skew.axis} waitingLabel={text.loading} />
            </>
              : skew?.state === 'not-connected' ? <p className="mi-defensive-premium__state">{text.skew.notConnected}</p>
                : skew?.state === 'available' ? <>
                <p className="mi-defensive-premium__reading">
                  <strong>{skew.latest.riskReversal.toFixed(1)}</strong> <span>{text.skew.unit}</span>
                  {/* 方向已知才进读数行：`· 走阔 · 近 5 天 ·`，词在前、窗口在后，不拼进同一个键。 */}
                  {skew.direction.kind === 'unknown' ? null : <>
                    <span aria-hidden="true">·</span>
                    <span data-skew-direction={skew.direction.kind}>{text.skew.direction[skew.direction.kind]} · {text.skew.direction.window}</span>
                  </>}
                  <span aria-hidden="true">·</span>
                  <span>{text.skew.asOf} {skew.latestDay}</span>
                  {skew.stale
                    ? <span className="mi-defensive-premium__stale" data-stale="skew">
                      <StatusPill tone="warn" labelKey={`${TEXT_PREFIX}.stale.pill`} resolveText={dataText} />
                      <span>{fillLabelParams(text.stale.stopsAt, { date: skew.latestDay })}</span>
                    </span>
                    : null}
                </p>
                {skew.points.length > 0
                  ? <SkewChart points={skew.points} axis={text.skew.axis}
                    ariaLabel={chartAria({
                      ariaLabel: text.chart.skewAria, summary: text.chart.skewSummary,
                      days: skew.points.map(point => point.day),
                      first: skew.points[skew.points.length - 1]!.riskReversal.toFixed(1),
                      last: skew.points[0]!.riskReversal.toFixed(1)
                    })} />
                  : null}
                {/* 1–29 个读数才说「从哪天开始记录、还差几个」；0 点与满窗不说。 */}
                {skew.points.length > 0 && skew.points.length < 30
                  ? <p className="mi-defensive-premium__history" data-skew-history>
                    {fillLabelParams(text.skew.history.remaining, { date: skew.seriesStart, n: String(30 - skew.points.length) })}
                  </p>
                  : null}
                {skew.direction.kind === 'unknown'
                  ? <SkewDirectionSentence direction={skew.direction} latestDay={skew.latestDay} text={text} />
                  : null}
              </> : skew?.state === 'empty' ? <p className="mi-defensive-premium__state">{text.empty}</p>
                : skew === undefined ? null : <p className="mi-defensive-premium__state">{skewUnavailableText(skew, text)}</p>}
          </div>
        </>}

    {/* 结论行还没内容时先把位置留出来：换态时卡底不跳。卡上没有来源行——来源身份在卡头 ⓘ
        与两格的格名（「BTC 期权偏斜（Deribit）」）上说，定稿 219 的组成里也没有那一行。 */}
    {loading && wholeCardState === undefined ? <p className="mi-defensive-premium__verdict" aria-hidden="true">&nbsp;</p> : null}
    {verdictKey && !wholeCardState ? <p className="mi-defensive-premium__verdict" data-verdict>{dataText(verdictKey)}</p> : null}
  </section>
}

/**
 * 恐惧贪婪格的读数行：这一格**没有方向位**，只有一条「截至」。
 * 读数不到 / 确实没有 / 被关掉时，把状态词写在这一行（原因留在这里，结论不重复）。
 */
function FearGreedReading({ section, cellOff, loading, text, dataText }: Readonly<{
  section: SentimentOptionsCardResult['fearGreed'] | undefined
  cellOff?: SourceCellOff
  loading: boolean
  text: DefensivePremiumCardText
  dataText: (key: string) => string
}>): React.ReactElement {
  if (cellOff !== undefined) {
    return <p className="mi-defensive-premium__reading mi-source-state" data-sentiment-state="disabled">
      <CircleSlash aria-hidden="true" className="mi-source-state__icon" size={14} />
      <span>{`${dataText('pages.intelligence.portal.data.sourcesNotEnabled')}（${cellOff.sourceLabel}）`}</span>
    </p>
  }
  if (section?.state === 'unavailable') {
    return <p className="mi-defensive-premium__reading mi-source-state" data-sentiment-state="unreadable" data-state="unreadable">
      <TriangleAlert aria-hidden="true" className="mi-source-state__icon" size={14} />
      <span>{dataText('pages.intelligence.portal.data.temporarilyUnavailable')}</span>
    </p>
  }
  if (section?.state === 'empty') {
    return <p className="mi-defensive-premium__reading mi-source-state" data-sentiment-state="empty">
      <span>{text.empty}</span>
    </p>
  }
  if (section?.state === 'available') {
    return <p className="mi-defensive-premium__reading">
      <span>{text.fearGreed.asOf} {section.latestDay}</span>
      {section.stale
        ? <span className="mi-defensive-premium__stale" data-stale="fear-greed">
          <StatusPill tone="warn" labelKey={`${TEXT_PREFIX}.stale.pill`} resolveText={dataText} />
          <span>{fillLabelParams(text.stale.stopsAt, { date: section.latestDay })}</span>
        </span>
        : null}
    </p>
  }
  // 还在读：这一行先留出来（空占位），换态时这一格不缩。
  return <p className="mi-defensive-premium__reading" aria-hidden="true">{loading ? '\u00a0' : ''}</p>
}

/** 读屏名 = 原图描述 + 一句带窗口、点数与首末值的摘要；参数都是已格式化的字符串。 */
function chartAria(input: {
  ariaLabel: string
  summary: string
  days: readonly string[]
  first: string
  last: string
}): string {
  const newest = input.days[0]
  const oldest = input.days[input.days.length - 1]
  if (!newest || !oldest) return input.ariaLabel
  return `${input.ariaLabel} ${fillLabelParams(input.summary, {
    from: oldest, to: newest, count: String(input.days.length), first: input.first, last: input.last
  })}`
}

/** 读不到要分原因：连不上、来源不可用、这次没读出来，三句不许抄成一句（AC-11）。 */
function skewUnavailableText(section: Extract<OptionSkewCardSection, { state: 'unavailable' }>, text: DefensivePremiumCardText): string {
  if ('cause' in section && section.cause === 'connection-unavailable') return text.skew.unavailable.connection
  if ('cause' in section && section.cause === 'upstream-http-error') return text.skew.unavailable.source
  return text.skew.unavailable.read
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
      : fillLabelParams(text.skew.direction.stale, { time: latestDay })
  return <p className="mi-defensive-premium__direction mi-defensive-premium__direction--unknown" data-skew-direction={direction.reason}>{sentence}</p>
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

  // 恐惧贪婪这一半没有读数——读不到、或者窗口内确实没有——都只说保费方向，并指出缺的是它。
  // 「为什么缺」由那一格的行内说，结论不重复原因（PRD §5.3）。
  if (result.fearGreed.state !== 'available') {
    return direction ? `${TEXT_PREFIX}.verdict.fgMissing.${direction}` : `${TEXT_PREFIX}.degraded.fearGreed`
  }
  if (result.optionSkew.state === 'unavailable') {
    return side ? `${TEXT_PREFIX}.verdict.${side}.skewMissing` : `${TEXT_PREFIX}.degraded.skew`
  }
  if (!side) return undefined
  if (result.optionSkew.state !== 'available' || direction === undefined) return `${TEXT_PREFIX}.verdict.${side}.skewMissing`
  return `${TEXT_PREFIX}.verdict.${side}.${direction}`
}
