import { describe, expect, it, vi } from 'vitest'

const platformFetch = vi.hoisted(() => vi.fn())
vi.mock('@platform/network/platformFetch', () => ({ getPlatformFetch: () => platformFetch }))

import { createJobRuntime, createManagedWorkerRuntime } from '@platform/jobs'

import { createInMemoryProfileStorage, createSourceProfileStore, type SourceProfileStore } from '../application/sourceProfileStore'
import {
  createInMemoryFocusSettingsStorage,
  createIntelligenceFocusSettingsStore
} from '../application/intelligenceFocusSettingsStore'
import { createInMemoryIntelligenceCredentialStorage, createIntelligenceCredentialStore } from '../store/intelligenceCredentialStore'
import { createIntelligencePipeline } from '../application/intelligencePipeline'
import { createSourceRequestGovernanceQueue } from '../application/sourceRequestGovernance'
import { createDefaultProfileForDefinition, createIntelligenceSourcesService } from '../application/intelligenceSourcesService'
import { createSourceRuntimeOrchestrator, intelligenceCollectJobId } from '../application/sourceRuntimeOrchestrator'
import { registerIntelligenceJobs } from '../jobs/registerIntelligenceJobs'
import { resolveRuntimeConfig } from '../application/sourceRuntimeConfig'
import { getIntelligenceSourceDefinition } from '../application/sourceCatalog'
import { realMarketApiPriceResponse } from '../macro-market/realMarketApiResponseFixtures'
import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'

