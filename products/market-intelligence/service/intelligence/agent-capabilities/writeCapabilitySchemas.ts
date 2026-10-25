import type { CapabilityActionRules } from './strictInputGuard'

/**
 * Input and output schemas for the write surface (design 152 §4–§5).
 *
 * Every input declares all fields of all its actions and still keeps
 * `additionalProperties: false`; the per-action allow-list in
 * `intelligenceWriteActionRules` is what makes a field usable only by the action
 * that owns it. `credentialRef` is declared on purpose so a model that tries it
 * gets `invalid-action-fields` rather than a generic unexpected-property, and no
 * action lists it. The real credential never travels through a tool call.
 */

const actionSchema = (values: readonly string[]) => ({ type: 'string', enum: values }) as const

const auditProperties = {
  revisionBefore: { type: 'string' },
  revisionAfter: { type: 'string' },
  changed: { type: 'object' },
  auditFailed: { type: 'boolean' }
} as const

const auditRequired = ['revisionBefore', 'revisionAfter', 'changed'] as const

const sourceConfigOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['state', ...auditRequired],
  properties: {
    state: { type: 'string', enum: ['saved'] },
    sourceId: { type: 'string' },
    enabled: { type: 'boolean' },
    enabledFocusMarkets: { type: 'array', items: { type: 'string' } },
    ...auditProperties
  }
} as const

const sourceOperationOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...auditRequired],
  properties: {
    sourceId: { type: 'string' },
    itemId: { type: 'string' },
    action: { type: 'string' },
    queuedAt: { type: 'string' },
    ok: { type: 'boolean' },
    message: { type: 'string' },
    testedAt: { type: 'string' },
    failureCode: { type: 'string' },
    state: { type: 'string' },
    assessmentCount: { type: 'integer' },
    failedCount: { type: 'integer' },
    ...auditProperties
  }
} as const

const calendarOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...auditRequired],
  properties: {
    state: { type: 'string' },
    providerId: { type: 'string' },
    outcome: { type: 'string' },
    eventKey: { type: 'string' },
    scheduledAt: { type: 'string' },
    scheduledDate: { type: 'string' },
    failureCode: { type: 'string' },
    schedule: { type: 'string' },
    values: { type: 'object' },
    totalEvents: { type: 'integer' },
    supportedReleaseGroups: { type: 'integer' },
    generatedEvents: { type: 'integer' },
    unsupportedEvents: { type: 'integer' },
    insertedCount: { type: 'integer' },
    rescheduledCount: { type: 'integer' },
    unchangedCount: { type: 'integer' },
    ...auditProperties
  }
} as const

const translationOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...auditRequired],
  properties: {
    state: { type: 'string', enum: ['saved', 'queued'] },
    queuedAt: { type: 'string' },
    queuedCount: { type: 'integer' },
    reason: { type: 'string' },
    targetLocale: { type: 'string' },
    ...auditProperties
  }
} as const

const crossAssetOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...auditRequired],
  properties: {
    state: { type: 'string' },
    leaseId: { type: 'string' },
    expiresAt: { type: 'number' },
    assets: { type: 'object' },
    testedAt: { type: 'number' },
    ...auditProperties
  }
} as const

export const configureIntelligenceSourceInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: actionSchema(['save-profile', 'set-enabled', 'save-focus-markets']),
    sourceId: { type: 'string', 'x-maxStringLength': 160 },
    collectionPreset: { type: 'string', enum: ['manual', 'balanced', 'frequent'] },
    includeInSentiment: { type: 'boolean' },
    scopePolicy: { type: 'string', enum: ['all', 'watchlist-priority', 'active-position-priority'] },
    rawArchiveEnabled: { type: 'boolean' },
    retentionMode: { type: 'string', enum: ['compact', 'balanced', 'extended'] },
    autoReplayAfterParserUpgrade: { type: 'boolean' },
    monitoredSymbols: { type: 'array', maxItems: 200, items: { type: 'string' } },
    enabled: { type: 'boolean' },
    enabledFocusMarkets: {
      type: 'array',
      maxItems: 7,
      items: {
        type: 'string',
        enum: ['global-macro', 'digital-assets', 'cn-a-shares', 'us-equities', 'china-futures', 'fx', 'commodities']
      }
    },
    // Declared only so the action guard can name it; no action accepts it.
    credentialRef: { type: 'string' }
  }
} as const

export const operateIntelligenceSourceInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: actionSchema(['run-now', 'test-connection', 'retry-assessment']),
    sourceId: { type: 'string', 'x-maxStringLength': 160 },
    itemId: { type: 'string', 'x-maxStringLength': 160 }
  }
} as const

export const operateMacroCalendarInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: actionSchema([
      'save-provider-profile',
      'run-provider-now',
      'test-provider-connection',
      'set-release-time',
      'clear-release-time',
      'refresh-bls-employment',
      'refresh-fed-fomc',
      'sync-bls-schedule',
      'preview-manual-ics',
      'import-manual-ics'
    ]),
    providerId: { type: 'string', 'x-maxStringLength': 128 },
    enabled: { type: 'boolean' },
    eventKey: { type: 'string', 'x-maxStringLength': 160 },
    scheduledAt: { type: 'string', 'x-maxStringLength': 40 },
    scheduledDate: { type: 'string', 'x-maxStringLength': 10 },
    // The model's acknowledgement; `confirmed: true` stays private to the handler.
    acknowledgeOverwrite: { type: 'boolean' },
    year: { type: 'string', 'x-maxStringLength': 4 },
    body: { type: 'string', 'x-maxStringLength': 512 * 1024 },
    truncated: { type: 'boolean' }
  }
} as const

