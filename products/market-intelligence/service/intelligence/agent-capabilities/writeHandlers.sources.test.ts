import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'
import type { ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

import { createAgentChangeLog, type AgentChangeLog } from './changeLog'

const fixture = vi.hoisted(() => {
  const profile = (overrides: Record<string, unknown> = {}) => ({
    profileId: 'profile-1',
    sourceId: 'coingecko-trending',
    enabled: true,
    collectionPreset: 'balanced',
    includeInSentiment: true,
    scopePolicy: 'all',
    rawArchiveEnabled: false,
    retentionMode: 'balanced',
    autoReplayAfterParserUpgrade: false,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides
  })

  return {
    profiles: [profile()],
    focusMarkets: ['digital-assets'],
    definitions: [
      { sourceId: 'coingecko-trending', displayName: 'Trending', authMode: 'none', sourceSpecificFields: [] },
      { sourceId: 'fred-rates-liquidity', displayName: 'FRED', authMode: 'api-key', sourceSpecificFields: ['apiKey'] },
      { sourceId: 'optional-key-source', displayName: 'Optional', authMode: 'optional-api-key', sourceSpecificFields: ['apiKey'] }
    ],
    saves: [] as unknown[],
    enables: [] as unknown[],
    focusSaves: [] as unknown[],
    runNows: [] as unknown[],
    connections: [] as unknown[],
    retries: [] as unknown[],
    profile,
    reset() {
      this.profiles = [profile()]
      this.focusMarkets = ['digital-assets']
      this.saves = []
      this.enables = []
      this.focusSaves = []
      this.runNows = []
      this.connections = []
      this.retries = []
    }
  }
})

vi.mock('../intelligenceModule', () => ({
  getIntelligenceModule: () => ({
    sourcesService: {
      listDefinitions: () => fixture.definitions,
      listProfiles: async () => fixture.profiles.map((profile) => ({ ...profile })),
      getFocusSettings: async () => ({
        enabledFocusMarkets: [...fixture.focusMarkets],
        updatedAt: '2026-10-01T00:00:00.000Z'
      }),
      saveProfile: async (input: Record<string, unknown>) => {
        fixture.saves.push(input)
        const current = fixture.profiles.find((profile) => profile.sourceId === input.sourceId)
        if (!current) throw new Error('unknown-source')
        const next = {
          ...current,
          ...input,
          updatedAt: '2026-10-02T00:00:00.000Z'
        }
        fixture.profiles = fixture.profiles.map((profile) =>
          profile.sourceId === input.sourceId ? next : profile
        )
        return { profile: next }
      },
      setEnabled: async (input: Record<string, unknown>) => {
        fixture.enables.push(input)
        const next = {
          ...fixture.profile(),
          sourceId: input.sourceId,
          enabled: input.enabled,
          updatedAt: '2026-10-02T00:00:00.000Z'
        }
        fixture.profiles = fixture.profiles.map((profile) =>
          profile.sourceId === input.sourceId ? next : profile
        )
        return { profile: next }
      },
      saveFocusSettings: async (input: { enabledFocusMarkets: string[] }) => {
        fixture.focusSaves.push(input)
        fixture.focusMarkets = [...input.enabledFocusMarkets]
        return { enabledFocusMarkets: [...input.enabledFocusMarkets], updatedAt: '2026-10-02T00:00:00.000Z' }
      },
      runNow: async (input: { sourceId: string }) => {
        fixture.runNows.push(input)
        return { sourceId: input.sourceId, action: 'queued-job', queuedAt: '2026-10-02T00:00:00.000Z' }
      },
      testConnection: async (input: { sourceId: string }) => {
        fixture.connections.push(input)
        return { sourceId: input.sourceId, ok: true, message: 'ok', testedAt: '2026-10-02T00:00:00.000Z' }
      }
    }
  }),
  getIntelligenceProductDataDir: () => '/tmp/market-intelligence-test'
}))

vi.mock('../ipc/registerIntelligenceIpc', () => ({
  getIntelligenceService: () => ({
    retryItemAssessment: async (input: { itemId: string }) => {
      fixture.retries.push(input)
      return { assessmentCount: 1, failedCount: 0 }
    }
  })
}))

const { registerIntelligenceAgentToolHandlers } = await import('./handlerRegistry')
const { ProductToolGuardError } = await import('./capabilityTypes')

const jobRuntime = {} as JobRuntime

type LogEntry = { level: string; message: string; details?: Record<string, unknown> }

let changeLog: AgentChangeLog | undefined
let dataDir: string
let logEntries: LogEntry[]
let context: {
  toolCallId: string
  productId: string
  toolName: string
  schemaVersion: number
  agentId: string
  agentSessionId: string
  signal: AbortSignal
  log: (entry: LogEntry) => Promise<void>
}

beforeEach(() => {
  fixture.reset()
  dataDir = mkdtempSync(join(tmpdir(), 'mi-agent-write-'))
  changeLog = createAgentChangeLog(join(dataDir, 'agent-change-log.sqlite'))
  logEntries = []
  context = {
    toolCallId: 'tool-call-1',
    productId: 'market-intelligence',
    toolName: 'test',
    schemaVersion: 1,
    agentId: 'crypto-market-analyst',
    agentSessionId: 'session-1',
    signal: new AbortController().signal,
    log: async (entry: LogEntry) => {
      logEntries.push(entry)
    }
  }
})

afterEach(() => {
  try {
    changeLog?.close()
  } catch {
    // A test that closed the log to force an append failure has already released it.
  }
  rmSync(dataDir, { recursive: true, force: true })
})

function registrations(): Map<string, ProductAgentToolHandlerRegistration> {
  const collected = new Map<string, ProductAgentToolHandlerRegistration>()
  registerIntelligenceAgentToolHandlers(
    (registration) => collected.set(registration.handlerId, registration),
    {
      jobRuntime,
      changeLog,
      macroCalendarOps: {} as never,
      crossAssetOps: {} as never
    }
  )
  return collected
}

function handler(id: string) {
  const registration = registrations().get(`market-intelligence.${id}`)
  if (!registration) throw new Error(`Missing handler: ${id}`)
  return registration.handle
}

describe('source configuration write handlers', () => {
  it('saves a profile patch without enabled or credential fields and reports the changed settings', async () => {
    const result = (await handler('configure-intelligence-source')(
      {
        action: 'save-profile',
        sourceId: 'coingecko-trending',
        collectionPreset: 'frequent',
        monitoredSymbols: ['BTCUSDT']
      },
      context
    )) as {
      state: string
      sourceId: string
      revisionBefore: string
      revisionAfter: string
      changed: Record<string, { before: unknown; after: unknown }>
    }

    expect(fixture.saves).toEqual([
      { sourceId: 'coingecko-trending', collectionPreset: 'frequent', monitoredSymbols: ['BTCUSDT'] }
    ])
    expect(result.state).toBe('saved')
    expect(result.sourceId).toBe('coingecko-trending')
    expect(result.changed).toEqual({
      collectionPreset: { before: 'balanced', after: 'frequent' },
      monitoredSymbols: { before: null, after: ['BTCUSDT'] }
    })
    expect(result.revisionBefore).not.toBe(result.revisionAfter)
  })

  it('enables a source through setEnabled and records the flag change', async () => {
    fixture.profiles = [fixture.profile({ enabled: false })]

    const result = (await handler('configure-intelligence-source')(
      { action: 'set-enabled', sourceId: 'coingecko-trending', enabled: true },
      context
    )) as { changed: Record<string, { before: unknown; after: unknown }> }

    expect(fixture.enables).toEqual([{ sourceId: 'coingecko-trending', enabled: true }])
    expect(result.changed).toEqual({ enabled: { before: false, after: true } })
  })

  it('saves focus markets through saveFocusSettings', async () => {
    const result = (await handler('configure-intelligence-source')(
      { action: 'save-focus-markets', enabledFocusMarkets: ['digital-assets', 'fx'] },
      context
    )) as { state: string; changed: Record<string, { before: unknown; after: unknown }> }

    expect(fixture.focusSaves).toEqual([{ enabledFocusMarkets: ['digital-assets', 'fx'] }])
    expect(result.changed).toEqual({
      enabledFocusMarkets: { before: ['digital-assets'], after: ['digital-assets', 'fx'] }
    })
  })

  it('writes one audit row per successful configuration change with before, after, and both revisions', async () => {
    const result = (await handler('configure-intelligence-source')(
      { action: 'set-enabled', sourceId: 'coingecko-trending', enabled: false },
      context
    )) as { revisionBefore: string; revisionAfter: string }

    const rows = changeLog!.listRecent({})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      traceId: 'tool-call-1',
      agentId: 'crypto-market-analyst',
      agentSessionId: 'session-1',
      domain: 'source-config',
      action: 'set-enabled',
      sourceId: 'coingecko-trending',
      revisionBefore: result.revisionBefore,
      revisionAfter: result.revisionAfter
    })
    expect(rows[0]!.before).toMatchObject({ enabled: true, sourceId: 'coingecko-trending' })
    expect(rows[0]!.after).toMatchObject({ enabled: false, sourceId: 'coingecko-trending' })
    expect(rows[0]!.changeSummary).toContain('enabled')
  })

  it('keeps the successful result and reports auditFailed when the change log cannot record it', async () => {
    changeLog!.close()

    const result = (await handler('configure-intelligence-source')(
      { action: 'set-enabled', sourceId: 'coingecko-trending', enabled: false },
      context
    )) as { state: string; auditFailed?: boolean }

    expect(result.state).toBe('saved')
    expect(result.auditFailed).toBe(true)
    expect(fixture.enables).toHaveLength(1)
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0]!.level).toBe('warn')
    expect(logEntries[0]!.message).not.toContain('coingecko-trending')
    expect(logEntries[0]!.details).toBeUndefined()
  })
})

