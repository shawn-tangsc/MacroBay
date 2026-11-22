import { LoadingSpinner } from '@platform/ui/components/loading'

import type { DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'
import type { FearGreedSnapshotBucket } from '../../../../contracts/intelligenceQueryContracts'
import type { SourceCellOff } from '../shared/sourceCellOff'
import { GaugeChart } from './DefensivePremiumCharts'

/**
 * 仪表那一列（定稿 §4.4）：**ECharts 仪表**（`b56f86a8c` 那套）——五段弧、指针、圆盘里的分数。
 * 档位词「极度恐惧」在**整个仪表下面**一行（用户 2026-11-22 改口两次后的定版：先说要放中间数字下面，
 * 随即改成放整个仪表下面）；盘里只有分数，这一列的读数行不写字、只留那 24 的轨道。
 *
 * 用户 2026-11-22 先要回手绘、看完截图又改口「手绘太丑」，定版是这一版；以后要再换先问用户。
 * 手绘那版试过、已否，别再拿回来。
 *
 * 这一列只回答「落在哪一档」——**不画观测日期、不画三个区间标签、不画状态句**：
 * 日期归恐惧贪婪格的读数行，状态词也归那一格（定稿 §4.5、§5.1 第 6/10 行）。
 *
 * 三态（沿用用户已批的先例，`2026-11-11` 定稿）：**不盖遮罩**。读数不到、这一格被关掉、
 * 还在读，都照画弧，只是不画指针、圆盘与分数——它们指向一个不存在的分数。
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
    {/* 这一列不需要标题；格头那一行仍留着，三列的格头与图位才在同一水平线上。 */}
    <div className="mi-defensive-premium__cell-head" aria-hidden="true" />
    {/* 读数行这一列**不写任何字**：那 24 的轨道仍占着，三格的行高才一致（定稿 §4.4）。 */}
    <div className="mi-defensive-premium__reading" aria-hidden="true" />
    <div className="mi-defensive-premium__chart-slot">
      <GaugeChart score={reading?.score} />
      {/* 档位词在整个仪表下面（用户 2026-11-22 定稿）：图位里的 y = 150–168，弧下沿 141、锚点底 145。
          分数只在盘里（画布内容），所以这一行的读屏名自带分数——视觉只有档位词，读屏读数行照旧「11 极度恐惧」。
          没有读数、这一格被关掉时整行不渲染：弧与刻度照画，不画一句指向不存在的分数的话。 */}
      {reading
        ? <p className="mi-defensive-premium__gauge-bucket" data-gauge-reading
          data-gauge-bucket-text={reading.bucket}
          aria-label={`${reading.score} ${buckets[reading.bucket]}`}>{buckets[reading.bucket]}</p>
        : null}
      {/* 还在读：环叠在图上，不另占一行，也**不播报**——整卡一次加载只许一处 role=status。 */}
      {waiting ? <span className="mi-defensive-premium__col-wait"><LoadingSpinner /></span> : null}
    </div>
  </div>
}