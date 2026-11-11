import { isFailingHealthState, sourceHealthState, type SourceHealthFact } from '../application/sourceProjection'
import { getIntelligenceService } from '../ipc/registerIntelligenceIpc'
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

/** 操作健康里只带得到粗档字符串；认不出的档不给健康对象（＝不亮），不猜成失败。 */
function healthFactState(
  runtimeStatus: string,
  consecutiveFailures: number
): ReturnType<typeof sourceHealthState> | undefined {
  if (runtimeStatus !== 'healthy' && runtimeStatus !== 'degraded' && runtimeStatus !== 'failed' && runtimeStatus !== 'paused') return undefined
  const fact: SourceHealthFact = { runtimeStatus, consecutiveFailures }
  return sourceHealthState({ enabled: true, health: fact })
}

export async function handleGetOperationsHealth(
  _input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const health = await getIntelligenceService(deps.intelligenceModule).getOperationsHealth()
  const ownedRuns = deps.jobRuntime
    .listRecentRuns(RUN_SAMPLE_LIMIT)
    .filter((run) => run.productId === 'market-intelligence' || run.handlerId.startsWith('market-intelligence.'))
  const running = ownedRuns.filter((run) => run.status === 'running')
  const nowMs = Date.now()
  const lastJobAt = running
    .map((run) => run.startedAt ?? run.createdAt)
    .sort()
    .at(-1)
  // 与设置页同一个五态派生：agent 问「哪些源坏了」不许自己再比一次阈值。
  const failedSource = health.sources.some((source) => {
    const state = healthFactState(source.runtimeStatus, source.consecutiveFailures)
    return state !== undefined && isFailingHealthState(state)
  })
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
  const sourcesService = deps.intelligenceModule.sourcesService
  const [definitions, profiles] = await Promise.all([
    Promise.resolve(sourcesService.listDefinitions()),
    sourcesService.listProfiles()
  ])
  const definitionById = new Map(definitions.map((definition) => [definition.sourceId, definition]))
  const revision = computeConfigurationRevision({ profiles })

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
    sources
  }
}

export async function handleGetSourceDetail(
  input: unknown,
  deps: ReadHandlerDeps
): Promise<unknown> {
  const { sourceId } = (input ?? {}) as SourceDetailInput
  const sourcesService = deps.intelligenceModule.sourcesService
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
