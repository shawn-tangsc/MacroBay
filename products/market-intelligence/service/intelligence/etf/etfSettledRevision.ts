import type { EtfCurrentStateWindow } from './etfCurrentStateWindow'
import { settledEtfFlowRows, type EtfFlowRows } from '../signals/etfOutflowSignal'

/**
 * 「已经按定稿判过的那一天，值又变了」——记一条，不静默。
 *
 * 30 小时是代理判据，不是发行商的定稿标记；余量够不够只能用数据回答。这条计数就是那份数据：
 * 判过之后仍然变化的交易日，按资产一天记一次，带前值和后值。没有它，下一个看到 30 的人会以为
 * 它是量出来的——而它只是今天量到的一个下界。
 *
 * 只在**两边都静置满结算窗口**的日子上比：还没定稿的那天当然会变，那不是异常。
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
  current: EtfCurrentStateWindow
  asOf: string
  log?: (line: Readonly<Record<string, unknown>>) => void
}>): readonly SettledEtfRevision[] {
  if (!input.previous) return []
  const revisions: SettledEtfRevision[] = []
  for (const asset of ['btc', 'eth'] as const) {
    const previous: EtfFlowRows = input.previous[asset]
    const current: EtfFlowRows = input.current[asset]
    const before = new Map(previous.map(row => [row.tradingDate, row.netFlowUsd]))
    for (const row of current) {
      const prior = before.get(row.tradingDate)
      if (prior === undefined || prior === row.netFlowUsd) continue
      // 这一天在我们判定时是否已经「定稿」：没定稿的变动是补报本身，不是余量不够。
      if (settledEtfFlowRows([row], input.asOf).length === 0) continue
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
