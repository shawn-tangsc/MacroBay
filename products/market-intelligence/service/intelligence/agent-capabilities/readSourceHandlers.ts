import { getIntelligenceService } from '../ipc/registerIntelligenceIpc'
import { getIntelligenceModule } from '../intelligenceModule'
import { computeConfigurationRevision } from './configurationRevision'
import {
  projectSourceDetail,
  projectSourceSummary
} from './projections'
import type {
  ListSourcesInput,
  ReadHandlerDeps,
  SourceDetailInput
} from './readHandlerContracts'

const STUCK_RUN_MS = 15 * 60_000
const RUN_SAMPLE_LIMIT = 200

export async function handleGetOperationsHealth(
  _input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const health = await getIntelligenceService(deps.jobRuntime).getOperationsHealth()
  const ownedRuns = deps.jobRuntime
    .listRecentRuns(RUN_SAMPLE_LIMIT)
    .filter((run) => run.productId === 'market-intelligence' || run.handlerId.startsWith('market-intelligence.'))
  const running = ownedRuns.filter((run) => run.status === 'running')
  const nowMs = Date.now()
  const lastJobAt = running
    .map((run) => run.startedAt ?? run.createdAt)
    .sort()
    .at(-1)
  const failedSource = health.sources.some(
    (source) => source.runtimeStatus === 'failed' || source.consecutiveFailures >= 3
  )
  const stuckRun = running.some((run) => {
    const startedMs = Date.parse(run.startedAt ?? run.createdAt)
    return Number.isFinite(startedMs) && nowMs - startedMs > STUCK_RUN_MS
  })

  return {
    state: health.sources.length > 0 ? 'available' : 'empty',
    generatedAt: new Date().toISOString(),
    operations: {
      registeredSchedules: deps.jobRuntime
        .listSchedules()
        .filter((definition) => definition.productId === 'market-intelligence' || definition.id.startsWith('market-intelligence.')).length,
      runningJobs: running.length,
      ...(lastJobAt ? { lastJobAt } : {}),
      stuck: failedSource || stuckRun
    },
    caveats: ['per-source-detail-use-get-source-detail']
  }
}

export async function handleListIntelligenceSources(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { domain = 'all', includeDisabled = false } = (input ?? {}) as ListSourcesInput
  const sourcesService = getIntelligenceModule(deps.jobRuntime).sourcesService
  const [definitions, profiles, focusSettings] = await Promise.all([
    Promise.resolve(sourcesService.listDefinitions()),
    sourcesService.listProfiles(),
    sourcesService.getFocusSettings()
  ])
  const definitionById = new Map(definitions.map((definition) => [definition.sourceId, definition]))
  const revision = computeConfigurationRevision({
    profiles,
    focusMarkets: focusSettings.enabledFocusMarkets
  })

  const sources = profiles
    .filter((profile) => includeDisabled || profile.enabled === true)
    .flatMap((profile) => {
      const definition = definitionById.get(profile.sourceId)
      if (!definition) return []
      return [projectSourceSummary({ profile, definition })]
    })
    .filter((source) => domain === 'all' || source.domains.includes(domain))

  return {
    state: sources.length > 0 ? 'available' : 'empty',
    revision,
    focusMarkets: { enabledFocusMarkets: [...focusSettings.enabledFocusMarkets] },
    sources
  }
}

export async function handleGetSourceDetail(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { sourceId } = (input ?? {}) as SourceDetailInput
  const sourcesService = getIntelligenceModule(deps.jobRuntime).sourcesService
  const known = sourcesService.listDefinitions().some((definition) => definition.sourceId === sourceId)
  if (!known) {
    return { state: 'unavailable', caveats: ['unknown-source'] }
  }

  const detail = await sourcesService.getDetail(sourceId)
  return {
    state: 'available',
    source: projectSourceDetail({
      definition: detail.definition,
      profile: detail.profile,
      health: detail.health,
      runtimeConfig: detail.runtimeConfig,
      ...(detail.scheduleRule ? { scheduleRule: detail.scheduleRule } : {}),
      ...(detail.credentialStatus ? { credentialStatus: detail.credentialStatus } : {})
    }),
    caveats: []
  }
}
