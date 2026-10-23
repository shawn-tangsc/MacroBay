import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'
import type { ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

import { createAgentChangeLog, type AgentChangeLog } from './changeLog'

const fixture = vi.hoisted(() => ({
  profiles: [
    {
      profileId: 'profile-1',
      sourceId: 'coingecko-trending',
      enabled: true,
      collectionPreset: 'balanced',
      includeInSentiment: true,
      scopePolicy: 'all',
      rawArchiveEnabled: false,
      retentionMode: 'balanced',
      autoReplayAfterParserUpgrade: false,
      updatedAt: '2026-10-01T00:00:00.000Z'
    }
  ],
  focusMarkets: ['digital-assets'],
  settings: {
    autoTranslateEnabled: false,
    targetLocale: 'follow-app',
    providerId: undefined as string | undefined,
    modelId: undefined as string | undefined,
    translateTitle: false,
    translateSummary: false,
    translateEvidenceExcerpt: false,
    updatedAt: '2026-10-01T00:00:00.000Z'
  },
  saveSettingsCalls: [] as unknown[],
  queueMissingCalls: [] as unknown[],
  retryFailedCalls: [] as unknown[],
  calendar: {
    saveProviderProfile: [] as unknown[],
    runProviderNow: [] as unknown[],
    testProviderConnection: [] as unknown[],
    setReleaseTime: [] as unknown[],
    clearReleaseTime: [] as unknown[],
    refreshBlsEmployment: [] as unknown[],
    refreshFedFomc: [] as unknown[],
    syncBlsSchedule: [] as unknown[],
    previewManualIcs: [] as unknown[],
    importManualIcs: [] as unknown[]
  },
  crossAsset: {
    acquire: [] as unknown[],
    renew: [] as unknown[],
    release: [] as unknown[],
    refresh: [] as unknown[],
    testInterface: [] as unknown[],
    cancelInterfaceTest: [] as unknown[]
  }
}))

vi.mock('../intelligenceModule', () => ({
  getIntelligenceModule: () => ({
    sourcesService: {
      listDefinitions: () => [],
      listProfiles: async () => fixture.profiles.map((profile) => ({ ...profile })),
      getFocusSettings: async () => ({
        enabledFocusMarkets: [...fixture.focusMarkets],
        updatedAt: '2026-10-01T00:00:00.000Z'
      })
    },
    translationService: {
      getSettings: async () => ({
        ...fixture.settings,
        resolvedTargetLocale: 'zh-CN',
        defaultModelId: ''
      }),
      saveSettings: async (patch: Record<string, unknown>) => {
        fixture.saveSettingsCalls.push(patch)
        fixture.settings = { ...fixture.settings, ...patch }
        return { ...fixture.settings, resolvedTargetLocale: 'zh-CN', defaultModelId: '' }
      },
      queueMissing: async (input: Record<string, unknown>) => {
        fixture.queueMissingCalls.push(input)
        return { queuedAt: '2026-10-02T00:00:00.000Z', queuedCount: 1, reason: input.reason }
      },
      retryFailed: async (input: Record<string, unknown>) => {
        fixture.retryFailedCalls.push(input)
        return { queuedAt: '2026-10-02T00:00:00.000Z', queuedCount: 1, reason: 'retry-failed' }
      }
    }
  }),
  getIntelligenceProductDataDir: () => '/tmp/market-intelligence-test'
}))

vi.mock('../ipc/registerIntelligenceIpc', () => ({
  getIntelligenceService: () => ({
    retryItemAssessment: async () => ({ assessmentCount: 0, failedCount: 0 })
  })
}))

const { registerIntelligenceAgentToolHandlers } = await import('./handlerRegistry')
const { ProductToolGuardError } = await import('./capabilityTypes')

const jobRuntime = {} as JobRuntime

type LogEntry = { level: string; message: string }

let changeLog: AgentChangeLog | undefined
let dataDir: string
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

function resetFixtures(): void {
  for (const calls of Object.values(fixture.calendar)) calls.length = 0
  for (const calls of Object.values(fixture.crossAsset)) calls.length = 0
  fixture.saveSettingsCalls.length = 0
  fixture.queueMissingCalls.length = 0
  fixture.retryFailedCalls.length = 0
  fixture.settings = {
    autoTranslateEnabled: false,
    targetLocale: 'follow-app',
    providerId: undefined,
    modelId: undefined,
    translateTitle: false,
    translateSummary: false,
    translateEvidenceExcerpt: false,
    updatedAt: '2026-10-01T00:00:00.000Z'
  }
}

beforeEach(() => {
  resetFixtures()
  dataDir = mkdtempSync(join(tmpdir(), 'mi-agent-operations-'))
  changeLog = createAgentChangeLog(join(dataDir, 'agent-change-log.sqlite'))
  context = {
    toolCallId: 'tool-call-2',
    productId: 'market-intelligence',
    toolName: 'test',
    schemaVersion: 1,
    agentId: 'crypto-market-analyst',
    agentSessionId: 'session-2',
    signal: new AbortController().signal,
    log: async () => undefined
  }
})

afterEach(() => {
  try {
    changeLog?.close()
  } catch {
    // Already closed by a test that forced an audit failure.
  }
  rmSync(dataDir, { recursive: true, force: true })
})

const macroCalendarOps = {
  saveProviderProfile: async (input: unknown) => {
    fixture.calendar.saveProviderProfile.push(input)
    return { state: 'saved', provider: { providerId: 'macro-calendar-fed', enabled: true, scheduleHealth: 'healthy', consecutiveFailures: 0 } }
  },
  runProviderNow: async (providerId: unknown) => {
    fixture.calendar.runProviderNow.push(providerId)
    return { state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded' }
  },
  testProviderConnection: async (providerId: unknown) => {
    fixture.calendar.testProviderConnection.push(providerId)
    return { state: 'succeeded' }
  },
  setReleaseTime: async (input: unknown) => {
    fixture.calendar.setReleaseTime.push(input)
    return { state: 'saved', scheduledAt: '2026-09-10T12:30:00.000Z', scheduledDate: '2026-09-10' }
  },
  clearReleaseTime: async (eventKey: string) => {
    fixture.calendar.clearReleaseTime.push(eventKey)
    return { state: 'cleared' }
  },
  refreshBlsEmployment: async (input: unknown) => {
    fixture.calendar.refreshBlsEmployment.push(input)
    return { state: 'updated' }
  },
  refreshFedFomc: async (input: unknown) => {
    fixture.calendar.refreshFedFomc.push(input)
    return { state: 'unchanged' }
  },
  syncBlsSchedule: async (input: unknown) => {
    fixture.calendar.syncBlsSchedule.push(input)
    return { state: 'completed', schedule: 'updated', values: { cpi: 'updated', employment: 'current' } }
  },
  previewManualIcs: async (input: unknown) => {
    fixture.calendar.previewManualIcs.push(input)
    return {
      state: 'ready',
      totalEvents: 1,
      supportedReleaseGroups: 1,
      generatedEvents: 1,
      unsupportedEvents: 0,
      insertedCount: 1,
      rescheduledCount: 0,
      unchangedCount: 0
    }
  },
  importManualIcs: async (input: unknown) => {
    fixture.calendar.importManualIcs.push(input)
    return {
      state: 'imported',
      totalEvents: 1,
      supportedReleaseGroups: 1,
      generatedEvents: 1,
      unsupportedEvents: 0,
      insertedCount: 1,
      rescheduledCount: 0,
      unchangedCount: 0
    }
  }
}

const crossAssetOps = {
  acquire: async () => {
    fixture.crossAsset.acquire.push({})
    return { state: 'active', leaseId: 'lease-1', expiresAt: 1_800_000_000_000 }
  },
  renew: async (leaseId: string) => {
    fixture.crossAsset.renew.push(leaseId)
    return { state: 'active', leaseId, expiresAt: 1_800_000_000_000 }
  },
  release: async (leaseId: string) => {
    fixture.crossAsset.release.push(leaseId)
    return { state: 'released' }
  },
  refresh: async (leaseId: string) => {
    fixture.crossAsset.refresh.push(leaseId)
    return { state: 'active', leaseId, expiresAt: 1_800_000_000_000 }
  },
  testInterface: async () => {
    fixture.crossAsset.testInterface.push({})
    return { state: 'passed', assets: { index: { rest: true, ws: true } }, testedAt: 1 }
  },
  cancelInterfaceTest: async () => {
    fixture.crossAsset.cancelInterfaceTest.push({})
    return { state: 'cancelled' }
  }
}

function registrations(): Map<string, ProductAgentToolHandlerRegistration> {
  const collected = new Map<string, ProductAgentToolHandlerRegistration>()
  registerIntelligenceAgentToolHandlers(
    (registration) => collected.set(registration.handlerId, registration),
    { jobRuntime, changeLog, macroCalendarOps, crossAssetOps }
  )
  return collected
}

function handler(id: string) {
  const registration = registrations().get(`market-intelligence.${id}`)
  if (!registration) throw new Error(`Missing handler: ${id}`)
  return registration.handle
}

describe('macro calendar write handlers', () => {
  it('saves provider settings through the provider settings service', async () => {
    const result = (await handler('operate-macro-calendar')(
      { action: 'save-provider-profile', providerId: 'macro-calendar-fed', enabled: true },
      context
    )) as { state: string; revisionBefore: string; revisionAfter: string }

    expect(fixture.calendar.saveProviderProfile).toEqual([
      { providerId: 'macro-calendar-fed', enabled: true }
    ])
    expect(result.state).toBe('saved')
    expect(result.revisionBefore).toBe(result.revisionAfter)
    const rows = changeLog!.listRecent({})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      domain: 'calendar',
      action: 'save-provider-profile',
      sourceId: 'macro-calendar-fed'
    })
  })

  it('sets and clears a release time override with the exact payload', async () => {
    await handler('operate-macro-calendar')(
      {
        action: 'set-release-time',
        eventKey: 'US.CPI.RELEASE.2026-M09',
        scheduledAt: '2026-09-10T12:30:00.000Z',
        scheduledDate: '2026-09-10'
      },
      context
    )
    await handler('operate-macro-calendar')(
      { action: 'clear-release-time', eventKey: 'US.CPI.RELEASE.2026-M09' },
      context
    )

    expect(fixture.calendar.setReleaseTime).toEqual([
      {
        eventKey: 'US.CPI.RELEASE.2026-M09',
        scheduledAt: '2026-09-10T12:30:00.000Z',
        scheduledDate: '2026-09-10'
      }
    ])
    expect(fixture.calendar.clearReleaseTime).toEqual(['US.CPI.RELEASE.2026-M09'])
  })

  it('runs a provider and tests its connection without configuration change', async () => {
    await handler('operate-macro-calendar')(
      { action: 'run-provider-now', providerId: 'macro-calendar-fed' },
      context
    )
    await handler('operate-macro-calendar')(
      { action: 'test-provider-connection', providerId: 'macro-calendar-fed' },
      context
    )

    expect(fixture.calendar.runProviderNow).toEqual(['macro-calendar-fed'])
    expect(fixture.calendar.testProviderConnection).toEqual(['macro-calendar-fed'])
    const rows = changeLog!.listRecent({})
    expect(rows).toHaveLength(2)
    expect(rows[0]!.changeSummary).toContain('no configuration change')
  })

  it('injects confirmed for the refresh actions after the overwrite acknowledgement', async () => {
    await handler('operate-macro-calendar')(
      {
        action: 'refresh-bls-employment',
        eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M09',
        acknowledgeOverwrite: true
      },
      context
    )
    await handler('operate-macro-calendar')(
      {
        action: 'refresh-fed-fomc',
        eventKey: 'US.FOMC.2026-09-16',
        acknowledgeOverwrite: true
      },
      context
    )

    expect(fixture.calendar.refreshBlsEmployment).toEqual([
      { eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M09', confirmed: true }
    ])
    expect(fixture.calendar.refreshFedFomc).toEqual([
      { eventKey: 'US.FOMC.2026-09-16', confirmed: true }
    ])
  })

  it('does not reach the facade when the overwrite acknowledgement is missing', async () => {
    const error = await handler('operate-macro-calendar')(
      { action: 'refresh-bls-employment', eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M09' },
      context
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProductToolGuardError)
    expect((error as InstanceType<typeof ProductToolGuardError>).code).toBe('missing-property')
    expect(fixture.calendar.refreshBlsEmployment).toHaveLength(0)
  })

  it('rejects a model-supplied confirmed flag before the facade sees it', async () => {
    const error = await handler('operate-macro-calendar')(
      {
        action: 'refresh-bls-employment',
        eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M09',
        acknowledgeOverwrite: true,
        confirmed: true
      },
      context
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProductToolGuardError)
    expect((error as InstanceType<typeof ProductToolGuardError>).code).toBe('unexpected-property')
    expect(fixture.calendar.refreshBlsEmployment).toHaveLength(0)
  })

  it('syncs the BLS schedule and previews/imports manual ICS bodies', async () => {
    await handler('operate-macro-calendar')({ action: 'sync-bls-schedule', year: '2026' }, context)
    await handler('operate-macro-calendar')(
      { action: 'preview-manual-ics', body: 'BEGIN:VCALENDAR', truncated: false },
      context
    )
    await handler('operate-macro-calendar')(
      { action: 'import-manual-ics', body: 'BEGIN:VCALENDAR', truncated: true },
      context
    )

    expect(fixture.calendar.syncBlsSchedule).toEqual([{ year: '2026' }])
    expect(fixture.calendar.previewManualIcs).toEqual([{ body: 'BEGIN:VCALENDAR', truncated: false }])
    expect(fixture.calendar.importManualIcs).toEqual([{ body: 'BEGIN:VCALENDAR', truncated: true }])
  })
})

describe('translation write handlers', () => {
  it('saves only the settings the caller supplied', async () => {
    await handler('configure-translation')(
      {
        action: 'save-settings',
        autoTranslateEnabled: true,
        targetLocale: 'zh-CN',
        translateTitle: true
      },
      context
    )

    expect(fixture.saveSettingsCalls).toEqual([
      { autoTranslateEnabled: true, targetLocale: 'zh-CN', translateTitle: true }
    ])
    const rows = changeLog!.listRecent({})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ domain: 'translation', action: 'save-settings' })
    expect(rows[0]!.before).toMatchObject({ autoTranslateEnabled: false })
    expect(rows[0]!.after).toMatchObject({ autoTranslateEnabled: true })
  })

  it('queues missing items with the manual-selection reason', async () => {
    await handler('configure-translation')(
      {
        action: 'queue-missing',
        itemIds: ['item-1'],
        clusterIds: ['cluster-1'],
        filters: { timeRange: '7d' },
        targetLocale: 'en-US'
      },
      context
    )

    expect(fixture.queueMissingCalls).toEqual([
      {
        itemIds: ['item-1'],
        clusterIds: ['cluster-1'],
        filters: { timeRange: '7d' },
        targetLocale: 'en-US',
        reason: 'manual-selection'
      }
    ])
  })

  it('retries failed items without overriding the service-owned reason', async () => {
    await handler('configure-translation')({ action: 'retry-failed', itemIds: ['item-2'] }, context)

    expect(fixture.retryFailedCalls).toEqual([{ itemIds: ['item-2'] }])
  })
})

