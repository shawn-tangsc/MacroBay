import type { NarwhalIngestRepository } from './narwhalCalendarIngest'
import { ingestNarwhalReleases } from './narwhalCalendarIngest'
import { collectNarwhalCalendar, type NarwhalCollectorResult } from './narwhalCalendarCollector'
import { narwhalObservationBatches, type NarwhalCalendarBatch } from './narwhalCalendarObservationBatches'
import { createNarwhalPageFetcher, type NarwhalRequest } from './narwhalCalendarHttp'

/** 观测行的解析器版本：解析规则一变就换版本号，旧的观测行不用回填。 */
export const narwhalCalendarParserVersion = 'narwhal-calendar-mc1-v1'

/**
 * 把三块接起来：HTTP 适配 → 采集循环 → 落库（含首发布快照）。
 *
 * 这一层只做装配，不做判断：节流与失败归采集循环，形状归解析器，`release_id` 幂等与
 * 首发布快照归仓库。装配处的依赖全部注入（请求函数、密钥读取、时钟、睡眠），
 * 所以整条链能在测试里跑完，不依赖网络、不依赖 Electron。
 */
export function createNarwhalCalendarRuntime(deps: Readonly<{
  request: NarwhalRequest
  readApiKey: () => string | undefined
  repository: NarwhalIngestRepository
  /**
   * 同一次采集里，把发布再写成日历观测（两类口径见 `narwhalObservationBatches`）。
   * 不注入就不写——单测与只读核对可以只用发布行。
   */
  appendObservationBatch?: (batch: NarwhalCalendarBatch) => void
  /** 观测批次的集合前缀，默认按采集时刻一采集一批。 */
  collectionIdPrefix?: () => string
  now?: () => number
  sleep: (milliseconds: number) => Promise<void>
}>) {
  const fetchPage = createNarwhalPageFetcher(deps.request, deps.readApiKey)

  return {
    /**
     * 采一轮：`startDate`/`endDate` 由调用方给（日扫就是当天或当月），不在这里猜窗口。
     *
     * 每条发布都按 `release_id` 幂等写入；首发布快照按期写一次，之后的修订不覆盖。
     */
    async run(input: Readonly<{ startDate: string; endDate: string; countries: readonly string[] }>): Promise<
      Readonly<{ collector: NarwhalCollectorResult; firstPublishedCaptured: number }>
    > {
      let firstPublishedCaptured = 0
      const collector = await collectNarwhalCalendar(input, {
        readApiKey: deps.readApiKey,
        fetchPage,
        sleep: deps.sleep,
        ...(deps.now === undefined ? {} : { now: deps.now }),
        onReleases: releases => {
          const stamp = new Date(deps.now?.() ?? Date.now()).toISOString()
          const result = ingestNarwhalReleases({ releases, detectedAt: stamp, recordedAt: stamp }, deps.repository)
          firstPublishedCaptured += result.firstPublishedCaptured
          if (deps.appendObservationBatch === undefined) return
          const prefix = deps.collectionIdPrefix?.() ?? `narwhal-${stamp.replace(/[:.]/g, '-')}`
          for (const locale of ['zh', 'en'] as const) {
            for (const batch of narwhalObservationBatches(releases, {
              locale, parserVersion: narwhalCalendarParserVersion, collectionIdPrefix: `${prefix}-${locale}`
            })) deps.appendObservationBatch(batch)
          }
        }
      })
      return { collector, firstPublishedCaptured }
    }
  }
}
