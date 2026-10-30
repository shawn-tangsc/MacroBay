import { getIntelligenceAdapter } from '../adapters/adapterRegistry'
import {
  buildBinanceListQueryUrl,
  buildBinanceRequestHeaders,
  isBinanceHtmlSource,
  parseBinanceArticleListResponse
} from '../adapters/binanceAnnouncementsParser'
import { intelligenceHttpRequest } from '../adapters/intelligenceHttpClient'
import { executeIntelligenceFetchTarget } from '../adapters/intelligenceHttpFetch'
import {
  buildOkxAnnouncementsQueryUrl,
  buildOkxAnnouncementsRequestHeaders,
  isOkxAnnouncementsSource,
  parseOkxAnnouncementsResponse
} from '../adapters/okxAnnouncementsParser'
import { resolveMacroProbeTarget } from '../adapters/resolveMacroMetricFetchTargets'
import { isMacroSourceId } from '../application/macroSourceCatalogMetadata'
import type { SourceProfileStore } from '../application/sourceProfileStore'
import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'
import type { IntelligenceCredentialStore } from '../store/intelligenceCredentialStore'

export type SourceConnectionTestResult = {
  ok: boolean
  message: string
  testedAt: string
}

export type SourceConnectionProbeDeps = {
  profileStore: SourceProfileStore
  credentialStore?: IntelligenceCredentialStore
}

export async function probeIntelligenceSourceConnection(
  config: IntelligenceSourceConfig,
  deps?: SourceConnectionProbeDeps
): Promise<SourceConnectionTestResult> {
  const testedAt = new Date().toISOString()

  try {
    if (isBinanceHtmlSource(config.sourceId)) {
      return await probeBinanceConnection(config, testedAt)
    }

    // OKX's help-centre page is a client-rendered shell, so a 200 on `pageUrl` would prove nothing
    // about whether collection works. The probe reads the same announcements endpoint the collector
    // reads and requires it to yield at least one row.
    if (isOkxAnnouncementsSource(config.sourceId)) {
      return await probeOkxAnnouncementsConnection(config, testedAt)
    }

    if (isMacroSourceId(config.sourceId)) {
      return await probeMacroConnection(config, testedAt, deps)
    }

    const adapter = getIntelligenceAdapter(config.sourceId)
    if (!adapter) {
      return { ok: false, message: 'No adapter registered for this source.', testedAt }
    }

    switch (adapter.adapterType) {
      case 'rss-poller':
        return await probeUrlConnection(String(config.adapterConfig.feedUrl ?? ''), config.sourceId, testedAt, 'RSS feed')
      case 'statuspage-poller':
        return await probeUrlConnection(
          String(config.adapterConfig.summaryUrl ?? config.adapterConfig.incidentsUrl ?? ''),
          config.sourceId,
          testedAt,
          'Statuspage endpoint'
        )
      case 'rest-api-poller':
        return await probeUrlConnection(String(config.adapterConfig.endpointUrl ?? ''), config.sourceId, testedAt, 'REST endpoint')
      default:
        return await probeUrlConnection(String(config.adapterConfig.pageUrl ?? ''), config.sourceId, testedAt, 'Source endpoint')
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Connection test failed.',
      testedAt
    }
  }
}

async function probeMacroConnection(
  config: IntelligenceSourceConfig,
  testedAt: string,
  deps?: SourceConnectionProbeDeps
): Promise<SourceConnectionTestResult> {
  const target = resolveMacroProbeTarget(config)
  if (!target) {
    return { ok: false, message: 'Macro request target is not configured.', testedAt }
  }

  try {
    let bodyText: string
    if (deps?.profileStore) {
      bodyText = await executeIntelligenceFetchTarget(target, config.sourceId, {
        profileStore: deps.profileStore,
        credentialStore: deps.credentialStore
      })
    } else {
      const response = await intelligenceHttpRequest(
        {
          url: target.url,
          method: target.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'MacroBay/1.0 (intelligence-connection-test)',
            ...target.headers
          },
          body: target.body,
          timeoutMs: 20_000
        },
        { retryPolicy: { maxAttempts: 1 } }
      )

      if (response.status >= 400) {
        return {
          ok: false,
          message: `Macro probe request failed (HTTP ${response.status}).`,
          testedAt
        }
      }

      bodyText = response.bodyText
    }

    if (!bodyText.trim()) {
      return { ok: false, message: 'Macro probe returned an empty body.', testedAt }
    }

    const label = target.metricKey ?? config.sourceId
    return {
      ok: true,
      message: `Macro probe reachable for ${config.sourceId} (${label}).`,
      testedAt
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Macro probe request failed.',
      testedAt
    }
  }
}

