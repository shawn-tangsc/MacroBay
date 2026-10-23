import { intelligenceHttpRequest } from '../adapters/intelligenceHttpClient'
import { resolveMacroProbeTarget } from '../adapters/resolveMacroMetricFetchTargets'
import { applySourceCredential } from '../adapters/intelligenceHttpFetch'
import { isMacroSourceId } from './macroSourceCatalogMetadata'

import { getIntelligenceSourceDefinition } from './sourceCatalog'
import { sourceSupportsCredentials } from '../schema/intelligenceSource'

const DEFAULT_USER_AGENT = 'MacroBay/1.0 (intelligence-credential-test)'

export async function validateIntelligenceCredential(input: {
  sourceId: string
  apiKey: string
}): Promise<{ ok: boolean; message: string }> {
  const definition = getIntelligenceSourceDefinition(input.sourceId)
  if (!definition || !sourceSupportsCredentials(definition.authMode)) {
    return { ok: false, message: 'This source does not require credentials.' }
  }

  const apiKey = input.apiKey.trim()
  if (!apiKey) {
    return { ok: false, message: 'Credential is required.' }
  }

  const request = buildValidationRequest(input.sourceId, apiKey)
  if (!request) {
    return { ok: true, message: 'Credential saved. Connectivity check is not available for this source yet.' }
  }

  try {
    const response = await intelligenceHttpRequest(
      {
        url: request.url,
        method: request.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': DEFAULT_USER_AGENT,
          ...request.headers
        },
        body: request.body,
        timeoutMs: 20_000
      },
      {
        retryPolicy: { maxAttempts: 1 },
        redactHeaders: ['authorization', 'x-api-key']
      }
    )

    if (response.status >= 400) {
      return { ok: false, message: `Credential rejected by provider (HTTP ${response.status}).` }
    }

    return { ok: true, message: 'Credential verified with provider.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Credential verification failed.'
    }
  }
}

function buildValidationRequest(
  sourceId: string,
  apiKey: string
): { url: string; method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> } | undefined {
  const definition = getIntelligenceSourceDefinition(sourceId)
  const endpointUrl = String(definition?.adapterConfig.endpointUrl ?? '')

  if (isMacroSourceId(sourceId)) {
    const probeConfig = {
      sourceId,
      sourceName: definition?.displayName ?? sourceId,
      sourceGroup: definition?.sourceGroup ?? 'macro-regulation',
      adapterType: definition?.adapterType ?? 'rest-api-poller',
      executionMode: definition?.executionMode ?? 'polling',
      enabled: true,
      category: definition?.category ?? 'macro',
      trustLevel: definition?.trustLevel ?? 'high',
      language: definition?.language ?? 'en',
      collectionPreset: definition?.defaultCollectionPreset ?? 'balanced',
      desiredRuntimeState: 'polling' as const,
      parserStrategy: definition?.parserStrategy ?? `${sourceId}-v1`,
      noisePolicy: 'balanced' as const,
      includeInSentiment: true,
      scopePolicy: definition?.defaultScopePolicy ?? 'all',
      rawArchiveEnabled: true,
      retentionMode: definition?.defaultRetentionMode ?? 'balanced',
      autoReplayAfterParserUpgrade: true,
      sentimentEligible: true,
      adapterConfig: definition?.adapterConfig ?? {}
    }
    const probeTarget = resolveMacroProbeTarget(probeConfig)
    if (!probeTarget) return undefined
    const applied = applySourceCredential({
      sourceId,
      apiKey,
      url: probeTarget.url,
      body: probeTarget.body,
      method: probeTarget.method
    })
    return {
      url: applied.url,
      method: probeTarget.method,
      body: applied.body,
      headers: probeTarget.headers
    }
  }

  switch (sourceId) {
    case 'cryptopanic': {
      const url = new URL('https://cryptopanic.com/api/v1/posts/')
      url.searchParams.set('auth_token', apiKey)
      url.searchParams.set('public', 'true')
      return { url: url.toString() }
    }
    case 'github-releases':
      return {
        url: 'https://api.github.com/rate_limit',
        headers: { Authorization: `Bearer ${apiKey}` }
      }
    case 'coinmarketcal': {
      if (!endpointUrl) return undefined
      const url = new URL(endpointUrl)
      url.searchParams.set('access_token', apiKey)
      return { url: url.toString() }
    }
    default:
      return endpointUrl ? { url: endpointUrl } : undefined
  }
}
