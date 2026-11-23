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
import { CHART_MIN_POINTS } from './defensivePremiumChartOptions'
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
    {/* 头栏与内容第一行合并（用户 2026-11-23）：不再单独占一行——卡名、卡级 ⓘ、窗口、两个格名与卡级动作
        都在这一条 24 高的行上，三轨与下面三列同宽（`1fr 240 1fr`），格名与图之间 0 间距。
        这一行挂在**卡级**（`grid-column: 1 / -1`）：整卡读失败/空时它留着——那时 ⓘ 最需要；
        但两个格名跟着三列一起收起来，下面已经被一张状态面替掉，留着格名等于给空格子立两个标题。 */}
    <div className="mi-defensive-premium__topbar">
      <div className="mi-defensive-premium__topbar-lead">
        <h2 id={TITLE_ID}>{text.title}</h2>
        <Popover lines={[{ labelKey: `${TEXT_PREFIX}.titleInfo` }]} resolveText={dataText}
          trigger={triggerProps => (
            <IconButton {...triggerProps} ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.titleInfoLabel" icon={Info} resolveText={dataText} size="sm" variant="plain" />
          )} />
        {/* 窗口是整卡的事（用户 2026-11-23 定的排布）：贴卡名读，不放到最右那一轨。 */}
        <span className="mi-defensive-premium__window">{dataText(`${TEXT_PREFIX}.window`)}</span>
        {wholeCardState === undefined ? <>
          <div className="mi-defensive-premium__half-head" data-half-head="fear-greed">
            {/* 行名只有格名（用户 2026-11-22）：量程就在刻度上（0/50/100），不再后缀一遍。 */}
            <h3 id={FEAR_GREED_HEADING_ID}>{text.fearGreed.name}</h3>
            <Popover resolveText={dataText} lines={[
              { labelKey: `${TEXT_PREFIX}.fearGreed.info.volatility` },
              percentile
                ? { labelKey: `${TEXT_PREFIX}.fearGreed.info.percentile`, params: { percentile: String(percentile.value) } }
                : { labelKey: `${TEXT_PREFIX}.fearGreed.info.percentileInsufficient` },
            ]} trigger={triggerProps => (
              <IconButton {...triggerProps} ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.fearGreed.infoLabel" icon={Info} resolveText={dataText} size="sm" variant="plain" />
            )} />
            {/* 格名行右端：这一格的值在仪表盘那一列，这里只放「偏旧」这类陈旧状态（AC-20 照旧要标）。 */}
            {fearGreed?.state === 'available' && fearGreed.stale
              ? <span className="mi-defensive-premium__headline-tail" data-stale="fear-greed">
                <StatusPill tone="warn" labelKey={`${TEXT_PREFIX}.stale.pill`} resolveText={dataText} />
                <span>{fillLabelParams(text.stale.stopsAt, { date: fearGreed.latestDay })}</span>
              </span>
              : null}
          </div>
        </> : null}
      </div>
      <div className="mi-defensive-premium__topbar-tail">
        {wholeCardState === undefined ? <div className="mi-defensive-premium__half-head" data-half-head="skew">
          <h3 id={SKEW_HEADING_ID}>{text.skew.name}</h3>
          <Popover resolveText={dataText} lines={[
            { labelKey: `${TEXT_PREFIX}.skew.info.definition` },
            { labelKey: `${TEXT_PREFIX}.skew.info.relative` },
            { labelKey: `${TEXT_PREFIX}.skew.info.since` },
          ]} trigger={triggerProps => (
            <IconButton {...triggerProps} ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.skew.infoLabel" icon={Info} resolveText={dataText} size="sm" variant="plain" />
          )} />
        </div> : null}
        <div className="mi-defensive-premium__topbar-actions">
          {/* 行名行右端就是这一格的读数（用户 2026-11-22）：值 12/650 + 单位 11/muted，右对齐；
              方向词与窗口跟着值走，挤的时候折到名称下面一行，名称不许被挤断。 */}
          {skew?.state === 'available'
            ? <span className="mi-defensive-premium__headline-tail">
              <strong className="mi-defensive-premium__headline-value" data-skew-value>{skew.latest.riskReversal.toFixed(1)}</strong>
              <span>{text.skew.unit}</span>
              {skew.direction.kind === 'unknown' ? null : <>
                <span aria-hidden="true">·</span>
                <span data-skew-direction={skew.direction.kind}>{text.skew.direction[skew.direction.kind]} · {text.skew.direction.window}</span>
              </>}
              {skew.stale
                ? <span className="mi-defensive-premium__stale" data-stale="skew">
                  <StatusPill tone="warn" labelKey={`${TEXT_PREFIX}.stale.pill`} resolveText={dataText} />
                  <span>{fillLabelParams(text.stale.stopsAt, { date: skew.latestDay })}</span>
                </span>
                : null}
            </span>
            : null}
          {/* 整卡只留一颗动作：未接入时是「查看来源」，其余可读状态下是刷新；整块状态面自己带动作，
              这一轨不再给第二颗（AC-14）。 */}
          {/* 动作一律 24 高（`md`）：文字按钮是 24，图标按钮若用 22，换态时会跳 2px。 */}
          {showRefresh ? <IconButton ariaLabelKey="pages.intelligence.portal.dashboard.defensivePremium.action.refresh" icon={RefreshCw} resolveText={dataText} size="md" variant="plain"
            onSelect={onRefresh} disabled={loading} className="mi-defensive-premium__refresh" /> : null}
          {/* 这一格被读者关掉时，「去启用」也只在头栏；格内不再放按钮（AC-31）。 */}
          {showEnable && cellOff !== undefined
            ? <Button size="small" onClick={cellOff.onOpenSources} className="mi-defensive-premium__source-action">{text.action.enable}</Button>
            : null}
          {showViewSource ? <Button size="small" onClick={onViewSource} className="mi-defensive-premium__source-action">
            {text.action.viewSource}
          </Button> : null}
        </div>
      </div>
    </div>

    {wholeCardState === 'error' ? <StateView state="error" reasonCode="unreadable"
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRefresh }} />
      : wholeCardState === 'empty' ? <StateView state="empty" reasonCode="not-yet" />
        : <>
          {/* 三格顺序（用户 2026-11-22）：恐惧贪婪走势 | 仪表 | 偏斜走势——仪表居中，两张走势各一边。 */}
          <div className="mi-defensive-premium__col" data-half="fear-greed">
            {/* 格名与半条 ⓘ 已经上到头栏那一轨（用户 2026-11-23），列里第一行就是图。 */}
            {/* 图位：曲线、加载空图框、或一块「这一格怎么没数」的状态块——三种都占同一个高度，
                所以未接入/读不到时那一列不会塌成一行、留一大片空白。 */}
            {cellOff !== undefined
              ? <StateSlot tone="disabled" stateAttribute="disabled" icon={<CircleSlash size={14} aria-hidden="true" />}
                sentence={`${dataText('pages.intelligence.portal.data.sourcesNotEnabled')}（${cellOff.sourceLabel}）`} />
              : fearGreed?.state === 'unavailable'
                ? <StateSlot tone="unreadable" stateAttribute="unreadable" icon={<TriangleAlert size={14} aria-hidden="true" />}
                  sentence={dataText('pages.intelligence.portal.data.temporarilyUnavailable')} />
                : fearGreed?.state === 'empty'
                  ? <StateSlot tone="empty" stateAttribute="empty" sentence={text.empty} />
                  : loading
                    ? <ChartPlaceholder axisLabel={text.fearGreed.axis} />
                    : fearGreed?.state === 'available' && fearGreed.points.length > 0
                      ? <FearGreedChart points={fearGreed.points}
                        ariaLabel={chartAria({
                          ariaLabel: text.chart.fearGreedAria, summary: text.chart.fearGreedSummary,
                          days: fearGreed.points.map(point => point.day),
                          first: String(fearGreed.points[fearGreed.points.length - 1]!.score),
                          last: String(fearGreed.points[0]!.score)
                        })} />
                      : null}
          </div>

          {/* 中间那一列：仪表只回答「落在哪一档」，日期与状态词在各自那一格的读数行上（定稿 §4.4 / §4.5）。 */}
          <SentimentGauge state={toGaugeState(fearGreed)} buckets={text.fearGreed.buckets} titleId={FEAR_GREED_HEADING_ID}
            {...(cellOff === undefined ? {} : { cellOff })} />

          <div className="mi-defensive-premium__col" data-half="skew">
            {skew === undefined && loading ? <>
              {/* 与正常态同构的占位：读数行、图框；转圈叠在图框里，不另占一行。 */}
              <ChartPlaceholder axisLabel={text.skew.axis} waitingLabel={text.loading} />
            </>
              : skew?.state === 'not-connected' ? <>
                <StateSlot tone="missing" sentence={text.skew.notConnected} />
              </>
                : skew?.state === 'available' ? <>
                {/* 1–2 个读数**也画点**（不连线）：画成空框读者会以为没采到（用户 2026-11-22）。
                    「还在攒」那句改走说明行，图位留给点；第 3 个读数起才连线（CHART_MIN_POINTS）。 */}
                {skew.points.length < CHART_MIN_POINTS
                  ? <>
                    <SkewChart points={skew.points}
                      ariaLabel={chartAria({
                        ariaLabel: text.chart.skewAria, summary: text.chart.skewSummary,
                        days: skew.points.map(point => point.day),
                        first: skew.points[skew.points.length - 1]!.riskReversal.toFixed(1),
                        last: skew.points[0]!.riskReversal.toFixed(1)
                      })} />
                    <div className="mi-defensive-premium__notes">
                      <p className="mi-defensive-premium__history" data-skew-accumulating>
                        {fillLabelParams(text.skew.accumulating, {
                          collected: String(skew.points.length), remaining: String(30 - skew.points.length)
                        })}
                      </p>
                    </div>
                  </>
                  : <>
                    <SkewChart points={skew.points}
                      ariaLabel={chartAria({
                        ariaLabel: text.chart.skewAria, summary: text.chart.skewSummary,
                        days: skew.points.map(point => point.day),
                        first: skew.points[skew.points.length - 1]!.riskReversal.toFixed(1),
                        last: skew.points[0]!.riskReversal.toFixed(1)
                      })} />
                    {/* 图下只留**一行**说明，装在一个容器里落进列模板的第 4 行（`auto`）：
                        方向未知（不足 5 天 / 偏旧 / 断档）说方向，方向已知且窗口未满说攒到哪天。
                        两句同时出就是同一件事说两遍——读者在 1 点那天看到过。 */}
                    {skew.direction.kind === 'unknown'
                      ? <div className="mi-defensive-premium__notes">
                        <SkewDirectionSentence direction={skew.direction} latestDay={skew.latestDay} text={text} />
                      </div>
                      : skew.points.length < 30
                        ? <div className="mi-defensive-premium__notes">
                          <p className="mi-defensive-premium__history" data-skew-history>
                            {fillLabelParams(text.skew.history.remaining, { date: skew.seriesStart, n: String(30 - skew.points.length) })}
                          </p>
                        </div>
                        : null}
                  </>}
              </> : skew?.state === 'empty' ? <>
                {/* 偏斜用自己的空态句：借用 `text.empty` 会让这半显示「暂无已采集的恐惧与贪婪指数」。 */}
                <StateSlot tone="empty" stateAttribute="empty" sentence={text.skew.empty} />
              </>
                : skew === undefined ? null : <>
                    <StateSlot tone="unreadable" sentence={skewUnavailableText(skew, text)} />
                </>}
          </div>
        </>}

    {/* 结论行还没内容时先把位置留出来：换态时卡底不跳。卡上没有来源行——来源身份在卡头 ⓘ
        与两格的格名（「BTC 期权偏斜（Deribit）」）上说，定稿 219 的组成里也没有那一行。 */}
    {loading && wholeCardState === undefined ? <p className="mi-defensive-premium__verdict" aria-hidden="true">&nbsp;</p> : null}
    {verdictKey && !wholeCardState ? <p className="mi-defensive-premium__verdict" data-verdict>{dataText(verdictKey)}</p> : null}
  </section>
}


/**
 * 图位上的状态块：这一格没有数要画时，句子就落在这里，占住与曲线相同的高度。
 * `stateAttribute` 给了就带上 `data-sentiment-state`（恐惧贪婪格的三种「没数」用它标记）。
 */
function StateSlot({ tone, sentence, icon, stateAttribute }: Readonly<{
  tone: 'disabled' | 'unreadable' | 'empty' | 'missing'
  sentence: string
  icon?: React.ReactNode
  stateAttribute?: 'disabled' | 'unreadable' | 'empty'
}>): React.ReactElement {
  return <p className="mi-defensive-premium__state-box" data-state={tone}
    {...(stateAttribute === undefined ? {} : { 'data-sentiment-state': stateAttribute })}>
    {icon}<span>{sentence}</span>
  </p>
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
