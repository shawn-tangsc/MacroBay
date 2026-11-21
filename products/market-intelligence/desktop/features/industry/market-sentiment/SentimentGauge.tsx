import { LoadingSpinner } from '@platform/ui/components/loading'

import { FearGreedGaugePresentationPolicy, type DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'
import type { FearGreedSnapshotBucket } from '../../../../contracts/intelligenceQueryContracts'
import type { SourceCellOff } from '../shared/sourceCellOff'

/**
 * 仪表盘一列（定稿 §4.4）：弧、刻度、指针、圆盘里的分数与它下面那个档位词。
 *
 * 这一列只画「落在哪一档」——**不画观测日期、不画三个区间标签、不画状态句**：
 * 日期归恐惧贪婪格的读数行，状态词也归那一格（定稿 §4.5、§5.1 第 6/10 行），
 * 这样三列并排时这一列的高度才是 80 + 4 + 18，随旁边的曲线格一起对齐。
 *
 * 三态（沿用用户已批的先例，`2026-11-11` 定稿）：**不盖遮罩**。读数不到、这一格被关掉、
 * 还在读，都照画弧与刻度，只是不画指针、圆盘与档位词——它们指向一个不存在的分数。
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

  return <section className="mi-crypto-dashboard__sentiment" aria-labelledby={titleId}>
    <div className="mi-crypto-dashboard__sentiment-gauge" data-sentiment-gauge>
      {reading
        // The readout disc sits on the pivot and is painted after the needle, so the score can
        // own the centre again: the needle starts underneath the disc instead of crossing it.
        ? <>
          <span className="mi-crypto-dashboard__sentiment-dial">
            <GaugeFigure reading={reading} />
            <strong>{reading.score}</strong>
          </span>
          <span data-gauge-bucket-text={FearGreedGaugePresentationPolicy.bucketTones[reading.bucket]}>{buckets[reading.bucket]}</span>
        </>
        : waiting
          // 还在读：弧与刻度照画，指针与圆盘不画。环叠在圆盘本来占的位置上，不另占一行，
          // 也**不播报**——整卡一次加载只许一处 `role="status"`（右格那颗带文案的 LoadingState）。
          ? <>
            <span className="mi-crypto-dashboard__sentiment-dial">
              <GaugeFigure />
              <span className="mi-crypto-dashboard__sentiment-dial-wait">
                <LoadingSpinner />
              </span>
            </span>
            {/* 与正常态同构的占位：档位词那行先留出来，换态时这一列不缩。 */}
            <span aria-hidden="true" data-gauge-bucket-text="neutral">&nbsp;</span>
          </>
          // 读不到 / 空 / 被关掉：只留弧与刻度，一个「说得像读数」的字都不留。
          : <GaugeFigure />}
    </div>
  </section>
}

/**
 * 表和刻度一份实现：`reading` 给了才画指针与读数圆盘。没读数时少画两样，
 * 但弧线与刻度照旧——三态之间这一列的形状不跳。
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