describe('cross-asset interface write handlers', () => {
  it('routes every lease action to the runtime facade', async () => {
    const tool = handler('configure-cross-asset-interface')
    await tool({ action: 'acquire' }, context)
    await tool({ action: 'renew', leaseId: 'lease-1' }, context)
    await tool({ action: 'refresh', leaseId: 'lease-1' }, context)
    await tool({ action: 'release', leaseId: 'lease-1' }, context)
    await tool({ action: 'test-interface' }, context)
    await tool({ action: 'cancel-test' }, context)

    expect(fixture.crossAsset.acquire).toHaveLength(1)
    expect(fixture.crossAsset.renew).toEqual(['lease-1'])
    expect(fixture.crossAsset.refresh).toEqual(['lease-1'])
    expect(fixture.crossAsset.release).toEqual(['lease-1'])
    expect(fixture.crossAsset.testInterface).toHaveLength(1)
    expect(fixture.crossAsset.cancelInterfaceTest).toHaveLength(1)
    expect(changeLog!.listRecent({})).toHaveLength(6)
  })

  it('returns the lease result together with the audit metadata', async () => {
    const result = (await handler('configure-cross-asset-interface')(
      { action: 'acquire' },
      context
    )) as { state: string; leaseId: string; revisionBefore: string; revisionAfter: string; changed: unknown }

    expect(result).toMatchObject({ state: 'active', leaseId: 'lease-1', changed: {} })
    expect(result.revisionBefore).toBe(result.revisionAfter)
  })
})
