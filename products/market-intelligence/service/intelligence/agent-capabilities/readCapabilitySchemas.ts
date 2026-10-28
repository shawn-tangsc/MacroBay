/**
 * Input/output schemas for the read capabilities added in this slice.
 *
 * The nine pre-existing tool schemas stay in `capabilitySchemas.ts` because the product manifest
 * imports the same objects; these are new and only the catalog uses them.
 */

const stateSchema = {
  type: 'string',
  enum: ['available', 'empty', 'unavailable']
} as const

const caveatsSchema = { type: 'array', items: { type: 'string' } } as const

const sourceCredentialStatusSchema = {
  type: 'object',
  required: ['hasCredential'],
  properties: {
    hasCredential: { type: 'boolean' },
    lastValidatedAt: { type: 'string' }
  }
} as const

const sourceSummaryProperties = {
  sourceId: { type: 'string' },
  name: { type: 'string' },
  provider: { type: 'string' },
  category: { type: 'string' },
  visibility: { type: 'string' },
  tier: { type: 'string', enum: ['required', 'recommended', 'optional'] },
  domains: { type: 'array', items: { type: 'string', enum: ['dashboard', 'calendar'] } },
  enabled: { type: 'boolean' },
  collectionPreset: { type: 'string', enum: ['manual', 'balanced', 'frequent'] },
  includeInSentiment: { type: 'boolean' },
  scopePolicy: { type: 'string', enum: ['all', 'watchlist-priority', 'active-position-priority'] },
  retentionMode: { type: 'string', enum: ['compact', 'balanced', 'extended'] },
  rawArchiveEnabled: { type: 'boolean' },
  autoReplayAfterParserUpgrade: { type: 'boolean' },
  monitoredSymbols: { type: 'array', items: { type: 'string' } },
  credentialStatus: sourceCredentialStatusSchema
} as const

const sourceSummarySchema = {
  type: 'object',
  required: ['sourceId', 'name', 'provider', 'category', 'visibility', 'domains', 'enabled', 'credentialStatus'],
  properties: sourceSummaryProperties
} as const

export const operationsHealthInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const

export const operationsHealthOutputSchema = {
  type: 'object',
  required: ['state', 'generatedAt', 'operations', 'caveats'],
  properties: {
    state: stateSchema,
    generatedAt: { type: 'string', format: 'date-time' },
    operations: {
      type: 'object',
      required: ['registeredSchedules', 'runningJobs', 'stuck'],
      properties: {
        registeredSchedules: { type: 'integer', minimum: 0 },
        runningJobs: { type: 'integer', minimum: 0 },
        lastJobAt: { type: 'string', format: 'date-time' },
        stuck: { type: 'boolean' }
      }
    },
    caveats: caveatsSchema
  }
} as const

export const listSourcesInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    domain: { type: 'string', enum: ['all', 'dashboard', 'calendar'] },
    includeDisabled: { type: 'boolean' }
  }
} as const

export const listSourcesOutputSchema = {
  type: 'object',
  required: ['state', 'revision', 'focusMarkets', 'sources'],
  properties: {
    state: stateSchema,
    revision: { type: 'string' },
    focusMarkets: {
      type: 'object',
      required: ['enabledFocusMarkets'],
      properties: { enabledFocusMarkets: { type: 'array', items: { type: 'string' } } }
    },
    sources: { type: 'array', items: sourceSummarySchema }
  }
} as const

const sourceHealthSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['runtimeStatus', 'connectivityStatus', 'consecutiveFailures'],
  properties: {
    runtimeStatus: { type: 'string', enum: ['healthy', 'degraded', 'failed', 'paused'] },
    connectivityStatus: {
      type: 'string',
      enum: ['unverified', 'connected', 'degraded', 'failed', 'paused']
    },
    lastSuccessAt: { type: 'string', format: 'date-time' },
    lastFailureAt: { type: 'string', format: 'date-time' },
    consecutiveFailures: { type: 'integer', minimum: 0 },
    collectionGap: { type: 'boolean' }
  }
} as const

const sourceScheduleSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: { mode: { type: 'string', enum: ['manual'] } }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'intervalSeconds'],
      properties: {
        mode: { type: 'string', enum: ['interval'] },
        intervalSeconds: { type: 'integer', minimum: 1 }
      }
    }
  ]
} as const

const sourceRuntimeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['desiredState', 'schedule'],
  properties: {
    desiredState: { type: 'string', enum: ['polling', 'live', 'paused'] },
    pollingIntervalSec: { type: 'integer', minimum: 1 },
    schedule: sourceScheduleSchema
  }
} as const

export const sourceDetailInputSchema = {
  type: 'object',
  required: ['sourceId'],
  additionalProperties: false,
  properties: { sourceId: { type: 'string' } }
} as const

