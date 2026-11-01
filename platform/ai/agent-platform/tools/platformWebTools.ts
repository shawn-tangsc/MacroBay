import {
  guardExternalContent,
  type ExternalContentMetadata
} from '../channels/ExternalContentGuard'

/**
 * Platform-owned, read-only web search tool for agent sessions.
 *
 * Why this exists: Claude Code's built-in WebSearch is an Anthropic **server tool**
 * (`web_search_20250305`). Third-party Anthropic-compatible endpoints reject that schema with
 * `400 tools.0.input_schema`. Those providers get this function tool instead: an explicit
 * `query`/`maxResults` schema, executed by the platform's `WebSearchService`, so the request body
 * is always a legal function-tool schema for every provider.
 *
 * It is deliberately a **session** opt-in (`allowedTools: ['web_search']`), not an agent default:
 * the product decides when a run may spend web-search budget, exactly like the built-in opt-in.
 */
export const platformWebSearchSessionToolName = 'web_search'
export const platformWebSearchServerKey = 'macrobay_web'
export const platformWebSearchRuntimeName = `mcp__${platformWebSearchServerKey}__${platformWebSearchSessionToolName}`

export function isPlatformWebSearchSessionToolName(name: string): boolean {
  return name === platformWebSearchSessionToolName
}

export function isPlatformWebSearchRuntimeName(name: string): boolean {
  return name === platformWebSearchRuntimeName
}

export type PlatformWebSearchGuardedResult = {
  title: string
  url: string
  content: string
  publishedAt?: string
}

/**
 * The model reads retrieved pages as material it may quote. Each untrusted field is guarded on its
 * own so the tool result stays a single JSON object (adding notice lines around it would break
 * parsing), and the title takes the light form: short fields cannot carry a boundary block and ten
 * results would otherwise grow twenty lines of framing.
 */
export function guardPlatformWebSearchResults(
  results: readonly PlatformWebSearchGuardedResult[],
  providerId: string | undefined
): PlatformWebSearchGuardedResult[] {
  return results.map((result) => {
    const metadata: ExternalContentMetadata = {
      kind: 'web',
      origin: 'search',
      url: result.url,
      ...(providerId ? { providerId } : {})
    }
    return {
      title: guardExternalContent(result.title, metadata, 'light').guardedText,
      url: result.url,
      content: guardExternalContent(result.content, metadata).guardedText,
      ...(result.publishedAt ? { publishedAt: result.publishedAt } : {})
    }
  })
}
