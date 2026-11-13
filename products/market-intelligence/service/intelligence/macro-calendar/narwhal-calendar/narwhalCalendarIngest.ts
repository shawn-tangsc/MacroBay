import type {
  NarwhalFirstPublished, NarwhalReleaseRow, NarwhalReleaseValue
} from '../narwhalReleaseContracts'
import type { NarwhalParsedRelease } from './narwhalCalendarParser'

/**
 * 采集结果落库：**一行 = 一次发布**（`release_id`），外加首发布快照。
 *
 * 两个写入面刻意分开：
 * - 发布行是「现在的样子」，来源修订就跟着变（`upsertReleaseRow` 按 `release_id` 覆盖）；
 * - 首发布快照是「第一次看到时它说上期是多少」，**之后再修订也不覆盖**——
 *   卡上的「较上期（未修正）」要的是第一次那个数。没有快照就返回 undefined，
 *   界面显示「无法确认首发布值」，**不回填 0、不拿修订值顶**。
 */

export type NarwhalIngestRepository = Readonly<{
  upsertReleaseRow: (row: NarwhalReleaseRow) => void
  recordFirstPublished: (snapshot: NarwhalFirstPublished) => boolean
}>

export type NarwhalIngestResult = Readonly<{
  releases: number
  /** 这次**第一次**写下快照的期数（之后重复看到不会增加）。 */
  firstPublishedCaptured: number
}>

/** 一期 = 一次发布里的一个 measure；快照按「期」记，不按整条发布记。 */
export function firstPublishedKey(releaseId: string, measure: string): string {
  return `${releaseId}::${measure}`
}

export function ingestNarwhalReleases(input: Readonly<{
  releases: readonly NarwhalParsedRelease[]
  detectedAt: string
  recordedAt: string
  /**
   * 写不写首发布快照。**默认写**——常态采集第一次看到某期时，那一刻的 `previous` 就是首发布值。
   *
   * **事后回填必须传 `false`**：回填是几天后才补的，来源那时已经修订过，写进去的必然是修订值。
   * 一张装修订值的「首发布快照」比没有这张表更糟——下游会把它当权威（非农那条就是 60 而非 29）。
   * 宁可留空（读侧照实说「无法确认首发布值」），也不许让回填写这一列。
   */
  captureFirstPublished?: boolean
}>, repository: NarwhalIngestRepository): NarwhalIngestResult {
  let firstPublishedCaptured = 0
  const capture = input.captureFirstPublished !== false
  for (const release of input.releases) {
    repository.upsertReleaseRow(toRow(release, input.detectedAt, input.recordedAt))
    if (!capture) continue
    for (const value of release.values) {
      const captures = captureFirstPublished(release, value, repository, input.detectedAt)
      if (captures) firstPublishedCaptured += 1
    }
  }
  return { releases: input.releases.length, firstPublishedCaptured }
}

function toRow(release: NarwhalParsedRelease, detectedAt: string, recordedAt: string): NarwhalReleaseRow {
  return {
    releaseId: release.releaseId, providerId: 'narwhal', countryCode: release.country,
    scheduledDate: release.eventDate,
    ...(release.dateBasis === 'exact' ? { scheduledAt: release.at } : {}),
    dateBasis: release.dateBasis, status: release.status,
    values: release.values.map(toValue), detectedAt, recordedAt
  }
}

function toValue(value: NarwhalParsedRelease['values'][number]): NarwhalReleaseValue {
  return {
    measure: value.measure,
    ...(value.concept === undefined ? {} : { concept: value.concept }),
    ...(value.unit === undefined ? {} : { unit: value.unit }),
    ...(value.transformation === undefined ? {} : { transformation: value.transformation }),
    ...(value.previous === undefined ? {} : { previous: value.previous }),
    ...(value.consensus === undefined ? {} : { consensus: value.consensus }),
    ...(value.actual === undefined ? {} : { actual: value.actual })
  }
}

function captureFirstPublished(
  release: NarwhalParsedRelease,
  value: NarwhalParsedRelease['values'][number],
  repository: NarwhalIngestRepository,
  capturedAt: string
): boolean {
  // 这一期第一次看到时它还没有 `previous`：不写空快照——空快照会被读成「确实没有上期」，
  // 而事实是「那一刻来源没给」。等它给出 `previous` 的那一次再写。
  if (value.previous === undefined && value.actual === undefined) return false
  return repository.recordFirstPublished({
    releaseKey: firstPublishedKey(release.releaseId, value.measure),
    providerId: 'narwhal',
    ...(value.previous === undefined ? {} : { firstPrevious: value.previous }),
    ...(value.actual === undefined ? {} : { firstActual: value.actual }),
    capturedAt
  })
}
