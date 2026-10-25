import { describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'
import type { ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

const fixtures = vi.hoisted(() => {
  const profile = {
    profileId: 'profile-internal-1',
    sourceId: 'fred-rates-liquidity',
    enabled: true,
    credentialRef: 'credential-internal-ref',
    collectionPreset: 'balanced',
    includeInSentiment: true,
    scopePolicy: 'watchlist-priority',
    rawArchiveEnabled: true,
    retentionMode: 'balanced',
    autoReplayAfterParserUpgrade: false,
    sourceSpecificConfigJson: '{"apiKey":"placeholder-value"}',
    updatedAt: '2026-10-01T00:00:00.000Z'
  }
  const definition = {
    sourceId: 'fred-rates-liquidity',
    displayName: 'FRED rates & liquidity',
    sourceGroup: 'official-source',
    category: 'macro',
    visibility: 'visible',
    authMode: 'api-key',
    sourceSpecificFields: ['apiKey'],
    readinessNote: 'Reads the official daily series.'
  }
  return {
    profile,
    definition,
    sourcesService: {
      listDefinitions: () => [definition],
      listProfiles: async () => [profile],
      getFocusSettings: async () => ({
        enabledFocusMarkets: ['digital-assets'],
        updatedAt: '2026-10-01T00:00:00.000Z'
      }),
      getDetail: async (sourceId: string) => ({
        definition,
        profile: { ...profile, sourceId },
        runtimeConfig: {
          desiredRuntimeState: 'polling',
          pollingIntervalSec: 600
        },
        scheduleRule: {
          mode: 'interval',
          intervalSeconds: 600,
          anchor: 'last-complete',
          initialRunOnEnable: true
        },
        health: {
          sourceId,
          runtimeStatus: 'healthy',
          connectivityStatus: 'connected',
          workerStatus: 'live',
          lastSuccessAt: '2026-10-02T00:00:00.000Z',
          consecutiveFailures: 0,
          lastRunSummary: 'internal run summary',
          checkpointPreview: 'internal checkpoint',
          collectionGap: false
        },
        credentialStatus: {
          hasCredential: true,
          maskedPreview: 'sk-masked-preview',
          lastValidatedAt: '2026-10-02T00:00:00.000Z'
        }
      })
    }
  }
})

vi.mock('../intelligenceModule', () => ({
  getIntelligenceModule: () => ({ sourcesService: fixtures.sourcesService })
}))
vi.mock('../ipc/registerIntelligenceIpc', () => ({
  getIntelligenceService: () => ({})
}))

const { registerIntelligenceAgentToolHandlers } = await import('./handlerRegistry')
const { ProductToolGuardError } = await import('./capabilityTypes')

const jobRuntime = {} as JobRuntime
const context = {
  toolCallId: 'tool-call-1',
  productId: 'market-intelligence',
  toolName: 'test',
  schemaVersion: 1,
  agentId: 'crypto-market-analyst',
  agentSessionId: 'session-1',
  signal: new AbortController().signal,
  log: async () => undefined
}

function registrations(): Map<string, ProductAgentToolHandlerRegistration> {
  const collected = new Map<string, ProductAgentToolHandlerRegistration>()
  registerIntelligenceAgentToolHandlers(
    (registration) => collected.set(registration.handlerId, registration),
    { jobRuntime, getAppLanguage: async () => 'zh-CN', macroCalendarOps: {} as never, crossAssetOps: {} as never }
  )
  return collected
}

describe('source-capability handlers', () => {
  it('lists sources without any credential or free-form profile material', async () => {
    const handler = registrations().get('market-intelligence.list-intelligence-sources')
    const result = (await handler!.handle({ includeDisabled: true }, context)) as {
      state: string
      sources: Array<{ credentialStatus: { hasCredential: boolean }; domains: string[] }>
    }
    const serialized = JSON.stringify(result)

    expect(result.state).toBe('available')
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].credentialStatus).toEqual({ hasCredential: true })
    expect(serialized).not.toContain('credentialRef')
    expect(serialized).not.toContain('sourceSpecificConfigJson')
    expect(serialized).not.toContain('maskedPreview')
    expect(serialized).not.toContain('profileId')
    expect(serialized).not.toContain('placeholder-value')
  })

  it('projects source detail with health and runtime and keeps credentials out', async () => {
    const handler = registrations().get('market-intelligence.get-source-detail')
    const result = (await handler!.handle({ sourceId: 'fred-rates-liquidity' }, context)) as {
      state: string
      source: {
        credentialStatus: { hasCredential: boolean; lastValidatedAt?: string }
        health: Record<string, unknown>
        runtime: Record<string, unknown>
      }
    }
    const serialized = JSON.stringify(result)

    expect(result.state).toBe('available')
    expect(result.source.credentialStatus).toEqual({
      hasCredential: true,
      lastValidatedAt: '2026-10-02T00:00:00.000Z'
    })
    expect(result.source.health).toEqual({
      runtimeStatus: 'healthy',
      connectivityStatus: 'connected',
      lastSuccessAt: '2026-10-02T00:00:00.000Z',
      consecutiveFailures: 0,
      collectionGap: false
    })
    expect(Object.keys(result.source.health).sort()).toEqual([
      'collectionGap',
      'connectivityStatus',
      'consecutiveFailures',
      'lastSuccessAt',
      'runtimeStatus'
    ])
    expect(result.source.runtime).toEqual({
      desiredState: 'polling',
      pollingIntervalSec: 600,
      schedule: { mode: 'interval', intervalSeconds: 600 }
    })
    expect(Object.keys(result.source.runtime).sort()).toEqual([
      'desiredState',
      'pollingIntervalSec',
      'schedule'
    ])
    expect(serialized).not.toContain('credentialRef')
    expect(serialized).not.toContain('sourceSpecificConfigJson')
    expect(serialized).not.toContain('maskedPreview')
    expect(serialized).not.toContain('profileId')
    expect(serialized).not.toContain('placeholder-value')
    expect(serialized).not.toContain('workerStatus')
    expect(serialized).not.toContain('lastRunSummary')
  })

  it('answers an unknown source id with unavailable instead of throwing', async () => {
    const handler = registrations().get('market-intelligence.get-source-detail')
    const result = (await handler!.handle({ sourceId: 'not-a-source' }, context)) as { state: string }

    expect(result.state).toBe('unavailable')
  })

  it('does not reach the service when the input guard rejects the call', async () => {
    const handler = registrations().get('market-intelligence.get-source-detail')
    const error = await handler!.handle({ sourceId: 'fred-rates-liquidity', extra: true }, context).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(ProductToolGuardError)
    expect((error as InstanceType<typeof ProductToolGuardError>).code).toBe('unexpected-property')
  })
})