async function probeBinanceConnection(
  config: IntelligenceSourceConfig,
  testedAt: string
): Promise<SourceConnectionTestResult> {
  const response = await intelligenceHttpRequest(
    {
      url: buildBinanceListQueryUrl({ ...config, adapterConfig: { ...config.adapterConfig, pageSize: 1 } }),
      method: 'GET',
      headers: buildBinanceRequestHeaders(config),
      timeoutMs: 20_000
    },
    { retryPolicy: { maxAttempts: 1 } }
  )

  if (response.status >= 400) {
    return {
      ok: false,
      message: `Binance CMS rejected the request (HTTP ${response.status}).`,
      testedAt
    }
  }

  const articles = parseBinanceArticleListResponse(response.bodyText)
  return {
    ok: true,
    message: articles.length > 0 ? `Connected. Latest article: ${articles[0]?.title ?? 'unknown'}.` : 'Connected. CMS responded with no articles.',
    testedAt
  }
}

async function probeOkxAnnouncementsConnection(
  config: IntelligenceSourceConfig,
  testedAt: string
): Promise<SourceConnectionTestResult> {
  const response = await intelligenceHttpRequest(
    {
      url: buildOkxAnnouncementsQueryUrl(config),
      method: 'GET',
      headers: buildOkxAnnouncementsRequestHeaders(config),
      timeoutMs: 20_000
    },
    { retryPolicy: { maxAttempts: 1 } }
  )

  if (response.status >= 400) {
    return {
      ok: false,
      message: `OKX announcements API rejected the request (HTTP ${response.status}).`,
      testedAt
    }
  }

  const announcements = parseOkxAnnouncementsResponse(response.bodyText)
  return {
    ok: announcements.length > 0,
    message:
      announcements.length > 0
        ? `Connected. Latest announcement: ${announcements[0]?.title ?? 'unknown'}.`
        : 'Connected, but OKX returned no announcements.',
    testedAt
  }
}

async function probeUrlConnection(
  url: string,
  sourceId: string,
  testedAt: string,
  label: string
): Promise<SourceConnectionTestResult> {
  if (!url) {
    return { ok: false, message: `${label} URL is not configured.`, testedAt }
  }

  const response = await intelligenceHttpRequest(
    {
      url,
      method: 'GET',
      headers: {
        Accept: '*/*',
        'User-Agent': 'MacroBay/1.0 (intelligence-connection-test)'
      },
      timeoutMs: 20_000
    },
    { retryPolicy: { maxAttempts: 1 } }
  )

  if (response.status >= 400) {
    return {
      ok: false,
      message: `${label} unreachable (HTTP ${response.status}).`,
      testedAt
    }
  }
  // A 3xx means the host answered but the configured path is not the endpoint the collector uses.
  // Saying "empty body" here would send the reader looking for the wrong fault.
  if (response.status >= 300) {
    return {
      ok: false,
      message: `${label} redirected (HTTP ${response.status}); probe the collector's own path instead.`,
      testedAt
    }
  }

  if (!response.bodyText.trim()) {
    return { ok: false, message: `${label} returned an empty body.`, testedAt }
  }

  return {
    ok: true,
    message: `${label} reachable for ${sourceId}.`,
    testedAt
  }
}
