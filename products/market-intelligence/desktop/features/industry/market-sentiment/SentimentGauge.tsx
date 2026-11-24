import { LoadingSpinner } from '@platform/ui/components/loading'

import type { DashboardFearGreedState } from '../../../pages/intelligence/dashboardFearGreedModel'
import type { SourceCellOff } from '../shared/sourceCellOff'
import { GaugeChart } from './DefensivePremiumCharts'

/**
 * 仪表那一列（定稿 §4.4）：**ECharts 仪表**（`b56f86a8c` 那套）——五段弧、指针、圆盘里的分数。
 *
 * 用户 2026-11-24：仪表要**占满整格、与两侧走势图等高居中**。原来为了让档位词落在弧下方，
 * 画布被压到 127，仪表就显得又小又偏。现在档位词搬到**头栏中轨**（`SentimentOptionsCard` 那一行），
 * 这一列只剩图：画布 168、圆心 88%、半径 110（240 列）。
 *
 * 用户 2026-11-22 先要回手绘、看完截图又改口「手绘太丑」，定版是这一版；以后要再换先问用户。
 * 手绘那版试过、已否，别再拿回来。
 *
 * 这一列只回答「落在哪一档」——**不画观测日期、不画三个区间标签、不画状态句**：
 * 日期归恐惧贪婪格，状态词归那一格的说明。
 *
 * 三态（沿用用户已批的先例，`2026-11-11` 定稿）：**不盖遮罩**。读数不到、这一格被关掉、
 * 还在读，都照画弧，只是不画指针、圆盘与分数——它们指向一个不存在的分数。
 */
export function SentimentGauge({ state, cellOff, titleId }: Readonly<{
  state: DashboardFearGreedState
  /** 这一格被读者关掉：宿主给（来源配置属于宿主，卡片不自己推断）。给了就不看读数。 */
  cellOff?: SourceCellOff
  /** 这一列自己没有标题：读屏名接旁边那一格的格名。 */
  titleId: string
}>): React.ReactElement {
  // 只有真有读数才画指针与圆盘；关掉时连旧读数也不画（AC-15）。
  const reading = cellOff === undefined && (state.state === 'available' || state.state === 'stale')
    ? state
    : undefined
  const waiting = cellOff === undefined && reading === undefined && state.state === 'loading'

  return <div className="mi-defensive-premium__col mi-defensive-premium__col--gauge" role="group" aria-labelledby={titleId} data-sentiment-gauge>
    {/* 这一列没有格名行（用户 2026-11-23）：格名与半条 ⓘ 上到头栏，列里第一行就是仪表图位。
        图里不再有字（用户 2026-11-24）：档位词在头栏中轨，读屏名带分数那一句也跟过去了。 */}
    <div className="mi-defensive-premium__chart-slot">
      <GaugeChart score={reading?.score} />
      {/* 还在读：环叠在图上，不另占一行，也**不播报**——整卡一次加载只许一处 role=status。 */}
      {waiting ? <span className="mi-defensive-premium__col-wait"><LoadingSpinner /></span> : null}
    </div>
  </div>
}