describe('intelligenceSources service', () => {
  it('returns definitions, detail, profile, runtime config, and health in page state', async () => {
    const service = createService()
    const pageState = await service.getPageState({ sourceId: 'coindesk-rss' })

    expect(pageState.definitions.length).toBeGreaterThan(0)
    expect(pageState.detail?.definition.sourceId).toBe('coindesk-rss')
    expect(pageState.detail?.profile.sourceId).toBe('coindesk-rss')
    expect(pageState.detail?.runtimeConfig.sourceId).toBe('coindesk-rss')
    expect(pageState.detail?.health.sourceId).toBe('coindesk-rss')
  })

  it('derives the settings view from the registry and the saved profiles', async () => {
    const service = createService()
    await service.saveProfile({ sourceId: 'alternative-fear-greed', enabled: true, collectionPreset: 'balanced' })
    const view = await service.getSettingsView()
    const sources = view.groups.flatMap((group) => group.providers.flatMap((provider) => provider.sources))

    expect(view.counts.total).toBe(sources.length)
    expect(sources.find((source) => source.sourceId === 'alternative-fear-greed')?.enabled).toBe(true)
    expect(sources.filter((source) => source.providerId === '0xrouter')).toHaveLength(4)
    expect(new Set(sources.map((source) => source.sourceId)).size).toBe(sources.length)
  })

  it('disables a normal polling source again', async () => {
    const service = createService()
    await service.setEnabled({ sourceId: 'federal-reserve-rss', enabled: true })
    await service.setEnabled({ sourceId: 'federal-reserve-rss', enabled: false })
    const detail = await service.getDetail('federal-reserve-rss')
    expect(detail.profile.enabled).toBe(false)
  })

  it('reveals a saved raw key only through the explicit reveal method', async () => {
    const service = createService()
    await service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'sk-live-0123456789abcdef' })
    const revealed = await service.revealCredential({ sourceId: '0xrouter-aggregate-provider' })
    expect(revealed.apiKey).toBe('sk-live-0123456789abcdef')
    const page = await service.getPageState({ sourceId: '0xrouter-aggregate-provider' })
    expect(JSON.stringify(page)).not.toContain('sk-live-0123456789abcdef')
  })

  it('derives the dashboard and calendar panel views without duplicates', async () => {
    const service = createService()
    const dashboard = await service.getPanelView({ panelId: 'dashboard' })
    const calendar = await service.getPanelView({ panelId: 'economic-calendar' })

    const dashboardSources = dashboard?.providers.flatMap((provider) => provider.sources) ?? []
    const calendarSources = calendar?.providers.flatMap((provider) => provider.sources) ?? []
    expect(new Set(dashboardSources.map((source) => source.sourceId)).size).toBe(dashboardSources.length)
    expect(dashboard?.providers.filter((provider) => provider.providerId === '0xrouter')).toHaveLength(1)
    expect(calendarSources.every((source) => source.panels.includes('economic-calendar'))).toBe(true)
  })

  it('does not expose source request governance policy or queue internals in safe 0xRouter state', async () => {
    const service = createService()
    const listed = service.listDefinitions()
    const state = await service.getPageState({ sourceId: '0xrouter-aggregate-provider' })
    const detailJson = JSON.stringify(state.detail)
    const definition = state.detail?.definition as unknown as Record<string, unknown>

    expect(definition).not.toHaveProperty('requestGovernance')
    expect(detailJson).not.toMatch(/requestGovernance|opaque|digest|queue/i)
    expect(JSON.stringify(state.definitions)).not.toMatch(/requestGovernance|opaque|digest|queue/i)
    expect(JSON.stringify(listed)).not.toMatch(/requestGovernance|opaque|digest|queue/i)
  })

  it('returns only the prospective Dashboard REST schedule rule from the safe source detail', async () => {
    const service = createService()
    await service.saveProfile({ sourceId: 'alternative-fear-greed', enabled: false, collectionPreset: 'balanced' })
    await service.saveProfile({ sourceId: 'binance-futures-positioning', enabled: false, collectionPreset: 'frequent' })
    await service.saveProfile({ sourceId: 'defillama-stablecoins', enabled: false, collectionPreset: 'balanced' })

    const fearGreedDetail = (await service.getPageState({ sourceId: 'alternative-fear-greed' })).detail
    const fundingDetail = (await service.getPageState({ sourceId: 'binance-futures-positioning' })).detail
    const stablecoinDetail = (await service.getPageState({ sourceId: 'defillama-stablecoins' })).detail
    await service.saveProfile({ sourceId: 'alternative-fear-greed', enabled: false, collectionPreset: 'manual' })
    const manualDetail = (await service.getPageState({ sourceId: 'alternative-fear-greed' })).detail
    const unrelatedDetail = (await service.getPageState({ sourceId: 'coindesk-rss' })).detail
    const fearGreedSchedule = (fearGreedDetail as unknown as { scheduleRule?: unknown }).scheduleRule
    const fundingSchedule = (fundingDetail as unknown as { scheduleRule?: unknown }).scheduleRule
    const stablecoinSchedule = (stablecoinDetail as unknown as { scheduleRule?: unknown }).scheduleRule
    const manualSchedule = (manualDetail as unknown as { scheduleRule?: unknown }).scheduleRule

    expect(fearGreedSchedule).toEqual({ mode: 'interval', intervalSeconds: 600, anchor: 'last-complete', initialRunOnEnable: true })
    expect(fundingSchedule).toEqual({ mode: 'interval', intervalSeconds: 180, anchor: 'last-complete', initialRunOnEnable: true })
    expect(stablecoinSchedule).toEqual({ mode: 'interval', intervalSeconds: 600, anchor: 'last-complete', initialRunOnEnable: true })
    expect(manualSchedule).toEqual({ mode: 'manual' })
    expect(unrelatedDetail).not.toHaveProperty('scheduleRule')
    expect(Object.keys(fearGreedSchedule as object)).toEqual(['mode', 'intervalSeconds', 'anchor', 'initialRunOnEnable'])
    expect(Object.isFrozen(fearGreedSchedule)).toBe(true)
    expect(JSON.stringify(fearGreedSchedule)).not.toMatch(/url|health|credential|job|exception|profile/i)
  })

  it('omits the Dashboard schedule rule for a foreign or extension-bearing profile result', async () => {
    const definition = getIntelligenceSourceDefinition('alternative-fear-greed')!
    const baseProfile = createDefaultProfileForDefinition(definition.sourceId)
    const extensionProfile = { ...baseProfile, collectionPreset: 'balanced' as const, extension: true } as unknown as IntelligenceSourceProfile
    const foreignProfile = { ...baseProfile, sourceId: 'binance-futures-positioning', collectionPreset: 'balanced' as const } as unknown as IntelligenceSourceProfile
    const foreignProfileStore = createSourceProfileStore(createInMemoryProfileStorage())
    foreignProfileStore.resolveProfile = async () => foreignProfile

    const extensionDetail = await createService(createJobRuntime(), [extensionProfile]).getDetail(definition.sourceId)
    const foreignDetail = await createService(createJobRuntime(), [], foreignProfileStore).getDetail(definition.sourceId)

    expect(extensionDetail).not.toHaveProperty('scheduleRule')
    expect(foreignDetail).not.toHaveProperty('scheduleRule')
  })

  it('persists profile overrides without mutating definitions', async () => {
    const service = createService()
    const before = await service.getDetail('sec-rss')

    const saved = await service.saveProfile({
      sourceId: 'sec-rss',
      enabled: true,
      collectionPreset: 'frequent',
      retentionMode: 'extended'
    })

    expect(saved.profile.collectionPreset).toBe('frequent')
    expect(saved.definition).toEqual(before.definition)
    expect(saved.definition.defaultCollectionPreset).toBe('balanced')
  })

  it('enqueues a collection job for polling sources on runNow', async () => {
    const jobRuntime = createJobRuntime()
    registerIntelligenceJobs(jobRuntime, { pipeline: createIntelligencePipeline() })
    const service = createService(jobRuntime)

    await service.saveProfile({ sourceId: 'coindesk-rss', enabled: true })
    const result = await service.runNow({ sourceId: 'coindesk-rss' })

    expect(result.action).toBe('queued-job')
    expect(jobRuntime.listRecentRuns(1)[0]?.handlerId).toBe('market-intelligence.collectSource')
  })

  it('connects stream sources through the worker runtime on runNow', async () => {
    const jobRuntime = createJobRuntime()
    const workerRuntime = createManagedWorkerRuntime()
    const orchestrator = createSourceRuntimeOrchestrator({ jobRuntime, workerRuntime })

    const definition = getIntelligenceSourceDefinition('coindesk-rss')!
    const config = resolveRuntimeConfig({
      definition: { ...definition, executionMode: 'websocket', adapterType: 'websocket-stream-consumer' },
      profile: {
        ...(await createService(jobRuntime).getDetail('coindesk-rss')).profile,
        enabled: true
      }
    })

    const first = await orchestrator.runNow(config)
    expect(first.action).toBe('restarted-worker')
    expect(workerRuntime.getWorker('market-intelligence.worker:coindesk-rss')).toBeTruthy()
  })

  it('never returns raw secrets in safe views', async () => {
    const service = createService()
    await service.testCredentials({ sourceId: 'fred', credentialDraft: 'super-secret-key-value' })
    const detail = await service.getDetail('fred')

    expect(JSON.stringify(detail)).not.toContain('super-secret-key-value')
    expect(detail.credentialStatus?.maskedPreview).toContain('****')
    expect(detail.profile.credentialRef).toBe('fred-credentials')
    expect(detail.credentialStatus?.hasCredential).toBe(true)
  })

  it('rejects production enable and runNow for fixture-ready sources', async () => {
    const jobRuntime = createJobRuntime()
    registerIntelligenceJobs(jobRuntime, { pipeline: createIntelligencePipeline() })
    const service = createService(jobRuntime)

    await expect(service.saveProfile({ sourceId: 'bls-economic-series', enabled: true })).rejects.toThrow(
      'not ready for production collection'
    )
    await expect(service.runNow({ sourceId: 'bls-economic-series' })).rejects.toThrow(
      'not available for production collection'
    )
  })

  it('returns focus market settings in page state and persists updates', async () => {
    const service = createService()
    const pageState = await service.getPageState()

    expect(pageState.focusMarketSettings.enabledFocusMarkets).toEqual(['global-macro', 'digital-assets'])

    const saved = await service.saveFocusSettings({ enabledFocusMarkets: ['global-macro'] })
    expect(saved.enabledFocusMarkets).toEqual(['global-macro'])
    expect((await service.getFocusSettings()).enabledFocusMarkets).toEqual(['global-macro'])
  })

  it('returns normalized errors for unknown source ids', async () => {
    const service = createService()
    await expect(service.getDetail('unknown-source')).rejects.toThrow('Unknown intelligence source')
  })

  it('saves and replaces a 0xRouter API key as an unverified masked configuration credential without validation side effects', async () => {
    const jobRuntime = createJobRuntime()
    const pipeline = createIntelligencePipeline()
    const reportConnectivityProbe = vi.spyOn(pipeline, 'reportConnectivityProbe')
    const collectSource = vi.spyOn(pipeline, 'collectSource')
    const normalizeRawRecords = vi.spyOn(pipeline, 'normalizeRawRecords')
    const refreshSentimentAggregates = vi.spyOn(pipeline, 'refreshSentimentAggregates')
    const validateCredential = vi.fn(async () => ({ ok: true, message: 'Credential verified with provider.' }))
    const service = createService(jobRuntime, [], undefined, pipeline, validateCredential)

    await expect(service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'router-secret-one' })).resolves.toEqual({
      sourceId: '0xrouter-aggregate-provider', state: 'unverified'
    })
    await expect(service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'router-secret-two' })).resolves.toEqual({
      sourceId: '0xrouter-aggregate-provider', state: 'unverified'
    })
    const detail = await service.getDetail('0xrouter-aggregate-provider')

    expect(detail.credentialStatus).toMatchObject({ hasCredential: true, maskedPreview: expect.stringContaining('****') })
    expect(detail.credentialStatus).not.toHaveProperty('lastValidatedAt')
    expect(JSON.stringify(detail)).not.toMatch(/router-secret-one|router-secret-two/)
    expect(validateCredential).not.toHaveBeenCalled()
    expect(reportConnectivityProbe).not.toHaveBeenCalled()
    expect(collectSource).not.toHaveBeenCalled()
    expect(normalizeRawRecords).not.toHaveBeenCalled()
    expect(refreshSentimentAggregates).not.toHaveBeenCalled()
    await expect(service.saveProfile({ sourceId: '0xrouter-aggregate-provider', enabled: true })).resolves.toMatchObject({ profile: { enabled: true } })
    expect(jobRuntime.listRecentRuns()).toEqual([])
  })

  it('fails 0xRouter connection safely when its fixed official probe contract is unavailable', async () => {
    platformFetch.mockResolvedValueOnce(new Response('<html>blocked</html>', { status: 403, headers: { 'content-type': 'text/html' } }))
    const service = createService()
    await service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'router-secret' })

    await expect(service.testConnection({ sourceId: '0xrouter-aggregate-provider' })).resolves.toEqual({
      sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'response-unavailable'
    })
  })

  it('probes the fixed 0xRouter account balance endpoint with the source credential and validates its object response', async () => {
    platformFetch.mockClear()
    platformFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      balance: 123.45,
      permissions: ['read']
    }), { status: 200, headers: { 'content-type': 'application/json; charset=UTF-8' } }))
    const service = createService(createJobRuntime(), [], undefined, undefined, undefined, createSourceRequestGovernanceQueue({ now: () => Date.now() }))
    await service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'router-probe-key' })

    await expect(service.testConnection({ sourceId: '0xrouter-aggregate-provider' })).resolves.toEqual({
      sourceId: '0xrouter-aggregate-provider', state: 'succeeded'
    })
    expect(platformFetch).toHaveBeenCalledWith(
      'https://0xrouter.app/account/balance',
      expect.objectContaining({ method: 'GET', headers: { 'X-My-Token': 'router-probe-key' } })
    )
    expect(platformFetch).toHaveBeenCalledTimes(1)
    expect(platformFetch).not.toHaveBeenCalledWith(expect.stringContaining('/account/balance/'), expect.anything())
    expect(platformFetch).not.toHaveBeenCalledWith(expect.stringContaining('/cexdata/etf/'), expect.anything())
  })

  it('routes an explicit 0xRouter connection test through the shared API-key queue', async () => {
    platformFetch.mockClear()
    const queue = createSourceRequestGovernanceQueue({ now: () => Date.now() })
    const blockers = Array.from({ length: 10 }, () => deferred<void>())
    blockers.forEach((blocker) => void queue.enqueue({
      sourceId: '0xrouter-aggregate-provider', apiKey: 'router-probe-key', intent: 'user',
      policy: getIntelligenceSourceDefinition('0xrouter-aggregate-provider')!.requestGovernance,
      run: () => blocker.promise
    }))
    const service = createService(createJobRuntime(), [], undefined, undefined, undefined, queue)
    await service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'router-probe-key' })
    const pending = service.testConnection({ sourceId: '0xrouter-aggregate-provider' })
    await vi.waitFor(() => expect(queue.pendingCount()).toBe(1))
    expect(platformFetch).not.toHaveBeenCalled()
    queue.close()
    await expect(pending).resolves.toEqual({ sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'response-unavailable' })
  })

  it('fails closed without a governance queue and never bypasses the probe boundary', async () => {
    platformFetch.mockClear()
    const service = createService(createJobRuntime(), [], undefined, undefined, undefined, null)
    await service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'router-probe-key' })

    await expect(service.testConnection({ sourceId: '0xrouter-aggregate-provider' })).resolves.toEqual({
      sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'response-unavailable'
    })
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('includes only the visible request budget in 0xRouter detail', async () => {
    const detail = await createService().getDetail('0xrouter-aggregate-provider')
    expect(detail.requestBudget).toEqual({ maxRequests: 10, windowSeconds: 60 })
    expect(JSON.stringify(detail)).not.toMatch(/quotaScope|providerId|maxPending|maxWait|rollingWindow|queue/i)
  })

  it.each([
    ['cloudflare html', new Response('<html>blocked</html>', { status: 403, headers: { 'content-type': 'text/html' } })],
    ['successful html', new Response('<html>blocked</html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['unparseable json', new Response('{', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['malformed object', new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })],
    ['empty object', new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })],
    ['wrong envelope status', new Response(JSON.stringify({ code: 500, msg: 'error' }), { status: 200, headers: { 'content-type': 'application/json' } })]
  ])('fails closed for %s 0xRouter probe responses', async (_name, response) => {
    platformFetch.mockResolvedValueOnce(response)
    const service = createService()
    await service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'router-probe-key' })

    await expect(service.testConnection({ sourceId: '0xrouter-aggregate-provider' })).resolves.toEqual({
      sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'response-unavailable'
    })
  })

  it('rejects a response over the fixed 0xRouter body limit before parsing', async () => {
    platformFetch.mockResolvedValueOnce(new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': '262145'
      }
    }))
    const service = createService()
    await service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'router-probe-key' })

    await expect(service.testConnection({ sourceId: '0xrouter-aggregate-provider' })).resolves.toEqual({
      sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'response-unavailable'
    })
  })

  it('does not probe 0xRouter when the credential is missing or unsafe', async () => {
    platformFetch.mockClear()
    const service = createService()
    await expect(service.testConnection({ sourceId: '0xrouter-aggregate-provider' })).resolves.toEqual({
      sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'credential-not-configured'
    })
    await service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'router-probe-key' })
    await service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'router\nprobe-key' })
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('rejects unsafe 0xRouter API key input without replacing an existing masked credential', async () => {
    const service = createService()

    await service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'router-secret' })
    const before = (await service.getDetail('0xrouter-aggregate-provider')).credentialStatus
    await expect(service.testCredentials({ sourceId: '0xrouter-aggregate-provider', credentialDraft: 'router\nsecret' })).resolves.toEqual({
      sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'credential-invalid'
    })
    expect((await service.getDetail('0xrouter-aggregate-provider')).credentialStatus).toEqual(before)
  })

  it('stores a well-shaped Twelve Data key on its profile without spending a probe request', async () => {
    platformFetch.mockClear()
    const service = createService()

    await expect(service.testCredentials({ sourceId: 'twelve-data-market', credentialDraft: TWELVE_DATA_KEY })).resolves.toEqual({
      sourceId: 'twelve-data-market', state: 'unverified'
    })
    const detail = await service.getDetail('twelve-data-market')

    expect(detail.profile.credentialRef).toBe('twelve-data-market-credentials')
    expect(detail.credentialStatus).toMatchObject({ hasCredential: true })
    expect(detail.credentialStatus?.maskedPreview).toContain('****')
    expect(JSON.stringify(detail)).not.toContain(TWELVE_DATA_KEY)
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['too short', '0123456789abcdef'],
    ['not hexadecimal', '0123456789abcdef0123456789abcdeg'],
    ['carrying control characters', `0123456789abcdef\n0123456789abcdef`]
  ])('refuses a %s Twelve Data key without any network request', async (_name, credentialDraft) => {
    platformFetch.mockClear()
    const service = createService()

    await expect(service.testCredentials({ sourceId: 'twelve-data-market', credentialDraft })).resolves.toEqual({
      sourceId: 'twelve-data-market', state: 'failed', failureCode: 'credential-invalid'
    })
    expect(platformFetch).not.toHaveBeenCalled()
    expect((await service.getDetail('twelve-data-market')).profile.credentialRef).toBeUndefined()
  })

  it('probes the Twelve Data usage endpoint with the stored key and its own bounded request', async () => {
    platformFetch.mockClear()
    const service = createService()
    await service.testCredentials({ sourceId: 'twelve-data-market', credentialDraft: TWELVE_DATA_KEY })
    platformFetch.mockResolvedValueOnce(jsonResponse({ plan_category: 'basic', daily_usage: 12, plan_daily_limit: 800 }))

    await expect(service.testConnection({ sourceId: 'twelve-data-market' })).resolves.toEqual({
      sourceId: 'twelve-data-market', state: 'succeeded'
    })
    expect(platformFetch).toHaveBeenCalledWith(
      `https://api.twelvedata.com/api_usage?apikey=${TWELVE_DATA_KEY}`,
      expect.objectContaining({ method: 'GET' })
    )
    expect(platformFetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an invalid key', 401, { code: 401, message: 'Invalid API key' }, 'credential-invalid'],
    ['a plan restriction', 403, { code: 403, message: 'not entitled' }, 'plan-restricted'],
    ['a rate limit', 429, { code: 429, message: 'too many requests' }, 'rate-limited'],
    ['an unrecognized provider error', 500, { code: 500, message: 'provider failure' }, 'response-unavailable'],
    ['an oversized response', 200, { plan_category: 'basic' }, 'response-unavailable']
  ])('reports %s from the Twelve Data probe without calling it a key error', async (_name, status, body, failureCode) => {
    platformFetch.mockClear()
    const service = createService()
    await service.testCredentials({ sourceId: 'twelve-data-market', credentialDraft: TWELVE_DATA_KEY })
    platformFetch.mockResolvedValueOnce(_name === 'an oversized response'
      ? new Response(JSON.stringify(body), { status, headers: { 'content-length': '1048576' } })
      : jsonResponse(body, status))

    await expect(service.testConnection({ sourceId: 'twelve-data-market' })).resolves.toEqual({
      sourceId: 'twelve-data-market', state: 'failed', failureCode
    })
  })

  it('reports a Twelve Data transport failure as unavailable instead of claiming a verified key', async () => {
    platformFetch.mockClear()
    const service = createService()
    await service.testCredentials({ sourceId: 'twelve-data-market', credentialDraft: TWELVE_DATA_KEY })
    platformFetch.mockRejectedValueOnce(new Error('offline'))

    await expect(service.testConnection({ sourceId: 'twelve-data-market' })).resolves.toEqual({
      sourceId: 'twelve-data-market', state: 'failed', failureCode: 'transport-unavailable'
    })
  })

  it('fails a Twelve Data connection before any probe when no key is stored', async () => {
    platformFetch.mockClear()
    const service = createService()

    await expect(service.testConnection({ sourceId: 'twelve-data-market' })).resolves.toEqual({
      sourceId: 'twelve-data-market', state: 'failed', failureCode: 'credential-not-configured'
    })
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('stores a well-shaped real dollar index key and probes every instrument it collects', async () => {
    platformFetch.mockClear()
    const service = createService()

    await expect(service.testCredentials({ sourceId: 'realmarketapi-market', credentialDraft: REAL_MARKET_API_KEY })).resolves.toEqual({
      sourceId: 'realmarketapi-market', state: 'unverified'
    })
    expect(platformFetch).not.toHaveBeenCalled()
    const detail = await service.getDetail('realmarketapi-market')
    expect(detail.profile.credentialRef).toBe('realmarketapi-market-credentials')
    expect(detail.credentialStatus?.maskedPreview).toContain('****')
    expect(JSON.stringify(detail)).not.toContain(REAL_MARKET_API_KEY)

    platformFetch.mockResolvedValueOnce(jsonResponse(realMarketApiPriceResponse))
      .mockResolvedValueOnce(jsonResponse({ ...realMarketApiPriceResponse, symbolCode: 'XAUUSD', closePrice: 4180.5 }))
    await expect(service.testConnection({ sourceId: 'realmarketapi-market' })).resolves.toEqual({
      sourceId: 'realmarketapi-market', state: 'succeeded'
    })
    const probed = platformFetch.mock.calls.map(call => String(call[0]))
    expect(probed[0]).toContain('symbolCode=DXY')
    expect(probed[0]).toContain('timeFrame=H1')
    // Gold rides the same source now, so a key is only good when both instruments answer.
    expect(probed[1]).toContain('symbolCode=XAUUSD')
    expect(platformFetch).toHaveBeenCalledTimes(2)

    // The reader's two switches, through the same service the drawer calls: save the profile, then
    // read the page state the renderer validates.
    await expect(service.saveProfile({ sourceId: 'realmarketapi-market', enabled: true })).resolves.toMatchObject({
      profile: { enabled: true }
    })
    expect((await service.getDetail('realmarketapi-market')).profile.enabled).toBe(true)
    const state = await service.getPageState({ sourceId: 'realmarketapi-market' })
    expect(state.detail?.profile).toMatchObject({ enabled: true, collectionPreset: 'manual' })
    // The product's own five-minute job owns this source, so the generic adapter runtime must schedule
    // nothing for it: a `frequent` rest-api-poller preset would arm a three-minute unadapted collector
    // beside the job that already fetches DXY, and no `realmarketapi-dxy-v1` adapter exists to serve it.
    const schedules: unknown[] = []
    const orchestrator = createSourceRuntimeOrchestrator({
      jobRuntime: { setSchedule: (definition: unknown) => { schedules.push(definition) }, removeSchedule: () => undefined } as never
    })
    const config = resolveRuntimeConfig({
      definition: getIntelligenceSourceDefinition('realmarketapi-market')!,
      profile: (await service.getDetail('realmarketapi-market')).profile,
      hasCredential: true
    })
    expect(config.collectionPreset).toBe('manual')
    orchestrator.reconcile(config)
    expect(schedules).toEqual([])
  })

  it('refuses a malformed real dollar index key without any network request', async () => {
    platformFetch.mockClear()
    const service = createService()

    // The shape rule is a cheap pre-filter, not a claim about the provider's key length: anything with
    // punctuation, whitespace or an implausible length is refused without spending a request. (A
    // 63-character truncation of a valid key is *not* a safe example here — the rule deliberately
    // admits the plausible range, because asserting one exact length refused a real key once.)
    for (const credentialDraft of ['ab12'.repeat(5), 'kRHg'.repeat(12) + '!', `${'kRHg'.repeat(12)} x`]) {
      await expect(service.testCredentials({ sourceId: 'realmarketapi-market', credentialDraft })).resolves.toEqual({
        sourceId: 'realmarketapi-market', state: 'failed', failureCode: 'credential-invalid'
      })
    }
    expect(platformFetch).not.toHaveBeenCalled()
    expect((await service.getDetail('realmarketapi-market')).profile.credentialRef).toBeUndefined()
  })

  it.each([
    ['an invalid key', 401, { message: 'invalid api key' }, 'credential-invalid'],
    ['a plan restriction', 403, { message: 'plan does not include this symbol' }, 'plan-restricted'],
    ['a rate limit', 429, { message: 'rate limit exceeded' }, 'rate-limited']
  ])('reports %s from the real dollar index probe without calling it something else', async (_name, status, body, failureCode) => {
    platformFetch.mockClear()
    const service = createService()
    await service.testCredentials({ sourceId: 'realmarketapi-market', credentialDraft: REAL_MARKET_API_KEY })
    platformFetch.mockResolvedValueOnce(jsonResponse(body, status))

    await expect(service.testConnection({ sourceId: 'realmarketapi-market' })).resolves.toEqual({
      sourceId: 'realmarketapi-market', state: 'failed', failureCode
    })
  })

  it('stores a well-shaped FRED key without spending a probe request', async () => {
    platformFetch.mockClear()
    const service = createService()

    await expect(service.testCredentials({ sourceId: 'fred-rates-liquidity', credentialDraft: FRED_KEY })).resolves.toEqual({
      sourceId: 'fred-rates-liquidity', state: 'unverified'
    })
    const detail = await service.getDetail('fred-rates-liquidity')

    expect(detail.profile.credentialRef).toBe('fred-rates-liquidity-credentials')
    expect(detail.credentialStatus).toMatchObject({ hasCredential: true })
    expect(JSON.stringify(detail)).not.toContain(FRED_KEY)
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['too short', '0123456789abcdef'],
    ['not hexadecimal', '0123456789abcdef0123456789abcdeg'],
    ['carrying control characters', `0123456789abcdef\n0123456789abcdef`]
  ])('refuses a %s FRED key without any network request', async (_name, credentialDraft) => {
    platformFetch.mockClear()
    const service = createService()

    await expect(service.testCredentials({ sourceId: 'fred-rates-liquidity', credentialDraft })).resolves.toEqual({
      sourceId: 'fred-rates-liquidity', state: 'failed', failureCode: 'credential-invalid'
    })
    expect(platformFetch).not.toHaveBeenCalled()
    expect((await service.getDetail('fred-rates-liquidity')).profile.credentialRef).toBeUndefined()
  })

  it('probes the FRED observations endpoint for one DGS10 observation with the stored key', async () => {
    platformFetch.mockClear()
    const service = createService()
    await service.testCredentials({ sourceId: 'fred-rates-liquidity', credentialDraft: FRED_KEY })
    platformFetch.mockResolvedValueOnce(jsonResponse({ observations: [{ date: '2026-10-09', value: '5.24' }] }))

    await expect(service.testConnection({ sourceId: 'fred-rates-liquidity' })).resolves.toEqual({
      sourceId: 'fred-rates-liquidity', state: 'succeeded'
    })
    const [url, init] = platformFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('https://api.stlouisfed.org/fred/series/observations?')
    expect(new URL(url).searchParams.get('series_id')).toBe('DGS10')
    expect(new URL(url).searchParams.get('limit')).toBe('1')
    expect(new URL(url).searchParams.get('file_type')).toBe('json')
    expect(new URL(url).searchParams.get('api_key')).toBe(FRED_KEY)
    expect(init.method).toBe('GET')
    expect(platformFetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an unregistered key', 400, { error_code: 400, error_message: 'Bad Request. The value for variable api_key is not registered to your account.' }, 'credential-invalid'],
    ['a refused key', 401, { error_code: 401, error_message: 'Unauthorized' }, 'credential-invalid'],
    ['a plan restriction', 403, { error_code: 403, error_message: 'Forbidden' }, 'plan-restricted'],
    ['a rate limit', 429, { error_code: 429, error_message: 'Too Many Requests' }, 'rate-limited'],
    ['an unrecognized provider error', 500, { error_code: 500, error_message: 'provider failure' }, 'response-unavailable'],
    // A 400 that never named the key is this product's own malformed request, not the reader's key.
    ['a malformed request that never named the key', 400, { error_code: 400, error_message: 'Bad Request. The value for variable series_id is not valid.' }, 'response-unavailable']
  ])('reports %s from the FRED probe without calling it a store outage', async (_name, status, body, failureCode) => {
    platformFetch.mockClear()
    const service = createService()
    await service.testCredentials({ sourceId: 'fred-rates-liquidity', credentialDraft: FRED_KEY })
    platformFetch.mockResolvedValueOnce(jsonResponse(body, status))

    await expect(service.testConnection({ sourceId: 'fred-rates-liquidity' })).resolves.toEqual({
      sourceId: 'fred-rates-liquidity', state: 'failed', failureCode
    })
  })

  it('reports a FRED transport failure as unavailable instead of claiming a verified key', async () => {
    platformFetch.mockClear()
    const service = createService()
    await service.testCredentials({ sourceId: 'fred-rates-liquidity', credentialDraft: FRED_KEY })
    platformFetch.mockRejectedValueOnce(new Error('offline'))

    await expect(service.testConnection({ sourceId: 'fred-rates-liquidity' })).resolves.toEqual({
      sourceId: 'fred-rates-liquidity', state: 'failed', failureCode: 'transport-unavailable'
    })
  })

  it('fails a FRED connection before any probe when no key is stored', async () => {
    platformFetch.mockClear()
    const service = createService()

    await expect(service.testConnection({ sourceId: 'fred-rates-liquidity' })).resolves.toEqual({
      sourceId: 'fred-rates-liquidity', state: 'failed', failureCode: 'credential-not-configured'
    })
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('lets the reader enable FRED, and schedules nothing until a key exists', async () => {
    const jobRuntime = createJobRuntime()
    const pipeline = createIntelligencePipeline()
    registerIntelligenceJobs(jobRuntime, { pipeline })
    const setSchedule = vi.spyOn(jobRuntime, 'setSchedule')
    const service = createService(jobRuntime, [], undefined, pipeline)

    // `readiness: 'live'` is what admits the enable switch; the credential is what admits the job.
    await expect(service.saveProfile({ sourceId: 'fred-rates-liquidity', enabled: true })).resolves.toMatchObject({
      profile: { enabled: true }
    })
    expect(resolveRuntimeConfig({
      definition: getIntelligenceSourceDefinition('fred-rates-liquidity')!,
      profile: (await service.getDetail('fred-rates-liquidity')).profile,
      hasCredential: false
    })).toMatchObject({ enabled: true, credentialRef: undefined })
    expect(setSchedule).not.toHaveBeenCalled()

    await service.testCredentials({ sourceId: 'fred-rates-liquidity', credentialDraft: FRED_KEY })
    expect(setSchedule).toHaveBeenCalled()
  })

  it('stores the product-owned enable preference while the generic runtime still never schedules it', async () => {
    const jobRuntime = createJobRuntime()
    const pipeline = createIntelligencePipeline()
    registerIntelligenceJobs(jobRuntime, { pipeline })
    const setSchedule = vi.spyOn(jobRuntime, 'setSchedule')
    const service = createService(jobRuntime, [], undefined, pipeline)

    expect((await service.getDetail('twelve-data-market')).profile.enabled).toBe(false)
    await service.testCredentials({ sourceId: 'twelve-data-market', credentialDraft: TWELVE_DATA_KEY })
    await expect(service.saveProfile({ sourceId: 'twelve-data-market', enabled: true })).resolves.toMatchObject({
      profile: { enabled: true }
    })

    // The dedicated macro-market job reads this back through the profile.
    const detail = await service.getDetail('twelve-data-market')
    expect(detail.profile.enabled).toBe(true)
    // `readiness: 'planned'` still forces the generic runtime off, so nothing was scheduled and the
    // unadapted `rest-api-poller` collect job does not even exist for this source.
    expect(resolveRuntimeConfig({
      definition: getIntelligenceSourceDefinition('twelve-data-market')!,
      profile: detail.profile,
      hasCredential: true
    }).enabled).toBe(false)
    expect(setSchedule).not.toHaveBeenCalled()
    await expect(jobRuntime.enqueueManual(intelligenceCollectJobId('twelve-data-market'))).rejects.toThrow('Unknown job definition')
    expect(jobRuntime.listRecentRuns()).toEqual([])
  })

  it('still refuses to enable a planned source that no product job collects', async () => {
    const service = createService()

    // The Treasury dataset is still planned (its configured paths answer 404 and its declared value
    // field reads "null" in the real response), so the ready-for-collection gate must still refuse it.
    await expect(service.saveProfile({ sourceId: 'treasury-fiscal-data', enabled: true })).rejects.toThrow(
      'not ready for production collection'
    )
    await expect(service.saveProfile({ sourceId: 'twelve-data-market', enabled: true })).resolves.toMatchObject({
      profile: { enabled: true }
    })
  })

  it('enables a zero-credential live source without asking for a key', async () => {
    const service = createService()

    // OKX is lit: there is no credential to store, and the enable is what arms the generic poller.
    const detail = await service.saveProfile({ sourceId: 'okx-latest-announcements', enabled: true })
    expect(detail.profile.enabled).toBe(true)
    expect(detail.profile.credentialRef).toBeUndefined()
    expect(detail.runtimeConfig.enabled).toBe(true)
    expect(detail.runtimeConfig.pollingIntervalSec).toBe(30 * 60)
  })

  it('returns a safe page state for pending and product-owned dashboard sources', async () => {
    const service = createService()

    const state = await service.getPageState({ sourceId: 'twelve-data-market' })
    expect(state.detail?.profile).toMatchObject({ enabled: false, collectionPreset: 'frequent' })
    const router = await service.getPageState({ sourceId: '0xrouter-aggregate-provider' })
    expect(router.detail?.definition.sourceId).toBe('0xrouter-aggregate-provider')
  })

  it('fails an unconfigured 0xRouter connection before any probe', async () => {
    const service = createService()
    await expect(service.testConnection({ sourceId: '0xrouter-aggregate-provider' })).resolves.toEqual({
      sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'credential-not-configured'
    })
  })

  it('schedules interval jobs for balanced polling sources and removes them when disabled', async () => {
    const jobRuntime = createJobRuntime()
    registerIntelligenceJobs(jobRuntime, { pipeline: createIntelligencePipeline() })
    const service = createService(jobRuntime)

    await service.saveProfile({ sourceId: 'coindesk-rss', enabled: true, collectionPreset: 'balanced' })
    await expect(jobRuntime.enqueueManual(intelligenceCollectJobId('coindesk-rss'))).resolves.toBeTruthy()
    expect(jobRuntime.listRecentRuns(1)[0]?.handlerId).toBe('market-intelligence.collectSource')

    await service.saveProfile({ sourceId: 'coindesk-rss', enabled: false, collectionPreset: 'balanced' })
    await expect(jobRuntime.enqueueManual(intelligenceCollectJobId('coindesk-rss'))).rejects.toThrow(
      'Unknown job definition'
    )
  })

  it.each(['balanced', 'frequent'] as const)('routes saved enabled stablecoin %s collection through the dedicated refresh handler', async (collectionPreset) => {
    const jobRuntime = createJobRuntime()
    const pipeline = createIntelligencePipeline()
    const collectSource = vi.spyOn(pipeline, 'collectSource')
    const capitalRefresh = vi.fn(async () => ({ state: 'updated' as const }))
    registerIntelligenceJobs(jobRuntime, { pipeline, capitalConditions: { refresh: capitalRefresh } })
    const service = createService(jobRuntime, [], undefined, pipeline)

    await service.saveProfile({ sourceId: 'defillama-stablecoins', enabled: true, collectionPreset })

    await vi.waitFor(() => expect(capitalRefresh).toHaveBeenCalledOnce())
    expect(collectSource).not.toHaveBeenCalled()
    expect(jobRuntime.listRecentRuns(1)[0]?.handlerId).toBe('market-intelligence.collectSource')
  })

  it('does not automatically collect stablecoins when disabled or manual', async () => {
    const jobRuntime = createJobRuntime()
    const pipeline = createIntelligencePipeline()
    const collectSource = vi.spyOn(pipeline, 'collectSource')
    const capitalRefresh = vi.fn(async () => ({ state: 'updated' as const }))
    registerIntelligenceJobs(jobRuntime, { pipeline, capitalConditions: { refresh: capitalRefresh } })
    const service = createService(jobRuntime, [], undefined, pipeline)

    await service.saveProfile({ sourceId: 'defillama-stablecoins', enabled: false, collectionPreset: 'balanced' })
    await service.saveProfile({ sourceId: 'defillama-stablecoins', enabled: true, collectionPreset: 'manual' })

    expect(capitalRefresh).not.toHaveBeenCalled()
    expect(collectSource).not.toHaveBeenCalled()
    expect(jobRuntime.listRecentRuns()).toEqual([])
  })

  it('does not schedule or enqueue a manual preset source when enabled, while explicit Run now remains available', async () => {
    const jobRuntime = createJobRuntime()
    registerIntelligenceJobs(jobRuntime, { pipeline: createIntelligencePipeline() })
    const service = createService(jobRuntime)

    await service.saveProfile({ sourceId: 'ethereum-foundation-blog', enabled: true, collectionPreset: 'manual' })
    expect(jobRuntime.listRecentRuns(1)).toEqual([])
    await expect(jobRuntime.enqueueManual(intelligenceCollectJobId('ethereum-foundation-blog'))).rejects.toThrow('Unknown job definition')

    const result = await service.runNow({ sourceId: 'ethereum-foundation-blog' })
    expect(result.action).toBe('queued-job')
  })

  it('does not schedule or enqueue an enabled Dashboard source with the manual task rule', async () => {
    const jobRuntime = createJobRuntime()
    registerIntelligenceJobs(jobRuntime, { pipeline: createIntelligencePipeline() })
    const service = createService(jobRuntime)

    await service.saveProfile({ sourceId: 'alternative-fear-greed', enabled: true, collectionPreset: 'manual' })

    expect(jobRuntime.listRecentRuns(1)).toEqual([])
    await expect(jobRuntime.enqueueManual(intelligenceCollectJobId('alternative-fear-greed'))).rejects.toThrow('Unknown job definition')
    expect((await service.getPageState({ sourceId: 'alternative-fear-greed' })).detail?.scheduleRule).toEqual({ mode: 'manual' })
  })

  it('rejects stablecoin replay before invoking the replay service', async () => {
    const replayService = { queueReplayWindow: vi.fn() }
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const service = createIntelligenceSourcesService({
      profileStore, pipeline: createIntelligencePipeline({ profileStore }), jobRuntime: createJobRuntime(), replayService: replayService as never
    })

    await expect(service.replayWindow({ sourceId: 'defillama-stablecoins' })).resolves.toMatchObject({ summary: 'Replay is unavailable.' })
    expect(replayService.queueReplayWindow).not.toHaveBeenCalled()
  })

  it('projects stablecoin health without reading generic pipeline health', async () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    await profileStore.saveProfile({ sourceId: 'defillama-stablecoins', enabled: true })
    const pipeline = createIntelligencePipeline({ profileStore })
    const getPipelineHealth = vi.spyOn(pipeline, 'getHealth')
    const service = createIntelligenceSourcesService({
      profileStore,
      pipeline,
      jobRuntime: createJobRuntime(),
      capitalConditions: {
        probe: async () => ({ ok: true }),
        getHealth: async () => ({
          runtimeStatus: 'degraded' as const,
          lastSuccessAt: '2026-08-18T00:00:00.000Z',
          consecutiveFailures: 2
        })
      }
    })

    await expect(service.getHealth({ sourceId: 'defillama-stablecoins' })).resolves.toEqual({
      sourceId: 'defillama-stablecoins',
      runtimeStatus: 'degraded',
      connectivityStatus: 'degraded',
      lastSuccessAt: '2026-08-18T00:00:00.000Z',
      consecutiveFailures: 2
    })
    expect(getPipelineHealth).not.toHaveBeenCalled()
  })
})

function createService(
  jobRuntime = createJobRuntime(),
  profiles: IntelligenceSourceProfile[] = [],
  profileStoreOverride?: SourceProfileStore,
  pipelineOverride?: ReturnType<typeof createIntelligencePipeline>,
  validateCredential?: (input: { sourceId: string; apiKey: string }) => Promise<{ ok: boolean; message: string }>,
  requestGovernanceQueue: ReturnType<typeof createSourceRequestGovernanceQueue> | null = createSourceRequestGovernanceQueue({ now: () => Date.now() })
) {
  const profileStore = profileStoreOverride ?? createSourceProfileStore(createInMemoryProfileStorage(profiles))
  const focusSettingsStore = createIntelligenceFocusSettingsStore(createInMemoryFocusSettingsStorage())
  return createIntelligenceSourcesService({
    profileStore,
    focusSettingsStore,
    pipeline: pipelineOverride ?? createIntelligencePipeline({ profileStore }),
    jobRuntime,
    workerRuntime: createManagedWorkerRuntime(),
    credentialStore: createIntelligenceCredentialStore(createInMemoryIntelligenceCredentialStorage()),
    validateCredential: validateCredential ?? (async () => ({ ok: true, message: 'Credential verified with provider.' })),
    requestGovernanceQueue: requestGovernanceQueue ?? undefined
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

/** Twelve Data issues a 32-character hexadecimal key. */
const TWELVE_DATA_KEY = '0123456789abcdef0123456789abcdef'

/** FRED issues a 32-character hexadecimal key as well; this one is deliberately a different string. */
const FRED_KEY = 'fedcba9876543210fedcba9876543210'

/** The real dollar index issues 64 alphanumeric characters. Not the reader's key, and never printed. */
const REAL_MARKET_API_KEY = 'ab12'.repeat(16)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
