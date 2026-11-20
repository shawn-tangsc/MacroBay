import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { AnalysisChange } from '../analysis/eventGroupService'
import { hashMarketAnalysisJson } from '../analysis/analysisHash'
import {
  decideItemTriggerSeverity, isNewsSeveritySource, readLatestNewsSentiment
} from '../analysis/analysisItemSeverity'
import { readString, resolveDomain, safeJson } from './analysisRuntimePayload'

/**
 * 一条情报 → 一次「变化」的解析。
 *
 * 从 `registerMarketAnalysisRuntime` 抽出来的原因只有体积（那个文件越过 500 行硬线）：这里没有
 * 运行状态机、没有作业注册，只有「载荷里的条目 → AnalysisChange」这一件事，单独读得懂也单独测得动。
 *
 * R39：新闻条目不产 `triggeredItemId`，但仍要把 `newsItem` 报给调用方——旧队列里的自动新闻作业
 * 要在建组之前止步。新闻判定还没落地时返回 `undefined`（不决定、不写账本行）。
 */
export function createAnalysisChangeResolver(deps: Readonly<{
  pipeline: Pick<IntelligencePipeline, 'listItems' | 'listRevisions'>
  latestNewsSentiment?: Parameters<typeof readLatestNewsSentiment>[0]
  now: () => string
}>): (payload: unknown) => Promise<{ change: AnalysisChange; newsItem: boolean } | undefined> {
  return async (payload) => {
  const itemId = readString(payload, 'changeId') ?? readString(payload, 'eventRef')
  const item = itemId ? deps.pipeline.listItems().find(candidate => candidate.itemId === itemId || candidate.clusterId === itemId) : undefined
  if (!item) return
  const labels = safeJson(item.processingLabelsJson)
  const previousRevision = deps.pipeline.listRevisions()
    .filter(revision => revision.itemId === item.itemId)
    .sort((left, right) => left.detectedAt.localeCompare(right.detectedAt))
    .at(-2)
  const domain = resolveDomain(labels.dataDomain, item.sourceId)
  const verdict = isNewsSeveritySource(item.sourceId) ? readLatestNewsSentiment(deps.latestNewsSentiment, item.itemId, deps.now()) : undefined
  // 新闻还没判定时这里不决定、也不写账本行——理由见 `decideItemTriggerSeverity`。
  const decision = decideItemTriggerSeverity(item, verdict)
  if (decision.decision === 'await-verdict') return
  const severity = decision.severity
  // 主触发：只有新闻类来源才写指针（R37 §1.1）。别用 itemTriggerKeys 判——那两个键里还有一个是
  // 日历发布，按它判会把日历触发的运行也写成「被一条新闻触发」。
  // R39：新闻条目不再产触发指针——按条解读只由读者手动发起。这里仍要把「这是新闻」报给
  // `groupChange`，让旧队列里的自动新闻作业在**建组之前**止步（不写组、不写账本、不排冻结）。
  const newsItem = isNewsSeveritySource(item.sourceId)
  return { change: {
    changeId: item.itemId,
    domain,
    eventRef: item.itemId,
    subject: item.title,
    severity,
    changedFields: ['item'],
    previousHash: previousRevision ? hashMarketAnalysisJson({ itemId: item.itemId, title: previousRevision.title ?? null, summary: previousRevision.summary ?? null, publishedAt: previousRevision.publishedAt ?? null }) : null,
    nextHash: hashMarketAnalysisJson({ itemId: item.itemId, title: item.title, summary: item.summary ?? null, publishedAt: item.publishedAt ?? null }),
    observedAt: item.detectedAt,
    publishedAt: item.publishedAt ?? null,
    confirmed: item.sourceTrust === 'high' && Boolean(item.publishedAt),
    sourceCount: 1,
    marketMove15mPct: null,
    fundingDeltaPctPoints: null,
    sourceKind: item.sourceTrust === 'high' ? 'official' : 'proxy',
    comparability: 'comparable',
    groupType: domain === 'macro' ? 'macro' : domain === 'capital' ? 'capital' : domain === 'funding' ? 'funding' : domain === 'cross-asset' ? 'cross-asset' : 'sentiment'
  }, newsItem }

  }
}
