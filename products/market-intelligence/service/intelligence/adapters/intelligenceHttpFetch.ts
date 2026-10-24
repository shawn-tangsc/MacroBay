import { intelligenceHttpRequest } from './intelligenceHttpClient'
import type { MetricFetchTarget } from './resolveMacroMetricFetchTargets'

import { getIntelligenceSourceDefinition } from '../application/sourceCatalog'
import { sourceSupportsCredentials } from '../schema/intelligenceSource'
import type { SourceProfileStore } from '../application/sourceProfileStore'
import type { IntelligenceCredentialStore } from '../store/intelligenceCredentialStore'

const DEFAULT_USER_AGENT = 'MacroBay/1.0 (intelligence-collector; +https://macrobay.app)'

export function createIntelligenceFetchText(deps: {
  profileStore: SourceProfileStore
  credentialStore?: IntelligenceCredentialStore
}): (url: string, sourceId: string) => Promise<string> {
  return async (url, sourceId) => {
    return executeIntelligenceFetchTarget(
      { url, method: 'GET' },
      sourceId,
      deps
    )
  }
}

export async function executeIntelligenceFetchTarget(
  target: MetricFetchTarget,
  sourceId: string,
  deps: {
    profileStore: SourceProfileStore
    credentialStore?: IntelligenceCredentialStore
  }
): Promise<string> {
  const definition = getIntelligenceSourceDefinition(sourceId)
  const headers: Record<string, string> = {
    Accept: '*/*',
    'User-Agent': DEFAULT_USER_AGENT,
    ...target.headers
  }

  let requestUrl = target.url
  let requestBody = target.body
  const method = target.method ?? 'GET'

  if (definition && sourceSupportsCredentials(definition.authMode) && deps.credentialStore) {
    const profile = await deps.profileStore.resolveProfile(sourceId)
    if (profile.credentialRef) {
      const credential = await deps.credentialStore.getByRef(profile.credentialRef)
      if (credential?.apiKey) {
        const applied = applySourceCredential({
          sourceId,
          apiKey: credential.apiKey,
          url: requestUrl,
          body: requestBody,
          method
        })
        requestUrl = applied.url
        requestBody = applied.body
        if (sourceId === 'github-releases') {
          headers.Authorization = `Bearer ${credential.apiKey}`
        }
      }
    }
  }

  const response = await intelligenceHttpRequest(
    {
      url: requestUrl,
      method,
      headers,
      body: requestBody,
      timeoutMs: 30_000
    },
    {
      retryPolicy: { maxAttempts: 3, retryableStatuses: [408, 429, 500, 502, 503, 504] },
      redactHeaders: ['authorization', 'x-api-key']
    }
  )

  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status} while fetching ${sourceId}.`)
  }

  if (!response.bodyText.trim()) {
    throw new Error(`Empty response body while fetching ${sourceId}.`)
  }

  return response.bodyText
}

export function applySourceCredential(input: {
  sourceId: string
  apiKey: string
  url: string
  body?: string
  method?: 'GET' | 'POST'
}): { url: string; body?: string } {
  const apiKey = input.apiKey.trim()
  if (!apiKey) return { url: input.url, body: input.body }

  if (input.sourceId === 'fred-rates-liquidity') {
    const parsed = new URL(input.url)
    parsed.searchParams.set('api_key', apiKey)
    return { url: parsed.toString(), body: input.body }
  }

  if (input.sourceId === 'bea-economic-series') {
    const parsed = new URL(input.url)
    parsed.searchParams.set('UserID', apiKey)
    return { url: parsed.toString(), body: input.body }
  }

  if (input.sourceId === 'bls-economic-series' && input.method === 'POST' && input.body) {
    try {
      const payload = JSON.parse(input.body) as Record<string, unknown>
      return {
        url: input.url,
        body: JSON.stringify({ ...payload, registrationkey: apiKey })
      }
    } catch {
      return { url: input.url, body: input.body }
    }
  }

  if (input.sourceId === 'cryptopanic') {
    const parsed = new URL(input.url)
    parsed.searchParams.set('auth_token', apiKey)
    return { url: parsed.toString(), body: input.body }
  }

  if (input.sourceId === 'coinmarketcal') {
    const parsed = new URL(input.url)
    parsed.searchParams.set('access_token', apiKey)
    return { url: parsed.toString(), body: input.body }
  }

  return { url: input.url, body: input.body }
}