export const sourceDetailOutputSchema = {
  type: 'object',
  required: ['state', 'caveats'],
  additionalProperties: false,
  properties: {
    state: stateSchema,
    source: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...sourceSummaryProperties,
        definition: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'authMode', 'requiredFields'],
          properties: {
            description: { type: 'string' },
            authMode: { type: 'string', enum: ['none', 'api-key', 'optional-api-key'] },
            requiredFields: { type: 'array', items: { type: 'string' } }
          }
        },
        health: sourceHealthSchema,
        runtime: sourceRuntimeSchema
      }
    },
    caveats: caveatsSchema
  }
} as const

const timelineFiltersSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timeRange: { type: 'string', enum: ['24h', '7d', '30d', 'all'] },
    sourceGroup: {
      type: 'string',
      enum: [
        'exchange-announcement',
        'exchange-status',
        'official-source',
        'mainstream-news',
        'macro-regulation',
        'aggregate-data-provider',
        'all'
      ]
    },
    scope: { type: 'string', enum: ['active-exposure', 'watchlist', 'both', 'all'] },
    symbol: { type: 'string' },
    status: { type: 'string' },
    eventType: { type: 'string' },
    alertDecision: { type: 'string', enum: ['notify', 'timeline-only', 'suppress', 'none', 'all'] },
    layer: {
      type: 'string',
      enum: ['macro', 'industry', 'asset', 'exchange', 'project', 'infrastructure', 'all']
    },
    direction: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'mixed', 'all'] },
    eventFamily: { type: 'string', enum: ['text-event', 'metric-event', 'mixed', 'all'] },
    sourceReliability: {
      type: 'string',
      enum: ['official', 'exchange-api', 'aggregator', 'page-extract', 'community', 'all']
    }
  }
} as const

export const timelineInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    view: { type: 'string', enum: ['timeline', 'workspace'] },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    filters: timelineFiltersSchema
  }
} as const

export const timelineOutputSchema = {
  type: 'object',
  required: ['state', 'items', 'caveats'],
  properties: {
    state: stateSchema,
    items: { type: 'array', items: { type: 'object' } },
    caveats: caveatsSchema
  }
} as const

export const macroCalendarMonthInputSchema = {
  type: 'object',
  required: ['month', 'asOf'],
  additionalProperties: false,
  properties: {
    month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
    asOf: { type: 'string', format: 'date-time' },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    maxEvents: { type: 'integer', minimum: 1, maximum: 300 }
  }
} as const

export const macroCalendarMonthOutputSchema = {
  type: 'object',
  required: ['state', 'month', 'asOf', 'official', 'market', 'events', 'caveats'],
  properties: {
    state: { type: 'string', enum: ['available', 'empty', 'unavailable'] },
    month: { type: 'string' },
    asOf: { type: 'string', format: 'date-time' },
    from: { type: 'string' },
    to: { type: 'string' },
    truncated: { type: 'boolean' },
    totalEvents: { type: 'integer' },
    official: {
      type: 'object',
      required: ['state', 'eventCount'],
      properties: {
        state: { type: 'string' },
        eventCount: { type: 'integer' },
        failureCode: { type: 'string' }
      }
    },
    market: {
      type: 'object',
      required: ['state', 'eventCount'],
      properties: {
        state: { type: 'string' },
        eventCount: { type: 'integer' },
        pages: { type: 'integer' },
        failureCode: { type: 'string' }
      }
    },
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['official', 'market'] },
          eventKey: { type: 'string' },
          title: { type: 'string' },
          scheduledAt: { type: ['string', 'null'] },
          scheduledDate: { type: 'string' },
          countryName: { type: 'string' },
          importance: { type: 'string' },
          lifecycleState: { type: 'string' },
          actual: { type: 'string' },
          previous: { type: 'string' },
          consensus: { type: 'string' },
          surprise: { type: 'string', enum: ['beat', 'miss', 'inline', 'consensus-unavailable'] },
          surpriseValue: { type: 'number' },
          surpriseUnit: { type: 'string', enum: ['pp', 'relative-percent'] },
          surpriseReason: { type: 'string', enum: ['missing-actual', 'missing-consensus', 'unit-mismatch', 'non-numeric'] }
        }
      }
    },
    caveats: { type: 'array', items: { type: 'string' } },
    failureCode: { type: 'string' }
  }
} as const

export const translationStatusInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const

