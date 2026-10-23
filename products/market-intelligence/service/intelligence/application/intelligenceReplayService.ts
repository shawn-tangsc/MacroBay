import type { IntelligencePipeline } from './intelligencePipeline'
import { isDefillamaStablecoinRetiredPath } from './sourceCatalog'

export type IntelligenceReplaySummary = {
  sourceId: string
  queued: boolean
  queuedAt: string
  summary: string
  replayedCount?: number
}

export function createIntelligenceReplayService(deps: {
  pipeline: IntelligencePipeline
  enqueueJob?: (jobId: string, payload: Record<string, unknown>) => Promise<void>
  listRawRecords?: () => string[]
}) {
  return {
    async queueReplayWindow(input: { sourceId: string; from?: string; to?: string }): Promise<IntelligenceReplaySummary> {
      if (isDefillamaStablecoinRetiredPath(input.sourceId)) {
        return retiredReplaySummary(input.sourceId)
      }
      const rawRecordIds = filterRawRecords(deps, input)
      await deps.enqueueJob?.('market-intelligence.replayWindow', {
        sourceId: input.sourceId,
        from: input.from,
        to: input.to,
        rawRecordIds
      })

      return {
        sourceId: input.sourceId,
        queued: true,
        queuedAt: new Date().toISOString(),
        summary: `Replay queued${input.from ? ` from ${input.from}` : ''}${input.to ? ` to ${input.to}` : ''}.`
      }
    },

    async replayWindow(input: { sourceId: string; from?: string; to?: string; rawRecordIds?: string[] }) {
      if (isDefillamaStablecoinRetiredPath(input.sourceId)) {
        return { replayedCount: 0, assessmentCount: 0, queuedJobs: [] }
      }
      const summaries = deps.pipeline
        .listRawRecordSummaries()
        .filter((record) => record.sourceId === input.sourceId && withinWindow(record.detectedAt, input.from, input.to))

      const itemIds = deps.pipeline
        .listItems()
        .filter((item) => item.sourceId === input.sourceId)
        .map((item) => item.itemId)

      const assessmentResult = await deps.pipeline.assessChangedItems({ itemIds })
      await deps.pipeline.refreshSentimentAggregates({ scopeKey: 'global', horizon: '1h' })

      return {
        replayedCount: summaries.length,
        assessmentCount: assessmentResult.assessmentCount,
        queuedJobs: ['market-intelligence.refreshSentimentAggregates']
      }
    }
  }
}

function retiredReplaySummary(sourceId: string): IntelligenceReplaySummary {
  return {
    sourceId,
    queued: false,
    queuedAt: new Date().toISOString(),
    summary: 'Replay is unavailable for this source.'
  }
}

function filterRawRecords(
  deps: { pipeline: IntelligencePipeline; listRawRecords?: () => string[] },
  input: { sourceId: string; from?: string; to?: string }
): string[] {
  if (deps.listRawRecords) return deps.listRawRecords()
  return deps.pipeline
    .listRawRecordSummaries()
    .filter((record) => record.sourceId === input.sourceId && withinWindow(record.detectedAt, input.from, input.to))
    .map((record) => record.rawRecordId)
}

function withinWindow(detectedAt: string, from?: string, to?: string): boolean {
  const detectedMs = new Date(detectedAt).getTime()
  if (from && detectedMs < new Date(from).getTime()) return false
  if (to && detectedMs > new Date(to).getTime()) return false
  return true
}

export type IntelligenceReplayService = ReturnType<typeof createIntelligenceReplayService>
