import type { NarwhalIngestRepository } from './narwhalCalendarIngest'
import { ingestNarwhalReleases } from './narwhalCalendarIngest'
import { collectNarwhalCalendar, type NarwhalCollectorResult } from './narwhalCalendarCollector'
import { narwhalObservationBatches, narwhalStandardRowInputsDetailed, type NarwhalCalendarBatch,
  type NarwhalStandardRowInput } from './narwhalCalendarObservationBatches'
import { narwhalCanonicalIdentityKey } from '../marketCalendarMetricIdentity'
import type { CalendarUnmappedReason } from '../marketCalendarStandardTable'
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
  /** 按 measure 拆行的标准行（S1 双写用）。一次采集给一次，与语言无关。 */
  appendStandardRows?: (rows: readonly NarwhalStandardRowInput[],
    unmapped: readonly Readonly<{ sourceKey: string; name: string; reason: CalendarUnmappedReason
      measureKeys?: readonly string[] }>[],
    /** **来自解析结果**的输入总量：守恒式只许拿它当被减数，不许从产物反推。 */
    sourceTotals: Readonly<{ releases: number; measures: number; measuresOnEventReleases: number }>) => void
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
      Readonly<{ collector: NarwhalCollectorResult; firstPublishedCaptured: number
        counts: Readonly<{ fetched: number; observationRows: number; unmappedRows: number; eventRows: number }> }>
    > {
      let firstPublishedCaptured = 0
      // 可观测性：**抓到多少、写进去多少、其中多少算不出身份**。没有这三个数，
      // 「数据没到账」只能靠猜——上一次排查就是被这个缺口耽误的。只进日志与作业结果，不上界面。
      const counts = { fetched: 0, observationRows: 0, unmappedRows: 0, eventRows: 0 }
      const collector = await collectNarwhalCalendar(input, {
        readApiKey: deps.readApiKey,
        fetchPage,
        sleep: deps.sleep,
        ...(deps.now === undefined ? {} : { now: deps.now }),
        onReleases: releases => {
          counts.fetched += releases.length
          const stamp = new Date(deps.now?.() ?? Date.now()).toISOString()
          const result = ingestNarwhalReleases({ releases, detectedAt: stamp, recordedAt: stamp }, deps.repository)
          firstPublishedCaptured += result.firstPublishedCaptured
          if (deps.appendObservationBatch === undefined) return
          const prefix = deps.collectionIdPrefix?.() ?? `narwhal-${stamp.replace(/[:.]/g, '-')}`
          // 标准行与语言无关：一次发布拆成「一个 measure 一行」，只算一次。
          const standard = narwhalStandardRowInputsDetailed(releases)
          // 输入量从**源**算：被构造阶段丢掉的发布既不在 rows、也不在 unmapped，
          // 从产物反推的话输入会跟着一起少，方程永远平（那就是假绿）。
          deps.appendStandardRows?.(standard.rows, standard.unmapped, {
            releases: releases.length,
            measures: releases.reduce((sum, release) => sum + release.values.length, 0),
            // 无期间（事件型）发布里的 measure：随事件行走，永远变不成指标行。它是测度层的
            // **显式排除项**，不是差异——不分出来，每批都会恒报 +1（实测就是那 1 条决议带值）。
            measuresOnEventReleases: releases
              .filter((release) => (release.period ?? '').length === 0)
              .reduce((sum, release) => sum + release.values.length, 0)
          })
          for (const locale of ['zh', 'en'] as const) {
            for (const batch of narwhalObservationBatches(releases, {
              locale, parserVersion: narwhalCalendarParserVersion, collectionIdPrefix: `${prefix}-${locale}`
            })) {
              if (locale === 'zh') {
                counts.observationRows += batch.parseResult.drafts.length
                for (const draft of batch.parseResult.drafts) {
                  if (narwhalCanonicalIdentityKey(String(draft.marketFactKey)) === undefined) counts.unmappedRows += 1
                  else if (String(draft.kind) !== 'economic-indicator') counts.eventRows += 1
                }
              }
              deps.appendObservationBatch(batch)
            }
          }
        }
      })
      const summary = { ...counts, firstPublishedCaptured }
      // 一轮一行：抓取量、写入量、算不出身份的量、事件型量。数字对不上时能一眼看出是「没抓到」
      // 还是「抓到了写不进」还是「写进去了但没身份」。
      console.warn(`[macro-calendar] Narwhal 一轮：抓取 ${summary.fetched} 条、写入观测 ${summary.observationRows} 行、`
        + `算不出身份 ${summary.unmappedRows} 条、事件型 ${summary.eventRows} 条（事件型不进日历，仅入库）`)
      return { collector, firstPublishedCaptured, counts: summary }
    }
  }
}
