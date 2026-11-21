import type { RawRecordStore } from '../application/rawRecordStore'
import type { RetainedStore } from './marketHistoryRetentionJob'

/**
 * 通用原文记录的保留期，与它挂的那一跑。
 *
 * 天数写在文档里的口径上，这里不重新定数；日历记录不跟着轮转（它们的原文在证据归档里、按自己的
 * 配额走），所以这一站只对「通用采集」生效。
 *
 * 这一站没有自己的调度，也没有自己的键值台账：任务、时钟与启动那一次都归
 * `market-intelligence.retain-market-history`。这不是省事——那个作业**没有任何用户开关能摘掉**
 * （`registerMarketHistoryRetentionJob` 启动即 `setSchedule`，全仓没有一处对它 `removeSchedule`；
 * 唯一的摘除是进入示例模式时把所有调度一起停掉再装回来）。所以把原始记录挂上去，读者关不掉它，
 * 也就不会出现「记录只增不减」的第二条路径。
 */
export const rawRecordRetentionPolicy = Object.freeze({
  retentionDays: 7,
  /**
   * 孤儿原文每次跑都回收，不等记录过期。
   *
   * 孤儿＝目录里有、没有任何记录引用的文件（复位之后留下的就是这一类）。按记录过期去触发回收，
   * 它们要等到「有记录满 7 天」那天才可能被顺带看到；而保留期这一跑每天都在，顺手清掉即可。
   */
  reclaimOrphans: true
})

/** 一次清理的可对账数：删了几条记录、几个原文、几个孤儿、释放多少字节、还剩几条。 */
export type RawRecordRetentionRun = Readonly<{
  atMs: number
  cutoff: string
  removedRecords: number
  removedPayloadFiles: number
  removedOrphanFiles: number
  reclaimedPayloadBytes: number
  remainingRecords: number
}>

/**
 * 把原始记录接进那一条每日清理。
 *
 * `oldestKeptAtMs` 返回 null：通用记录按保留期轮转、日历记录在自己那份证据配额里，两串时间各有
 * 各的起点，压成一个「最早还剩哪条」就是一句读不出主语的台账。`note` 是空实现——这个库没有键值
 * 台账表（加一张要升 schema 版本，而版本不符会直接丢表重建），删了多少条由作业返回值与那行
 * marker 带出。
 */
export function createRawRecordRetentionTarget(
  store: Pick<RawRecordStore, 'pruneRawRecords'>,
  report: (run: RawRecordRetentionRun) => void = () => undefined
): RetainedStore {
  return {
    retention: ({ atMs }) => {
      const result = store.pruneRawRecords({
        retentionDays: rawRecordRetentionPolicy.retentionDays,
        // 用这一跑的时钟，不在这里再读一次：一次清理只该有一个「今晚」。
        now: new Date(atMs).toISOString(),
        includeOrphans: rawRecordRetentionPolicy.reclaimOrphans
      })
      report({ atMs, ...result })
      return { thinned: 0, deleted: result.removedRecords, oldestKeptAtMs: null }
    },
    note: () => undefined
  }
}

/** 一次清理一行，只带数不带宽：排障要知道删了多少，但不需要记录体与原文。 */
export function logRawRecordRetention(run: RawRecordRetentionRun): void {
  console.log(JSON.stringify({ marker: 'RAW_RECORD_RETENTION', ...run }))
}