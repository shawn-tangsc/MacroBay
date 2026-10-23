import type { JobDefinition, JobRuntime } from '@platform/jobs'

import type { MacroCalendarProviderProfileStore } from '../macroCalendarProviderProfileStore'

export const beaOfficialReleaseJobPolicy = Object.freeze({
  handlerId: 'market-intelligence.refreshBeaOfficialReleases',
  definitionId: 'market-intelligence.refreshBeaOfficialReleases.schedule',
  schedulerIntervalMs: 15 * 60 * 1_000,
  jobTimeoutMs: 2 * 60 * 1_000,
  retryPolicy: { maxAttempts: 1, backoff: 'none' as const, baseDelayMs: 0, maxDelayMs: 0 },
  providerId: 'macro-calendar-bea'
})

export function createBeaOfficialReleaseJobRuntime(deps: Readonly<{
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueDefinition'>
  profiles: Pick<MacroCalendarProviderProfileStore, 'list'>
  refresh: { refresh: (input: { detectedAt: string; runId: string }, signal?: AbortSignal) => Promise<{ state: 'updated' | 'unchanged' | 'unavailable' }> }
}>) {
  let disposed = false
  let initialized = false
  const active = new Map<string, { controller: AbortController; settled: Promise<void>; resolve: () => void }>()
  deps.jobRuntime.registerHandler(beaOfficialReleaseJobPolicy.handlerId, async (_payload, context) => {
    let resolve: () => void = () => undefined
    const settled = new Promise<void>((done) => { resolve = done })
    const controller = new AbortController(); active.set(context.jobRunId, { controller, settled, resolve })
    const abort = () => controller.abort(); context.signal.addEventListener('abort', abort, { once: true })
    try {
      const result = await deps.refresh.refresh({ detectedAt: new Date().toISOString(), runId: context.jobRunId }, controller.signal)
      if (result.state === 'unavailable') throw new Error('BEA official release refresh unavailable.')
    } finally { context.signal.removeEventListener('abort', abort); active.get(context.jobRunId)?.resolve(); active.delete(context.jobRunId) }
  })
  return Object.freeze({
    async initialize() {
      if (disposed || initialized) return
      initialized = true
      let profiles
      try { profiles = await deps.profiles.list() } catch { return }
      const enabled = profiles.filter((profile) => profile.providerId === beaOfficialReleaseJobPolicy.providerId && profile.enabled === true).length === 1
      if (!enabled) { deps.jobRuntime.removeSchedule(beaOfficialReleaseJobPolicy.definitionId); return }
      const definition: JobDefinition = { id: beaOfficialReleaseJobPolicy.definitionId, owner: 'product', productId: 'market-intelligence', handlerId: beaOfficialReleaseJobPolicy.handlerId, title: 'Refresh BEA official release values', trigger: { kind: 'interval', intervalMs: beaOfficialReleaseJobPolicy.schedulerIntervalMs, anchor: 'lastComplete' }, payload: {}, concurrencyKey: beaOfficialReleaseJobPolicy.handlerId, timeoutMs: beaOfficialReleaseJobPolicy.jobTimeoutMs, retryPolicy: beaOfficialReleaseJobPolicy.retryPolicy }
      deps.jobRuntime.setSchedule(definition)
      try {
        await deps.jobRuntime.enqueueDefinition({ ...definition, trigger: { kind: 'startup' as const } })
      } catch {
        // Startup enqueue failure is intentionally contained; the interval remains armed.
      }
    },
    async dispose() {
      disposed = true
      deps.jobRuntime.removeSchedule(beaOfficialReleaseJobPolicy.definitionId)
      const activeRuns = [...active.values()]
      activeRuns.forEach(({ controller }) => controller.abort())
      await Promise.allSettled(activeRuns.map(({ settled }) => settled))
    }
  })
}