describe('source operation write handlers', () => {
  it('runs a source now and records an execution without configuration change', async () => {
    const result = (await handler('operate-intelligence-source')(
      { action: 'run-now', sourceId: 'coingecko-trending' },
      context
    )) as {
      sourceId: string
      action: string
      queuedAt: string
      revisionBefore: string
      revisionAfter: string
      changed: Record<string, unknown>
    }

    expect(fixture.runNows).toEqual([{ sourceId: 'coingecko-trending' }])
    expect(result.sourceId).toBe('coingecko-trending')
    expect(result.action).toBe('queued-job')
    expect(result.revisionBefore).toBe(result.revisionAfter)
    expect(result.changed).toEqual({})
    const rows = changeLog!.listRecent({})
    expect(rows).toHaveLength(1)
    expect(rows[0]!.changeSummary).toContain('no configuration change')
  })

  it('tests a connection and retries one assessment through the intelligence service', async () => {
    const connection = (await handler('operate-intelligence-source')(
      { action: 'test-connection', sourceId: 'coingecko-trending' },
      context
    )) as { ok: boolean; sourceId: string }
    expect(fixture.connections).toEqual([{ sourceId: 'coingecko-trending' }])
    expect(connection.ok).toBe(true)
    expect(connection.sourceId).toBe('coingecko-trending')

    const retried = (await handler('operate-intelligence-source')(
      { action: 'retry-assessment', itemId: 'item-1' },
      context
    )) as { assessmentCount: number; itemId: string }
    expect(fixture.retries).toEqual([{ itemId: 'item-1' }])
    expect(retried.assessmentCount).toBe(1)
    expect(retried.itemId).toBe('item-1')
    expect(changeLog!.listRecent({})).toHaveLength(2)
  })

  it('rejects an action whose required target is missing', async () => {
    const error = await handler('operate-intelligence-source')(
      { action: 'run-now' },
      context
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProductToolGuardError)
    expect((error as InstanceType<typeof ProductToolGuardError>).code).toBe('missing-property')
    expect(fixture.runNows).toHaveLength(0)
  })
})

