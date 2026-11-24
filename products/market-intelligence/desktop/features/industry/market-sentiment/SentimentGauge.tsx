import { LoadingSpinner } from '@platform/ui/components/loading'

import type { FearGreedSnapshotBucket } from '../../../../contracts/intelligenceQueryContracts'
import type { DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'
import type { SourceCellOff } from '../shared/sourceCellOff'
import { GaugeChart } from './DefensivePremiumCharts'

/**
 * 仪表那一列（定稿 §4.4）：**ECharts 仪表**（`b56f86a8c` 那套）——五段弧、指针、圆盘里的分数。
 *
 * 用户 2026-11-24：三个名字（两个格名 + 这一列的档位词）一起落到**各自图下面那一行**（行高 22、
 * 与图间距 6），所以这一列也有了行下说明；仪表画布仍占满整格 168、与两侧走势图等高。
 *
 * 用户 2026-11-22 先要回手绘、看完截图又改口「手绘太丑」，定版是这一版；以后要再换先问用户。
 * 手绘那版试过、已否，别再拿回来。
 *
 * 这一列只回答「落在哪一档」——**不画观测日期、不画三个区间标签、不画状态句**：
 * 日期归恐惧贪婪格，状态词归图下那一行。
 *
 * 三态（沿用用户已批的先例，`2026-11-11` 定稿）：**不盖遮罩**。读数不到、这一格被关掉、
 * 还在读，都照画弧，只是不画指针、圆盘与分数——它们指向一个不存在的分数。
 */
export function SentimentGauge({ state, cellOff, titleId, bucketLabels }: Readonly<{
  state: DashboardFearGreedState
  /** 这一格被读者关掉：宿主给（来源配置属于宿主，卡片不自己推断）。给了就不看读数。 */
  cellOff?: SourceCellOff
  /** 这一列自己没有标题：读屏名接旁边那一格的格名。 */
  titleId: string
  /** 五档名（格名那种「恐惧/贪婪」的说法住在文案表，仪表不自己拼）。 */
  bucketLabels: Readonly<Record<FearGreedSnapshotBucket, string>>
}>): React.ReactElement {
  // 只有真有读数才画指针与圆盘；关掉时连旧读数也不画（AC-15）。
  const reading = cellOff === undefined && (state.state === 'available' || state.state === 'stale')
    ? state
    : undefined
  const waiting = cellOff === undefined && reading === undefined && state.state === 'loading'

  return <div className="mi-defensive-premium__col mi-defensive-premium__col--gauge" role="group" aria-labelledby={titleId} data-sentiment-gauge>
    <div className="mi-defensive-premium__chart-slot">
      <GaugeChart score={reading?.score} />
      {/* 还在读：环叠在图上，不另占一行，也**不播报**——整卡一次加载只许一处 role=status。 */}
      {waiting ? <span className="mi-defensive-premium__col-wait"><LoadingSpinner /></span> : null}
    </div>
    {/* 图下那一行：档位词居中对齐两侧的格名（用户 2026-11-24 从卡头中轨挪下来）。
        11/650、五档语义色；盘里那个分数只是画布内容，读屏靠这一句带分数的名字。 */}
    <div className="mi-defensive-premium__col-foot mi-defensive-premium__col-foot--gauge">
      {reading === undefined ? null
        : <p className="mi-defensive-premium__gauge-bucket" data-gauge-reading
          data-gauge-bucket-text={reading.bucket}
          aria-label={`${reading.score} ${bucketLabels[reading.bucket]}`}>{bucketLabels[reading.bucket]}</p>}
    </div>
  </div>
}