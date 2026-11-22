import { LoadingSpinner } from '@platform/ui/components/loading'

import { FearGreedGaugePresentationPolicy, type DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'
import type { FearGreedSnapshotBucket } from '../../../../contracts/intelligenceQueryContracts'
import type { SourceCellOff } from '../shared/sourceCellOff'

/**
 * 仪表那一列（定稿 §4.4）：**b56f86a8c 之前那版手绘仪表**——弧、刻度、指针、圆盘里的分数
 * 与它下面那个档位词。
 *
 * 用户 2026-11-22：这块本来就是现成的，合卡只是把它挪个位置，不该换成 ECharts 重画一遍；
 * 所以这里回到手绘 SVG，只把外壳换成新卡的三列网格，图形本身一字未改。
 *
 * 这一列只回答「落在哪一档」：**不画观测日期、不画三个区间标签、不画状态句**。
 * 分数与档位词由仪表自带，新卡这一列因此不再用自己的读数行（否则同一件事写两遍），只留空占位保持三列对齐。
 *
 * 三态（沿用用户已批的先例，`2026-11-11` 定稿）：**不盖遮罩**。读数不到、这一格被关掉、
 * 还在读，都照画弧与刻度，只是不画指针、圆盘与分数——它们指向一个不存在的分数。
 */
export function SentimentGauge({ state, cellOff, buckets, titleId }: Readonly<{
  state: DashboardFearGreedState
  /** 这一格被读者关掉：宿主给（来源配置属于宿主，卡片不自己推断）。给了就不看读数。 */
  cellOff?: SourceCellOff
  buckets: Record<FearGreedSnapshotBucket, string>
  /** 这一列自己没有标题：读屏名接旁边那一格的格名。 */
  titleId: string
}>): React.ReactElement {
  // 只有真有读数才画指针、圆盘与档位词；关掉时连旧读数也不画（AC-15）。
  const reading = cellOff === undefined && (state.state === 'available' || state.state === 'stale')
    ? state
    : undefined
  const waiting = cellOff === undefined && reading === undefined && state.state === 'loading'

  return <div className="mi-defensive-premium__col mi-defensive-premium__col--gauge" role="group" aria-labelledby={titleId} data-sentiment-gauge>
    {/* 与另两列共用同一套行（标题 / 读数 / 图），这三列才会对齐；这一列不需要标题。 */}
    <div className="mi-defensive-premium__cell-head" aria-hidden="true" />
    {/* 读数行留空：分数与档位词由仪表自己画，这一行只为让三列的行对齐。 */}
    <p className="mi-defensive-premium__reading" aria-hidden="true">&nbsp;</p>
    <div className="mi-defensive-premium__chart-slot mi-defensive-premium__chart-slot--gauge">
      <div className="mi-crypto-dashboard__sentiment-gauge">
        {reading
          // 读数圆盘压在指针上方，分数因此能占住圆心（b56f86a8c 之前的画法）。
          ? <>
            <span className="mi-crypto-dashboard__sentiment-dial">
              <GaugeFigure reading={reading} />
              <strong>{reading.score}</strong>
            </span>
            <span data-gauge-bucket-text={FearGreedGaugePresentationPolicy.bucketTones[reading.bucket]}>{buckets[reading.bucket]}</span>
          </>
          : waiting
            // 还在读：弧与刻度照画，指针与圆盘不画。环叠在圆盘本来占的位置上，不另占一行，也**不播报**。
            ? <>
              <span className="mi-crypto-dashboard__sentiment-dial">
                <GaugeFigure />
                <span className="mi-crypto-dashboard__sentiment-dial-wait">
                  <LoadingSpinner />
                </span>
              </span>
              <span aria-hidden="true" data-gauge-bucket-text="neutral">&nbsp;</span>
            </>
            // 读不到 / 空 / 被关掉：只留弧与刻度，一个「说得像读数」的字都不留。
            : <GaugeFigure />}
      </div>
    </div>
  </div>
}

/**
 * 弧、刻度、指针、读数圆盘：与 b56f86a8c 之前那份一字不差。
 * `reading` 给了才画指针与读数圆盘，没读数时这两样不画；弧线与刻度照旧，三态之间这一列的形状不跳。
 */
function GaugeFigure({ reading }: Readonly<{ reading?: Readonly<{ score: number; bucket: FearGreedSnapshotBucket }> }>): React.ReactElement {
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