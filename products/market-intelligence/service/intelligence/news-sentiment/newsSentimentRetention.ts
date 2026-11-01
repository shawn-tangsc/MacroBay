import type { RetainedStore } from '../retention/marketHistoryRetentionJob'
import type { NewsSentimentStore } from './newsSentimentStore'

const DAY_MS = 24 * 3_600_000

/**
 * 154 §15 已经承诺的保留期，不在这里重新定数：正文 30 天、极性 365 天、每次有界 ≤500 行。
 * 三项放在一处，是因为它们会被测试、任务与文档同时引用；分开写就会出现「文档说 30 天、
 * 代码删 31 天」这种只有跑起来才看得见的偏差。
 */
export const newsSentimentRetentionPolicy = Object.freeze({
  documentKeepMs: 30 * DAY_MS,
  sentimentKeepMs: 365 * DAY_MS,
  /** 一次清理最多删这么多行（两张表合计），超出的留到下一次。 */
  maximumRowsPerRun: 500
})

export type NewsSentimentRetentionCutoffs = Readonly<{ documentsBefore: string; sentimentsBefore: string }>

export function newsSentimentRetentionCutoffs(atMs: number): NewsSentimentRetentionCutoffs {
  return {
    documentsBefore: new Date(atMs - newsSentimentRetentionPolicy.documentKeepMs).toISOString(),
    sentimentsBefore: new Date(atMs - newsSentimentRetentionPolicy.sentimentKeepMs).toISOString()
  }
}

/**
 * 把舆情库接进既有的每日清理 job（`market-intelligence.retain-market-history`）。
 *
 * 这里不注册任何调度：任务、时钟与启动那一次都归那个 job，舆情只是它的一站。两张表各有自己的
 * 时钟（正文按抓取时间、判断按评分时间），所以 `oldestKeptAtMs` 返回 null——把两串时间压成一个
 * 「最早还剩哪条」会变成一句读不出主语的台账。这个库也没有键值台账表（加一张要升 schema 版本，
 * 而本库的版本不符会**直接丢表重建**），因此 `note` 是空实现；本次删了多少仍由 job 的返回值带出。
 */
export function createNewsSentimentRetentionTarget(
  store: Pick<NewsSentimentStore, 'purgeBefore'>
): RetainedStore {
  return {
    retention: ({ atMs }) => {
      const cutoffs = newsSentimentRetentionCutoffs(atMs)
      const result = store.purgeBefore({ ...cutoffs, maxRows: newsSentimentRetentionPolicy.maximumRowsPerRun })
      return {
        thinned: 0,
        deleted: result.documents + result.sentiments,
        oldestKeptAtMs: null,
        capped: result.capped
      }
    },
    note: () => undefined
  }
}
