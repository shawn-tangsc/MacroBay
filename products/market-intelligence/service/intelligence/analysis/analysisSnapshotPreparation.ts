import type {
  AnalysisDomain, MarketAnalysisContextAvailable, SnapshotTrigger
} from '../../../contracts/marketAnalysisContracts'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import type { NewsSentimentRecord } from '../schema/newsSentiment'
import { buildMarketAnalysisContext } from '../public-query/marketAnalysisContextQuery'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'
import type { AnalysisRun } from '../../../contracts/marketAnalysisContracts'
import { appendAnalysisEventEvidence } from './analysisEventEvidence'
import { appendAnalysisNewsSentiment, newsSentimentSince, type AnalysisNewsSentimentQuery } from './analysisNewsSentimentEvidence'
import { triggeredNewsForFreeze } from './analysisTriggeredNewsFact'
import { buildAnalysisSnapshotHash, buildEvidenceFingerprint } from './analysisHash'
import { logMarketAnalysisContextDiagnostic } from './analysisContextDiagnostic'

/**
 * 这次运行（或「如果现在点一下」）会把什么冻进快照，以及它的两个指纹。
 *
 * **一处实现，三处共用**（架构师裁定 §9.2）：写路径冻结、只读接口算「当前证据」、复用判定。
 * 只读库、不写库、不入队——所以读侧可以放心调它。
 *
 * 两个指纹回答两个不同问题：
 * - `snapshotHash`：是不是同一份冻结记录（含 `asOf` / `dataCutoff`）——**随结果返回，只作审计**；
 * - `evidenceFingerprint`：模型读到的还是不是那一批事实与证据引用——复用与界面判断都用它。
 */
export type EvidenceScope = Readonly<{
  asOf: string
  dataCutoff: string
  factCount: number
  evidenceRefCount: number
  domains: readonly AnalysisDomain[]
}>

export type PreparedMarketAnalysisSnapshot = Readonly<{
  context: MarketAnalysisContextAvailable
  trigger?: SnapshotTrigger
  snapshotHash: string
  evidenceFingerprint: string
  evidenceScope: EvidenceScope
}>

export type PreparationDependencies = Readonly<{
  publicQueryService: MarketIntelligencePublicQueryService
  pipeline: Pick<IntelligencePipeline, 'listItems' | 'listRevisions'>
  repository: Pick<MarketAnalysisRepository, 'getEventGroup' | 'listEventGroups' | 'getSnapshot' | 'listSnapshots' | 'listRuns'>
  newsSentimentQuery?: AnalysisNewsSentimentQuery
  latestNewsSentiment?: (itemId: string, asOf: string) => NewsSentimentRecord | undefined
  timeZone: () => string
}>

export async function prepareMarketAnalysisSnapshot(
  deps: PreparationDependencies,
  input: Readonly<{
    eventGroupId: string
    asOf: string
    /** 主触发条目：只有新闻触发的运行才给，给了就按条目身份强制进快照。 */
    triggeredItemId?: string
    /** 闸门已经取到的触发事件键：写路径传进来，读路径不需要（手动路径本来就是空集）。 */
    triggeredEventKeys?: ReadonlySet<string>
  }>
): Promise<PreparedMarketAnalysisSnapshot | Readonly<{ state: 'unavailable'; errorCode: string }>> {
  const previousSnapshot = deps.repository.listSnapshots(input.eventGroupId).at(-1)
  const built = await callContext(deps, input)
  if (built.state !== 'available') return built
  logMarketAnalysisContextDiagnostic(built)
  const group = deps.repository.getEventGroup(input.eventGroupId)
  if (!group) return { state: 'unavailable', errorCode: 'analysis-event-group-not-found' }
  const enriched = await appendAnalysisEventEvidence(built, group, deps.publicQueryService,
    () => deps.pipeline.listRevisions())
  const runHistory = deps.repository.listRuns()
  const sentimentSince = newsSentimentSince(runHistory as readonly AnalysisRun[], previousSnapshot?.asOf)
  const withSentiment = await appendAnalysisNewsSentiment(enriched, deps.publicQueryService,
    deps.newsSentimentQuery, { timeZone: deps.timeZone(), asOf: input.asOf, ...(sentimentSince ? { since: sentimentSince } : {}) },
    () => deps.pipeline.listRevisions())
  const triggered = await triggeredNewsForFreeze(withSentiment, {
    triggeredItemId: input.triggeredItemId,
    items: deps.pipeline.listItems(),
    verdict: input.triggeredItemId ? deps.latestNewsSentiment?.(input.triggeredItemId, input.asOf) : undefined,
    query: deps.publicQueryService,
    listRevisions: () => deps.pipeline.listRevisions()
  })
  const context = triggered.context
  return {
    context,
    ...(triggered.trigger ? { trigger: triggered.trigger } : {}),
    snapshotHash: buildAnalysisSnapshotHash({
      profileId: context.profileId, asOf: context.asOf, dataCutoff: context.dataCutoff,
      facts: context.facts, missingDomains: context.missingDomains, caveats: context.caveats, evidenceRefs: context.evidenceRefs
    }),
    evidenceFingerprint: buildEvidenceFingerprint({ facts: context.facts, evidenceRefs: context.evidenceRefs }),
    evidenceScope: {
      asOf: context.asOf, dataCutoff: context.dataCutoff,
      factCount: context.facts.length, evidenceRefCount: context.evidenceRefs.length,
      domains: [...new Set(context.facts.map(fact => fact.domain))].sort()
    }
  }
}

async function callContext(
  deps: PreparationDependencies,
  input: Readonly<{ eventGroupId: string; asOf: string; triggeredEventKeys?: ReadonlySet<string> }>
): Promise<MarketAnalysisContextAvailable | Readonly<{ state: 'unavailable'; errorCode: string }>> {
  const context = await buildMarketAnalysisContext(
    { eventGroupId: input.eventGroupId, asOf: input.asOf },
    deps.publicQueryService,
    { triggeredEventKeys: input.triggeredEventKeys ?? new Set() }
  )
  return context.state === 'available' ? context : { state: 'unavailable', errorCode: context.errorCode }
}
