import type { EtfCurrentStateWindow } from './etfCurrentStateWindow'
import { settledEtfFlowRows, type EtfFlowRows } from '../signals/etfOutflowSignal'

/**
 * 「已经按定稿判过的那一天，值又变了」——记一条，不静默。
 *
 * 30 小时是代理判据，不是发行商的定稿标记；余量够不够只能用数据回答。这条计数就是那份数据：
 * 判过之后仍然变化的交易日，按资产一天记一次，带前值和后值。没有它，下一个看到 30 的人会以为
 * 它是量出来的——而它只是今天量到的一个下界。
 *
 * 只在**两次读取时都已静置满结算窗口**的日子上比。只比当前这一读是不够的：刷新每次都把
 * 当前窗口整份写进 store，上一次存的很可能是没定稿的中间值——拿它和最终值比，每个交易日
 * 跨过窗口的那一刻都会必然记一条「判后又变」，把「补报完成」当成「余量不够」。那样 30 天
 * 里天天报，翻案条件第一天就被噪声触发。上一次的读取时刻在快照的 `verifiedAt` 里。
 */
export type SettledEtfRevision = Readonly<{
  asset: 'btc' | 'eth'
  tradingDate: string
  previousUsd: number
  currentUsd: number
}>

let revisionCount = 0

export function reportSettledEtfRevisions(input: Readonly<{
  previous: EtfCurrentStateWindow | undefined
  /** 上一次读到这份窗口的时刻（快照的 `verifiedAt`）：它决定「上次那读算不算已定稿」。 */
  previousAsOf: string | undefined
  current: EtfCurrentStateWindow
  asOf: string
  log?: (line: Readonly<Record<string, unknown>>) => void
}>): readonly SettledEtfRevision[] {
  if (!input.previous || input.previousAsOf === undefined) return []
  const revisions: SettledEtfRevision[] = []
  for (const asset of ['btc', 'eth'] as const) {
    const previous: EtfFlowRows = input.previous[asset]
    const current: EtfFlowRows = input.current[asset]
    const before = new Map(previous.map(row => [row.tradingDate, row.netFlowUsd]))
    for (const row of current) {
      const prior = before.get(row.tradingDate)
      if (prior === undefined || prior === row.netFlowUsd) continue
      // 两次读取时这一天都必须已「定稿」：上一次还是中间值的话，这次的变化是补报完成，
      // 不是余量不够——那正是要排除的噪声。
      if (settledEtfFlowRows([row], input.asOf).length === 0) continue
      if (settledEtfFlowRows([{ ...row, netFlowUsd: prior }], input.previousAsOf).length === 0) continue
      const revision: SettledEtfRevision = {
        asset, tradingDate: row.tradingDate, previousUsd: prior, currentUsd: row.netFlowUsd
      }
      revisions.push(revision)
    }
  }
  const log = input.log ?? ((line: Readonly<Record<string, unknown>>) => { console.log(JSON.stringify(line)) })
  for (const revision of revisions) {
    revisionCount += 1
    log({
      marker: 'MI_ETF_SETTLED_REVISION',
      count: revisionCount,
      asset: revision.asset,
      tradingDate: revision.tradingDate,
      previousUsd: revision.previousUsd,
      currentUsd: revision.currentUsd,
      asOf: input.asOf
    })
  }
  return Object.freeze(revisions)
}
