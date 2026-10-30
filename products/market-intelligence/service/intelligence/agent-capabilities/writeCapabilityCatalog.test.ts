import { describe, expect, it } from 'vitest'

import { intelligenceAgentCapabilities } from './capabilityCatalog'
import { validateCapabilityInput } from './strictInputGuard'
import { toManifestRegistrations } from './toManifestRegistrations'
import { intelligenceWriteActionRules } from './writeCapabilitySchemas'

const WRITE_CAPABILITY_IDS = [
  'configure_intelligence_source',
  'operate_intelligence_source',
  'operate_macro_calendar',
  'configure_translation',
  'configure_cross_asset_interface'
] as const

const HANDOFF_CAPABILITY_ID = 'request_source_credential'

const capabilityById = new Map(intelligenceAgentCapabilities.map((capability) => [capability.id, capability]))

function validate(capabilityId: string, input: unknown) {
  const capability = capabilityById.get(capabilityId)
  if (!capability) throw new Error(`Unknown capability: ${capabilityId}`)
  const actionRules = intelligenceWriteActionRules[capabilityId]
  return validateCapabilityInput(input, capability.inputSchema, actionRules)
}

describe('write capability catalog', () => {
  it('adds five write tools and one handoff to the read surface', () => {
    expect(intelligenceAgentCapabilities).toHaveLength(31)
    expect(intelligenceAgentCapabilities.filter((capability) => capability.kind === 'write')).toHaveLength(5)
    expect(intelligenceAgentCapabilities.filter((capability) => capability.kind === 'handoff')).toHaveLength(1)
    expect(intelligenceAgentCapabilities.filter((capability) => capability.kind === 'read')).toHaveLength(24)
    expect(intelligenceAgentCapabilities.filter((capability) => capability.kind === 'discovery')).toHaveLength(1)
    expect(intelligenceAgentCapabilities.map((capability) => capability.id)).toEqual(
      expect.arrayContaining([...WRITE_CAPABILITY_IDS, HANDOFF_CAPABILITY_ID])
    )
  })

  it('declares the expected domain for each write tool', () => {
    const domainOf = (id: string) => capabilityById.get(id)?.domain
    expect(domainOf('configure_intelligence_source')).toBe('source-config')
    expect(domainOf('operate_intelligence_source')).toBe('operations')
    expect(domainOf('operate_macro_calendar')).toBe('calendar')
    expect(domainOf('configure_translation')).toBe('translation')
    expect(domainOf('configure_cross_asset_interface')).toBe('cross-asset')
    expect(domainOf(HANDOFF_CAPABILITY_ID)).toBe('source-config')
  })

  it('keeps every write schema strict, described, and bounded by a 10–15 s timeout', () => {
    for (const id of WRITE_CAPABILITY_IDS) {
      const capability = capabilityById.get(id)
      expect(capability, id).toBeDefined()
      expect(capability!.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(capability!.description.trim().length).toBeGreaterThan(40)
      expect(capability!.timeoutMs).toBeGreaterThanOrEqual(10_000)
      expect(capability!.timeoutMs).toBeLessThanOrEqual(15_000)
      expect(capability!.maxOutputBytes).toBe(64 * 1024)
    }
  })

  it('declares one action rule set per write capability, keyed by the schema enum', () => {
    for (const id of WRITE_CAPABILITY_IDS) {
      const capability = capabilityById.get(id)!
      const rules = intelligenceWriteActionRules[id]
      expect(rules, id).toBeDefined()
      const properties = capability.inputSchema.properties as Record<string, { enum?: readonly string[] }>
      expect(Object.keys(rules).sort()).toEqual([...(properties.action.enum ?? [])].sort())
    }
    expect(Object.keys(intelligenceWriteActionRules).sort()).toEqual([...WRITE_CAPABILITY_IDS].sort())
  })

  it('never lets save-profile change enabled, credentials, or free-form source config', () => {
    expect(
      validate('configure_intelligence_source', {
        action: 'save-profile',
        sourceId: 'coingecko-trending',
        enabled: true
      })
    ).toMatchObject({ ok: false, code: 'invalid-action-fields' })

    expect(
      validate('configure_intelligence_source', {
        action: 'save-profile',
        sourceId: 'coingecko-trending',
        credentialRef: 'stored-credential'
      })
    ).toMatchObject({ ok: false, code: 'invalid-action-fields' })

    expect(
      validate('configure_intelligence_source', {
        action: 'save-profile',
        sourceId: 'coingecko-trending',
        sourceSpecificConfigJson: '{}'
      })
    ).toMatchObject({ ok: false, code: 'unexpected-property' })
  })

  it('requires sourceId on save-profile instead of letting the handler discover it', () => {
    expect(
      validate('configure_intelligence_source', {
        action: 'save-profile',
        collectionPreset: 'frequent'
      })
    ).toMatchObject({ ok: false, code: 'missing-property' })
  })

  it('requires at least one settings field on save-settings so an empty patch never reaches the handler', () => {
    expect(validate('configure_translation', { action: 'save-settings' })).toMatchObject({
      ok: false,
      code: 'invalid-action-fields'
    })

    expect(
      validate('configure_translation', { action: 'save-settings', targetLocale: 'zh-CN' })
    ).toEqual({ ok: true })
  })

  it('declares every identifier an action handler needs as required', () => {
    const identifierActions: ReadonlyArray<readonly [string, string, string]> = [
      ['configure_intelligence_source', 'save-profile', 'sourceId'],
      ['configure_intelligence_source', 'set-enabled', 'sourceId'],
      ['operate_intelligence_source', 'run-now', 'sourceId'],
      ['operate_intelligence_source', 'test-connection', 'sourceId'],
      ['operate_intelligence_source', 'retry-assessment', 'itemId'],
      ['operate_macro_calendar', 'save-provider-profile', 'providerId'],
      ['operate_macro_calendar', 'run-provider-now', 'providerId'],
      ['operate_macro_calendar', 'test-provider-connection', 'providerId'],
      ['operate_macro_calendar', 'set-release-time', 'eventKey'],
      ['operate_macro_calendar', 'clear-release-time', 'eventKey'],
      ['operate_macro_calendar', 'refresh-bls-employment', 'eventKey'],
      ['operate_macro_calendar', 'refresh-fed-fomc', 'eventKey'],
      ['configure_cross_asset_interface', 'renew', 'leaseId'],
      ['configure_cross_asset_interface', 'release', 'leaseId'],
      ['configure_cross_asset_interface', 'refresh', 'leaseId']
    ]

    for (const [capabilityId, action, identifier] of identifierActions) {
      const rule = intelligenceWriteActionRules[capabilityId]?.[action]
      const required = rule && !Array.isArray(rule) ? (rule.required ?? []) : []
      expect(required, `${capabilityId}.${action} must require ${identifier}`).toContain(identifier)
    }
  })

  it('accepts a profile patch made only of the declared per-source settings', () => {
    expect(
      validate('configure_intelligence_source', {
        action: 'save-profile',
        sourceId: 'coingecko-trending',
        collectionPreset: 'frequent',
        includeInSentiment: false,
        scopePolicy: 'watchlist-priority',
        rawArchiveEnabled: true,
        retentionMode: 'extended',
        autoReplayAfterParserUpgrade: true,
        monitoredSymbols: ['BTCUSDT']
      })
    ).toEqual({ ok: true })
  })

  it('requires acknowledgeOverwrite for the calendar refresh actions and rejects model-supplied confirmed', () => {
    expect(
      validate('operate_macro_calendar', {
        action: 'refresh-bls-employment',
        eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M09'
      })
    ).toMatchObject({ ok: false, code: 'missing-property' })

    expect(
      validate('operate_macro_calendar', {
        action: 'refresh-fed-fomc',
        eventKey: 'US.FOMC.2026-09-16'
      })
    ).toMatchObject({ ok: false, code: 'missing-property' })

    expect(
      validate('operate_macro_calendar', {
        action: 'refresh-bls-employment',
        eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M09',
        acknowledgeOverwrite: true,
        confirmed: true
      })
    ).toMatchObject({ ok: false, code: 'unexpected-property' })

    expect(
      validate('operate_macro_calendar', {
        action: 'refresh-bls-employment',
        eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M09',
        acknowledgeOverwrite: true
      })
    ).toEqual({ ok: true })
  })

  it('accepts every declared write action with its own fields', () => {
    const samples: ReadonlyArray<readonly [string, unknown]> = [
      ['configure_intelligence_source', { action: 'set-enabled', sourceId: 'coingecko-trending', enabled: true }],
      ['configure_intelligence_source', { action: 'save-focus-markets', enabledFocusMarkets: ['digital-assets'] }],
      ['operate_intelligence_source', { action: 'run-now', sourceId: 'coingecko-trending' }],
      ['operate_intelligence_source', { action: 'test-connection', sourceId: 'coingecko-trending' }],
      ['operate_intelligence_source', { action: 'retry-assessment', itemId: 'item-1' }],
      ['operate_macro_calendar', { action: 'save-provider-profile', providerId: 'macro-calendar-fed', enabled: true }],
      ['operate_macro_calendar', { action: 'set-release-time', eventKey: 'US.CPI.RELEASE.2026-M09', scheduledAt: '2026-09-10T12:30:00.000Z', scheduledDate: '2026-09-10' }],
      ['operate_macro_calendar', { action: 'clear-release-time', eventKey: 'US.CPI.RELEASE.2026-M09' }],
      ['operate_macro_calendar', { action: 'run-provider-now', providerId: 'macro-calendar-fed' }],
      ['operate_macro_calendar', { action: 'test-provider-connection', providerId: 'macro-calendar-fed' }],
      ['operate_macro_calendar', { action: 'sync-bls-schedule', year: '2026' }],
      ['operate_macro_calendar', { action: 'preview-manual-ics', body: 'BEGIN:VCALENDAR', truncated: false }],
      ['operate_macro_calendar', { action: 'import-manual-ics', body: 'BEGIN:VCALENDAR', truncated: false }],
      ['configure_translation', { action: 'save-settings', autoTranslateEnabled: true, targetLocale: 'zh-CN' }],
      ['configure_translation', { action: 'queue-missing', itemIds: ['item-1'] }],
      ['configure_translation', { action: 'retry-failed', targetLocale: 'en-US' }],
      ['configure_cross_asset_interface', { action: 'acquire' }],
      ['configure_cross_asset_interface', { action: 'renew', leaseId: 'lease-1' }],
      ['configure_cross_asset_interface', { action: 'test-interface' }]
    ]

    for (const [capabilityId, input] of samples) {
      expect(validate(capabilityId, input), `${capabilityId} ${JSON.stringify(input)}`).toEqual({ ok: true })
    }
  })

  it('derives manifest approval rules: writes always ask, handoff never does', () => {
    const registrations = toManifestRegistrations(intelligenceAgentCapabilities)
    const byToolName = new Map(registrations.map((registration) => [registration.toolName, registration]))

    for (const id of WRITE_CAPABILITY_IDS) {
      const registration = byToolName.get(id)
      expect(registration, id).toBeDefined()
      expect(registration!.readOnly).toBe(false)
      expect(registration!.requiresApproval).toBe('always')
      expect(registration!.timeoutMs).toBeGreaterThanOrEqual(10_000)
    }

    const handoff = byToolName.get(HANDOFF_CAPABILITY_ID)
    expect(handoff).toBeDefined()
    expect(handoff!.readOnly).toBe(true)
    expect(handoff!.requiresApproval).toBe('never')
  })
})