describe('credential handoff', () => {
  it('returns only the settings entry point and the field names for a credential source', async () => {
    const result = (await handler('request-source-credential')(
      { sourceId: 'fred-rates-liquidity' },
      context
    )) as { handoff: string; sourceId: string; settingsSectionId: string; fields: string[] }
    const serialized = JSON.stringify(result)

    expect(result).toEqual({
      handoff: 'credential-entry',
      sourceId: 'fred-rates-liquidity',
      settingsSectionId: 'intelligence-sources',
      fields: ['apiKey']
    })
    expect(serialized).not.toContain('maskedPreview')
    expect(serialized).not.toContain('credentialRef')
    expect(serialized).not.toContain('lastValidatedAt')
    expect(serialized).not.toContain('secret-value')
  })

  it('reports no fields for a source that needs no credential', async () => {
    const result = (await handler('request-source-credential')(
      { sourceId: 'coingecko-trending' },
      context
    )) as { fields: string[] }

    expect(result.fields).toEqual([])
  })

  it('reports no required fields for an optional credential source', async () => {
    const result = (await handler('request-source-credential')(
      { sourceId: 'optional-key-source' },
      context
    )) as { fields: string[] }

    expect(result.fields).toEqual([])
  })

  it('rejects an unknown source instead of inventing a handoff target', async () => {
    const error = await handler('request-source-credential')(
      { sourceId: 'not-a-source' },
      context
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProductToolGuardError)
  })
})
