import { LoadingSpinner } from '@platform/ui/components/loading'

import type { FearGreedSnapshotBucket } from '../../../../contracts/intelligenceQueryContracts'
import type { DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'
import type { SourceCellOff } from '../shared/sourceCellOff'
import { GaugeChart } from './DefensivePremiumCharts'

/**
 * 仪表那一列（定稿 §4.4）：**ECharts 仪表**（`b56f86a8c` 那套）——五段弧、指针、圆盘里的分数。
 *
 * 用户 2026-11-24：两侧的格名落到**图下面那一行**（行高 22、与图间距 6）；这一列的档位词反过来
 * 抬到**弧的上方**、仍在 168 图位之内（绝对定位，不新增行），所以中列图下没有行。
 * 仪表画布仍占满整格 168、与两侧走势图等高。
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
      {/* 档位词在**弧上方**、图位之内（用户 2026-11-24）：绝对定位，不新增行——中列到 168 就结束，
          两侧到 196（168 + 6 + 22），所以「三列底边同线」不再成立，但三张图的图位仍同线。
          词盒 6…22.5（top 6、行高 16.5），弧顶 31，词底到弧顶 8.5。
          11/650、五档语义色；盘里那个分数只是画布内容，读屏靠这一句带分数的名字。 */}
      {reading === undefined ? null
        : <p className="mi-defensive-premium__gauge-bucket" data-gauge-reading
          data-gauge-bucket-text={reading.bucket}
          aria-label={`${reading.score} ${bucketLabels[reading.bucket]}`}>{bucketLabels[reading.bucket]}</p>}
      {/* 还在读：环叠在图上，不另占一行，也**不播报**——整卡一次加载只许一处 role=status。 */}
      {waiting ? <span className="mi-defensive-premium__col-wait"><LoadingSpinner /></span> : null}
    </div>
  </div>
}