export const configureTranslationInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: actionSchema(['save-settings', 'queue-missing', 'retry-failed']),
    autoTranslateEnabled: { type: 'boolean' },
    targetLocale: { type: 'string', enum: ['follow-app', 'zh-CN', 'en-US'] },
    providerId: { type: 'string', 'x-maxStringLength': 128 },
    modelId: { type: 'string', 'x-maxStringLength': 160 },
    translateTitle: { type: 'boolean' },
    translateSummary: { type: 'boolean' },
    translateEvidenceExcerpt: { type: 'boolean' },
    itemIds: { type: 'array', maxItems: 200, items: { type: 'string' } },
    clusterIds: { type: 'array', maxItems: 200, items: { type: 'string' } },
    filters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        timeRange: { type: 'string', enum: ['24h', '7d', '30d', 'all'] },
        sourceGroup: { type: 'string', 'x-maxStringLength': 120 },
        scope: { type: 'string', 'x-maxStringLength': 120 },
        symbol: { type: 'string', 'x-maxStringLength': 60 },
        limit: { type: 'integer', minimum: 1, maximum: 500 }
      }
    }
  }
} as const

export const configureCrossAssetInterfaceInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: actionSchema(['acquire', 'renew', 'release', 'refresh', 'test-interface', 'cancel-test']),
    leaseId: { type: 'string', 'x-maxStringLength': 128 }
  }
} as const

export const requestSourceCredentialInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceId'],
  properties: {
    sourceId: { type: 'string', 'x-maxStringLength': 160 }
  }
} as const

export const requestSourceCredentialOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['handoff', 'sourceId', 'settingsSectionId', 'fields'],
  properties: {
    handoff: { type: 'string', enum: ['credential-entry'] },
    sourceId: { type: 'string' },
    settingsSectionId: { type: 'string', enum: ['intelligence-sources'] },
    fields: { type: 'array', items: { type: 'string' } }
  }
} as const

export const configureIntelligenceSourceOutputSchema = sourceConfigOutputSchema
export const operateIntelligenceSourceOutputSchema = sourceOperationOutputSchema
export const operateMacroCalendarOutputSchema = calendarOutputSchema
export const configureTranslationOutputSchema = translationOutputSchema
export const configureCrossAssetInterfaceOutputSchema = crossAssetOutputSchema

/**
 * The action-to-field contract for every write tool (design 152 §7 step 9).
 *
 * A field that belongs to no action is rejected as `invalid-action-fields`; a
 * field an action cannot omit is rejected as `missing-property` before the
 * handler runs. `confirmed` appears nowhere: the service-level confirmation is
 * injected by the handler after the reader acknowledged the overwrite.
 */
export const intelligenceWriteActionRules: Readonly<Record<string, CapabilityActionRules>> = {
  configure_intelligence_source: {
    'save-profile': {
      fields: [
        'sourceId',
        'collectionPreset',
        'includeInSentiment',
        'scopePolicy',
        'rawArchiveEnabled',
        'retentionMode',
        'autoReplayAfterParserUpgrade',
        'monitoredSymbols'
      ],
      required: ['sourceId']
    },
    'set-enabled': { fields: ['sourceId', 'enabled'], required: ['sourceId', 'enabled'] },
    'save-focus-markets': { fields: ['enabledFocusMarkets'], required: ['enabledFocusMarkets'] }
  },
  operate_intelligence_source: {
    'run-now': { fields: ['sourceId'], required: ['sourceId'] },
    'test-connection': { fields: ['sourceId'], required: ['sourceId'] },
    'retry-assessment': { fields: ['itemId'], required: ['itemId'] }
  },
  operate_macro_calendar: {
    'save-provider-profile': { fields: ['providerId', 'enabled'], required: ['providerId', 'enabled'] },
    'run-provider-now': { fields: ['providerId'], required: ['providerId'] },
    'test-provider-connection': { fields: ['providerId'], required: ['providerId'] },
    'set-release-time': {
      fields: ['eventKey', 'scheduledAt', 'scheduledDate'],
      required: ['eventKey', 'scheduledAt', 'scheduledDate']
    },
    'clear-release-time': { fields: ['eventKey'], required: ['eventKey'] },
    'refresh-bls-employment': {
      fields: ['eventKey', 'acknowledgeOverwrite'],
      required: ['eventKey', 'acknowledgeOverwrite']
    },
    'refresh-fed-fomc': {
      fields: ['eventKey', 'acknowledgeOverwrite'],
      required: ['eventKey', 'acknowledgeOverwrite']
    },
    'sync-bls-schedule': { fields: ['year'], required: ['year'] },
    'preview-manual-ics': { fields: ['body', 'truncated'], required: ['body'] },
    'import-manual-ics': { fields: ['body', 'truncated'], required: ['body'] }
  },
  configure_translation: {
    'save-settings': {
      fields: [
        'autoTranslateEnabled',
        'targetLocale',
        'providerId',
        'modelId',
        'translateTitle',
        'translateSummary',
        'translateEvidenceExcerpt'
      ],
      anyOfRequired: [
        'autoTranslateEnabled',
        'targetLocale',
        'providerId',
        'modelId',
        'translateTitle',
        'translateSummary',
        'translateEvidenceExcerpt'
      ]
    },
    'queue-missing': ['itemIds', 'clusterIds', 'filters', 'targetLocale'],
    'retry-failed': ['itemIds', 'clusterIds', 'filters', 'targetLocale']
  },
  configure_cross_asset_interface: {
    acquire: [],
    renew: { fields: ['leaseId'], required: ['leaseId'] },
    release: { fields: ['leaseId'], required: ['leaseId'] },
    refresh: { fields: ['leaseId'], required: ['leaseId'] },
    'test-interface': [],
    'cancel-test': []
  }
}
