import { getIntelligenceAdapter } from '../adapters/adapterRegistry'
import { getIntelligenceSourceDefinition, isDefillamaStablecoinRetiredPath } from './sourceCatalog'
import {
  buildSourceCollectionCheckpoint,
  formatSourceCheckpointPreview
} from './intelligenceSourceCheckpoint'
import { resolveAndValidateRuntimeConfig } from './sourceRuntimeConfig'
import type { AppendRawRecordInput } from '../schema/intelligenceRecord'
import type { IntelligenceSourceDefinition, IntelligenceSourceProfile } from '../schema/intelligenceSource'

/**
 * 一次采集的计数（用户 2026-11-07 要求：采集跑完必须留下可查的数字）。
 *
 * 为什么需要它：以前采集「完成」时 `result_json` 是空的，于是「今天真的没有新文章」和
 * 「抓到了但一条没写进去」在运行记录里长得**一模一样**——这种事一旦发生就没法自证。
 *
 * 五个数各答一个问题：
 * - `httpCalls` / `fetchedBytes`：**抓**——发了几次请求、正文多少字节（0 字节＝抓住了但正文是空的，
 *   和「抓不到」不是一回事：后者会带 `reasonCode` 且抛错路径把两个数留在抛出那一刻）；
 * - `parsed`：**解析**——从正文里认出几条条目（含已经在库里的）；
 * - `appended`：**新增**——真正写进原始记录的新条目；
 * - `duplicates`：**重复**——认出来但被去重键挡掉的条目。`parsed = appended + duplicates`。
 *
 * 失败时四个数为 0 并带 `reasonCode`，所以「成功但 0 条新」与「失败」在运行记录里必然不同。
 */
export type SourceCollectionCounts = Readonly<{
  httpCalls: number
  fetchedBytes: number
  parsed: number
  appended: number
  duplicates: number
}>

export const EMPTY_SOURCE_COLLECTION_COUNTS: SourceCollectionCounts = Object.freeze({
  httpCalls: 0,
  fetchedBytes: 0,
  parsed: 0,
  appended: 0,
  duplicates: 0
})

export type SourceCollectionResult = Readonly<{
  queuedJobs: string[]
  counts: SourceCollectionCounts
  /** 没采成的原因：`not-ready`（配置不齐）/ `collect-failed`（抓取或解析抛错）。 */
  reasonCode?: 'not-ready' | 'collect-failed'
  reason?: string
}>

/** 采集要给外部留的两件事：成功/失败各记一次；以及新条目要排哪个下游作业。 */
export type SourceCollectionDeps = Readonly<{
  resolveProfile: (sourceId: string) => Promise<IntelligenceSourceProfile>
  /** 本地夹具路径（测试与回放用）；不给就走真实抓取。 */
  fixtureRecords?: (sourceId: string, runId: string, text: string, parserVersion: string) => AppendRawRecordInput[]
  /** 写一条原始记录；返回 false 表示被去重键挡住。 */
  appendRawRecord: (input: AppendRawRecordInput) => unknown
  recordSuccess: (sourceId: string, checkpoint: Record<string, unknown> | undefined, summary: string) => Promise<void>
  recordFailure: (sourceId: string, reason: string) => Promise<void>
  fetchText?: (url: string, sourceId: string) => Promise<string>
  fetchMetricTarget?: (target: never, sourceId: string) => Promise<string>
}>

/**
 * 采集一次来源，并把四个数带回来。**这是采集链上唯一算数字的地方**——
 * 页面/运行日志只读它，不再各自去猜「这次到底抓没抓到」。
 */
export async function collectSourceOnce(
  deps: SourceCollectionDeps,
  input: Readonly<{ sourceId: string; runId: string; fixtureText?: string }>
): Promise<SourceCollectionResult> {
  const { sourceId, runId, fixtureText } = input
  if (isDefillamaStablecoinRetiredPath(sourceId)) {
    return { queuedJobs: [], counts: EMPTY_SOURCE_COLLECTION_COUNTS }
  }
  const definition: IntelligenceSourceDefinition | undefined = getIntelligenceSourceDefinition(sourceId)
  if (!definition) throw new Error(`Unknown intelligence source "${sourceId}".`)

  const profile = await deps.resolveProfile(sourceId)
  const { config, issues } = resolveAndValidateRuntimeConfig({
    definition,
    profile,
    hasCredential: Boolean(profile.credentialRef)
  })
  if (issues.length > 0) {
    const reason = issues[0]?.message ?? 'Source is not ready to run.'
    await deps.recordFailure(sourceId, reason)
    return {
      queuedJobs: [],
      counts: EMPTY_SOURCE_COLLECTION_COUNTS,
      reasonCode: 'not-ready',
      reason
    }
  }

  const adapter = getIntelligenceAdapter(sourceId)
  if (!adapter) throw new Error(`No adapter registered for "${sourceId}".`)

  // 抓取这一环的数字从**适配器实际发出的请求**里数，不是在事后猜：
  // 抓住了但正文是空的（0 字节）与压根没抓到（抛错）必须能分开。
  let httpCalls = 0
  let fetchedBytes = 0
  try {
    const rawInputs = fixtureText && deps.fixtureRecords
      ? deps.fixtureRecords(sourceId, runId, fixtureText, adapter.parserVersion)
      : await adapter.collect({
          config,
          runId,
          fetchText: async (url) => {
            if (!deps.fetchText) {
              throw new Error('HTTP fetch is not configured for intelligence collection.')
            }
            const body = await deps.fetchText(url, sourceId)
            httpCalls += 1
            fetchedBytes += body.length
            return body
          },
          fetchMetricTarget: deps.fetchMetricTarget
            ? async (target, sid) => deps.fetchMetricTarget!(target as never, sid ?? sourceId)
            : undefined
        })

    let appended = 0
    for (const rawInput of rawInputs) {
      if (deps.appendRawRecord(rawInput)) appended += 1
    }

    const checkpoint = buildSourceCollectionCheckpoint({
      rawInputs,
      parserVersion: adapter.parserVersion,
      appended
    })
    await deps.recordSuccess(sourceId, checkpoint, formatSourceCheckpointPreview(checkpoint))
    return {
      queuedJobs: appended > 0 ? ['market-intelligence.normalizeRawRecords'] : [],
      counts: Object.freeze({
        httpCalls,
        fetchedBytes,
        parsed: rawInputs.length,
        appended,
        // 认出来但没写进去的就是重复：两者相加必须等于解析数，不留给下一个人去算。
        duplicates: rawInputs.length - appended
      })
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Collection failed.'
    await deps.recordFailure(sourceId, reason)
    return {
      queuedJobs: [],
      counts: Object.freeze({ ...EMPTY_SOURCE_COLLECTION_COUNTS, httpCalls, fetchedBytes }),
      reasonCode: 'collect-failed',
      reason
    }
  }
}
