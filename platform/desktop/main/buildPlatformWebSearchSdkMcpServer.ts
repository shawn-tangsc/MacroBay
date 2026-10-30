import type { WebSearchResponse } from '../../ai/web-search/contracts/webSearchContracts'
import {
  platformWebSearchServerKey,
  platformWebSearchSessionToolName
} from '../../ai/agent-platform/tools/platformWebTools'
import { jsonSchemaToZod } from '../../ai/agent-platform/tools/jsonSchemaToZod'

type PlatformWebSearchSdkModule = {
  tool?: (
    name: string,
    description: string,
    schema: unknown,
    handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>
  ) => unknown
  createSdkMcpServer?: (input: { name: string; version?: string; tools: unknown[] }) => unknown
}

export type PlatformWebSearchBridge = {
  search: (
    request: Readonly<{ query: string; maxResults?: number }>,
    options?: Readonly<{ signal?: AbortSignal }>
  ) => Promise<WebSearchResponse>
  isReady?: () => Promise<boolean>
}

export type PlatformWebSearchSdkMcpServer = {
  name: string
  server: unknown
}

/** One run may look up at most three events; the model is told the same limit in the prompt. */
export const platformWebSearchMaxCalls = 3
export const platformWebSearchMaxResults = 5
const platformWebSearchTimeoutMs = 20_000

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: {
      type: 'string',
      description: 'Current web search query. One concrete question, not a keyword list.'
    },
    maxResults: {
      type: 'integer',
      minimum: 1,
      maximum: platformWebSearchMaxResults,
      description: `How many results to return (1-${platformWebSearchMaxResults}).`
    },
    asOf: {
      type: 'string',
      description:
        'ISO cutoff for this edition. Results published after it are dropped; pass the edition windowEnd whenever known.'
    }
  },
  required: ['query']
} as const

/**
 * The function-tool counterpart of Claude Code's server-side WebSearch, for providers whose
 * Messages endpoint rejects `web_search_20250305`. It exposes an explicit `query`/`maxResults`
 * schema and executes through the platform `WebSearchService`, so authorization, proxy, provider
 * readiness, cutoff filtering and per-run call budget stay in the platform.
 */
export async function buildPlatformWebSearchSdkMcpServer(input: {
  bridge: PlatformWebSearchBridge
  loadSdkHelpers: () => Promise<PlatformWebSearchSdkModule | null>
}): Promise<PlatformWebSearchSdkMcpServer | null> {
  const sdk = await input.loadSdkHelpers()
  if (!sdk?.tool || !sdk.createSdkMcpServer) return null

  let calls = 0

  const tool = sdk.tool(
    platformWebSearchSessionToolName,
    'Search the web for current, source-backed information. Use it only when a high-impact fact or conclusion is missing; report sources, publication time and the edition cutoff. Do not use it for historical as-of replay.',
    jsonSchemaToZod(inputSchema),
    async (args) => {
      if (calls >= platformWebSearchMaxCalls) {
        return textResult({ state: 'unavailable', reason: 'budget-exhausted' })
      }
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) return textResult({ state: 'unavailable', reason: 'invalid-query' })
      if (input.bridge.isReady && !(await input.bridge.isReady())) {
        return textResult({ state: 'unavailable', reason: 'provider-not-ready' })
      }

      calls += 1
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), platformWebSearchTimeoutMs)
      try {
        const response = await input.bridge.search(
          {
            query,
            maxResults: clampMaxResults(args.maxResults)
          },
          { signal: controller.signal }
        )
        const asOf = typeof args.asOf === 'string' && args.asOf.trim() ? args.asOf.trim() : undefined
        return textResult({
          state: 'available',
          query,
          ...(asOf ? { asOf } : {}),
          providerId: response.providerId,
          results: filterResultsAfterCutoff(response.results, asOf)
        })
      } catch {
        return textResult({ state: 'unavailable', reason: 'search-failed' })
      } finally {
        clearTimeout(timeout)
      }
    }
  )

  return {
    name: platformWebSearchServerKey,
    server: sdk.createSdkMcpServer({
      name: platformWebSearchServerKey,
      version: '1.0.0',
      tools: [tool]
    })
  }
}

export function filterResultsAfterCutoff(
  results: WebSearchResponse['results'],
  asOf: string | undefined
): Array<{ title: string; url: string; content: string; publishedAt?: string }> {
  const cutoff = asOf ? Date.parse(asOf) : Number.NaN
  return results
    .filter((result) => {
      if (!Number.isFinite(cutoff) || !result.publishedAt) return true
      const published = Date.parse(result.publishedAt)
      return !Number.isFinite(published) || published <= cutoff
    })
    .map((result) => ({
      title: result.title,
      url: result.url,
      content: result.content,
      ...(result.publishedAt ? { publishedAt: result.publishedAt } : {})
    }))
}

function clampMaxResults(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return platformWebSearchMaxResults
  return Math.min(platformWebSearchMaxResults, Math.max(1, Math.trunc(value)))
}

function textResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}
