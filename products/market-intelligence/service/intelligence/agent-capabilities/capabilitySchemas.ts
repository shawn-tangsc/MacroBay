/**
 * JSON schemas shared by the product manifest and the agent capability catalog.
 *
 * These declarations used to live in `product.manifest.ts`. They moved here so the catalog can
 * derive the manifest instead of the two lists drifting apart. The only change on the move is the
 * explicit top-level `additionalProperties: false`, which states the rule the platform validator
 * does not enforce; `strictInputGuard` already applied it.
 */

export const marketIntelligenceQueryScopeSchema = {
  type: 'object',
  properties: {
    canonicalInstrumentId: { type: 'string' },
    venue: { type: 'string' },
    symbol: { type: 'string' },
    asset: { type: 'string' },
    sector: { type: 'string' },
    market: { type: 'string' }
  }
} as const

export const marketIntelligenceQueryFiltersSchema = {
  type: 'object',
  properties: {
    layers: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['macro', 'industry', 'asset', 'exchange', 'project', 'infrastructure']
      }
    },
    sourceIds: { type: 'array', items: { type: 'string' } },
    directions: {
      type: 'array',
      items: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'mixed'] }
    },
    minConfidence: { type: 'number' },
    horizon: { type: 'string', enum: ['15m', '1h', '4h', '24h'] }
  }
} as const

export const marketIntelligenceTimeBoundInputSchema = {
  type: 'object',
  required: ['asOf'],
  additionalProperties: false,
  properties: {
    asOf: { type: 'string', format: 'date-time' },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    lookbackWindowMs: { type: 'number' },
    maxItems: { type: 'number' },
    scope: marketIntelligenceQueryScopeSchema,
    filters: marketIntelligenceQueryFiltersSchema
  }
} as const

export const marketIntelligenceQueryOutputSchema = {
  type: 'object',
  required: [
    'schemaVersion',
    'queryId',
    'queryType',
    'asOf',
    'servedAt',
    'resultHash',
    'scope',
    'timeWindow',
    'confidence',
    'caveats',
    'sourceCoverage',
    'evidenceRefs',
    'data'
  ],
  properties: {
    schemaVersion: { type: 'number' },
    queryId: { type: 'string' },
    queryType: { type: 'string' },
    asOf: { type: 'string', format: 'date-time' },
    servedAt: { type: 'string', format: 'date-time' },
    resultHash: { type: 'string' },
    scope: marketIntelligenceQueryScopeSchema,
    timeWindow: {
      type: 'object',
      required: ['to'],
      properties: {
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        lookbackWindowMs: { type: 'number' }
      }
    },
    confidence: { type: 'number' },
    caveats: { type: 'array', items: { type: 'string' } },
    sourceCoverage: { type: 'array', items: { type: 'object' } },
    evidenceRefs: { type: 'array', items: { type: 'object' } },
    data: { type: 'object' }
  }
} as const

export const marketIntelligenceEvidenceInputSchema = {
  type: 'object',
  required: ['asOf'],
  additionalProperties: false,
  properties: {
    asOf: { type: 'string', format: 'date-time' },
    evidenceRefId: { type: 'string' },
    itemId: { type: 'string' },
    impactId: { type: 'string' },
    clusterId: { type: 'string' },
    maxExcerptChars: { type: 'number' }
  }
} as const

export const marketAnalysisContextInputSchema = {
  type: 'object',
  required: ['eventGroupId', 'asOf'],
  additionalProperties: false,
  properties: {
    eventGroupId: { type: 'string' },
    asOf: { type: 'string', format: 'date-time' },
    domains: {
      type: 'array',
      items: { type: 'string', enum: ['macro', 'capital', 'sentiment', 'funding', 'cross-asset'] }
    },
    maxFacts: { type: 'integer', minimum: 1 }
  }
} as const

/**
 * The two macro snapshot tools take no arguments: they answer with what the product's store holds
 * *now*, which is what the panel's 市场状态 block renders. They therefore declare no temporal
 * boundary — there is no historical read to bound — and neither may start an analysis on its own
 * (`autoTriggerAllowed` stays false for both sources in the admission matrix).
 */
export const macroSnapshotEmptyInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const

export const macroMarketSnapshotOutputSchema = {
  type: 'object',
  required: ['state'],
  properties: {
    state: { type: 'string', enum: ['available', 'empty', 'unavailable'] },
    asOf: { type: 'string', format: 'date-time' },
    readings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['seriesId', 'level', 'atMs', 'returns'],
        properties: {
          seriesId: { type: 'string' },
          level: { type: 'number' },
          atMs: { type: 'integer' },
          returns: { type: 'object' },
          synthetic: { type: 'boolean' },
          live: { type: 'object' }
        }
      }
    },
    caveats: { type: 'array', items: { type: 'string' } }
  }
} as const

export const provenanceExplainInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { family: { type: 'string' } }
} as const

/** 两种状态：给了族名 → 该族的口径与现值；没给 → 索引（有哪些族可查）。 */
export const provenanceExplainOutputSchema = {
  type: 'object',
  required: ['state'],
  properties: {
    state: { type: 'string', enum: ['available', 'unavailable'] },
    family: { type: 'string' },
    nameKey: { type: 'string' },
    formula: { type: 'object' },
    values: { type: 'object' },
    index: { type: 'string' },
    families: { type: 'array', items: { type: 'string' } },
    notOnThisSide: { type: 'array', items: { type: 'string' } }
  }
} as const

export const macroRatesSnapshotOutputSchema = {
  type: 'object',
  required: ['state'],
  properties: {
    state: { type: 'string', enum: ['available', 'empty', 'unavailable'] },
    asOf: { type: 'string', format: 'date-time' },
    readings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['seriesId', 'metricKey', 'actual', 'period'],
        properties: {
          seriesId: { type: 'string' },
          metricKey: { type: 'string' },
          actual: { type: 'number' },
          previous: { type: 'number' },
          period: { type: 'string' }
        }
      }
    },
    caveats: { type: 'array', items: { type: 'string' } }
  }
} as const

export const marketAnalysisContextOutputSchema = {
  type: 'object',
  required: ['state'],
  properties: {
    state: { type: 'string', enum: ['available', 'unavailable'] },
    schemaVersion: { type: 'integer' },
    profileId: { type: 'string' },
    eventGroupId: { type: 'string' },
    asOf: { type: 'string', format: 'date-time' },
    dataCutoff: { type: 'string', format: 'date-time' },
    snapshotId: { type: ['string', 'null'] },
    snapshotHash: { type: ['string', 'null'] },
    facts: { type: 'array', items: { type: 'object' } },
    missingDomains: { type: 'array', items: { type: 'string' } },
    caveats: { type: 'array', items: { type: 'string' } },
    evidenceRefs: { type: 'array', items: { type: 'object' } },
    sourceHealth: { type: 'array', items: { type: 'object' } },
    domainAccess: { type: 'array', items: { type: 'object' } },
    errorCode: { type: 'string' }
  }
} as const

export const marketIntelligenceAgentToolDefaults = {
  timeoutMs: 10_000,
  maxOutputBytes: 64_000
} as const