export const translationStatusOutputSchema = {
  type: 'object',
  required: ['state', 'module', 'settings', 'queue', 'caveats'],
  properties: {
    state: stateSchema,
    module: {
      type: 'object',
      properties: {
        pendingCount: { type: 'integer' },
        failedCount: { type: 'integer' },
        translatedCount: { type: 'integer' },
        lastJobAt: { type: 'string' },
        lastJobSummary: { type: 'string' }
      }
    },
    settings: {
      type: 'object',
      properties: {
        autoTranslateEnabled: { type: 'boolean' },
        targetLocale: { type: 'string' },
        resolvedTargetLocale: { type: 'string' },
        providerId: { type: 'string' },
        modelId: { type: 'string' },
        defaultModelId: { type: 'string' },
        translateTitle: { type: 'boolean' },
        translateSummary: { type: 'boolean' },
        translateEvidenceExcerpt: { type: 'boolean' }
      }
    },
    queue: { type: 'object' },
    caveats: caveatsSchema
  }
} as const

export const crossAssetSnapshotInputSchema = {
  type: 'object',
  required: ['range'],
  additionalProperties: false,
  properties: {
    range: { type: 'string', enum: ['1h', '24h', '7d'] },
    asOf: { type: 'string', format: 'date-time' }
  }
} as const

export const crossAssetSnapshotOutputSchema = {
  type: 'object',
  required: ['state', 'interface'],
  properties: {
    state: { type: 'string', enum: ['available', 'unavailable'] },
    snapshot: { type: 'object' },
    interface: {
      type: 'object',
      required: ['state', 'enabled', 'lease'],
      properties: {
        state: { type: 'string', enum: ['configured', 'default', 'unknown'] },
        enabled: { type: ['boolean', 'null'] },
        lease: { type: 'string', enum: ['none', 'active', 'expired', 'unknown'] }
      }
    },
    caveats: caveatsSchema
  }
} as const

export const dashboardFeedStatusInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const

export const dashboardFeedStatusOutputSchema = {
  type: 'object',
  required: ['state', 'feeds'],
  properties: {
    state: stateSchema,
    feeds: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sourceId', 'enabled', 'hasCredential'],
        properties: {
          sourceId: { type: 'string' },
          enabled: { type: 'boolean' },
          hasCredential: { type: 'boolean' },
          lastSuccessAtMs: { type: 'integer' },
          failureCode: { type: 'string' }
        }
      }
    }
  }
} as const

export const describeCapabilitiesInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    domain: {
      type: 'string',
      enum: ['all', 'query', 'source-config', 'calendar', 'translation', 'cross-asset', 'operations']
    }
  }
} as const

export const describeCapabilitiesOutputSchema = {
  type: 'object',
  required: ['state', 'domains'],
  properties: {
    state: { type: 'string', enum: ['available'] },
    domains: {
      type: 'array',
      items: {
        type: 'object',
        required: ['domain', 'capabilities'],
        properties: {
          domain: { type: 'string' },
          capabilities: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'kind', 'title', 'description', 'requiredFields'],
              properties: {
                id: { type: 'string' },
                kind: { type: 'string', enum: ['read', 'write', 'discovery', 'handoff'] },
                title: { type: 'string' },
                description: { type: 'string' },
                requiredFields: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        }
      }
    }
  }
} as const

const newsSentimentWindowSchema = {
  type: 'string',
  enum: ['1h', '4h', '24h', '7d', 'all']
} as const

export const newsSentimentInputSchema = {
  type: 'object',
  required: ['asOf', 'window'],
  additionalProperties: false,
  properties: {
    asOf: { type: 'string', format: 'date-time' },
    window: newsSentimentWindowSchema,
    scope: { type: 'string', enum: ['market', 'BTC', 'ETH'] },
    direction: { type: 'string', enum: ['all', 'bullish', 'bearish', 'neutral', 'mixed'] },
    sourceId: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 100 }
  }
} as const

export const newsSentimentOutputSchema = {
  type: 'object',
  required: ['state', 'asOf', 'window', 'items', 'caveats'],
  properties: {
    state: { type: 'string', enum: ['available', 'empty', 'unavailable'] },
    asOf: { type: 'string' },
    generatedAt: { type: 'string' },
    window: newsSentimentWindowSchema,
    summary: { type: 'object' },
    items: { type: 'array', items: { type: 'object' } },
    availableSources: { type: 'array', items: { type: 'object' } },
    caveats: { type: 'array', items: { type: 'string' } }
  }
} as const

export const newsSentimentItemInputSchema = {
  type: 'object',
  required: ['itemId', 'asOf'],
  additionalProperties: false,
  properties: {
    itemId: { type: 'string' },
    asOf: { type: 'string', format: 'date-time' }
  }
} as const

export const newsSentimentItemOutputSchema = {
  type: 'object',
  required: ['state'],
  properties: {
    state: { type: 'string', enum: ['available', 'unavailable'] },
    itemId: { type: 'string' },
    item: { type: 'object' }
  }
} as const
