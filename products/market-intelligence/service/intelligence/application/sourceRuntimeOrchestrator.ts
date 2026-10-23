import type { JobRuntime, ManagedWorkerRuntime } from '@platform/jobs'

import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'
import { INTELLIGENCE_COLLECT_SOURCE_JOB } from '../jobs/intelligenceJobIds'

const STREAM_HANDLER_ID = 'market-intelligence.streamWorker'

export function intelligenceCollectJobId(sourceId: string): string {
  return `market-intelligence.collect:${sourceId}`
}

export function intelligenceWorkerId(sourceId: string): string {
  return `market-intelligence.worker:${sourceId}`
}

export type SourceRuntimeOrchestrator = {
  reconcile: (config: IntelligenceSourceConfig) => void
  remove: (sourceId: string) => void
  runNow: (config: IntelligenceSourceConfig) => Promise<{ action: 'queued-job' | 'restarted-worker' }>
}

export function createSourceRuntimeOrchestrator(deps: {
  jobRuntime: JobRuntime
  workerRuntime?: ManagedWorkerRuntime
}): SourceRuntimeOrchestrator {
  let streamHandlerRegistered = false

  function ensureStreamHandler(): void {
    if (!deps.workerRuntime || streamHandlerRegistered) return
    try {
      deps.workerRuntime.registerHandler(STREAM_HANDLER_ID, async (_payload, context) => {
        await context.markLive()
        await new Promise((resolve) => setTimeout(resolve, 60_000))
      })
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('already registered')) {
        throw error
      }
    }
    streamHandlerRegistered = true
  }

  return {
    reconcile(config) {
      this.remove(config.sourceId)
      if (!config.enabled) return

      if (config.desiredRuntimeState === 'live') {
        ensureStreamHandler()
        void deps.workerRuntime?.setDesiredWorker({
          id: intelligenceWorkerId(config.sourceId),
          owner: 'product',
          productId: 'market-intelligence',
          handlerId: STREAM_HANDLER_ID,
          title: config.sourceName,
          payload: { sourceId: config.sourceId },
          restartPolicy: {
            maxAttempts: 5,
            backoff: 'exponential',
            baseDelayMs: 2000,
            maxDelayMs: 60000
          },
          heartbeatPolicy: {
            expectedIntervalMs: 30_000,
            missedHeartbeatLimit: 2
          }
        })
        return
      }

      if (config.collectionPreset === 'manual') {
        return
      }

      const intervalMs = (config.pollingIntervalSec ?? 900) * 1000
      const jobId = intelligenceCollectJobId(config.sourceId)
      deps.jobRuntime.setSchedule(buildCollectJobDefinition(config, {
        kind: 'interval',
        intervalMs,
        anchor: 'lastComplete'
      }))
      void deps.jobRuntime.enqueueManual(jobId).catch(() => undefined)
    },
    remove(sourceId) {
      deps.jobRuntime.removeSchedule(intelligenceCollectJobId(sourceId))
      void deps.workerRuntime?.removeDesiredWorker(intelligenceWorkerId(sourceId))
    },
    async runNow(config) {
      if (config.desiredRuntimeState === 'live') {
        ensureStreamHandler()
        const workerId = intelligenceWorkerId(config.sourceId)
        if (deps.workerRuntime?.getWorker(workerId)) {
          await deps.workerRuntime.restartWorker(workerId)
        } else {
          await deps.workerRuntime?.setDesiredWorker({
            id: workerId,
            owner: 'product',
            productId: 'market-intelligence',
            handlerId: STREAM_HANDLER_ID,
            title: config.sourceName,
            payload: { sourceId: config.sourceId },
            restartPolicy: {
              maxAttempts: 5,
              backoff: 'exponential',
              baseDelayMs: 2000,
              maxDelayMs: 60000
            },
            heartbeatPolicy: {
              expectedIntervalMs: 30_000,
              missedHeartbeatLimit: 2
            }
          })
        }
        return { action: 'restarted-worker' }
      }

      await deps.jobRuntime.enqueueDefinition(buildCollectJobDefinition(config, { kind: 'manual' }))
      return { action: 'queued-job' }
    }
  }
}

function buildCollectJobDefinition(
  config: IntelligenceSourceConfig,
  trigger: { kind: 'manual' } | { kind: 'interval'; intervalMs: number; anchor: 'lastStart' | 'lastComplete' }
) {
  return {
    id: intelligenceCollectJobId(config.sourceId),
    owner: 'product' as const,
    productId: 'market-intelligence',
    handlerId: INTELLIGENCE_COLLECT_SOURCE_JOB,
    title: `Collect ${config.sourceName}`,
    trigger,
    payload: { sourceId: config.sourceId },
    concurrencyKey: `market-intelligence:${config.sourceId}`,
    retryPolicy: {
      maxAttempts: 3,
      backoff: 'exponential' as const,
      baseDelayMs: 5000,
      maxDelayMs: 300000
    }
  }
}
