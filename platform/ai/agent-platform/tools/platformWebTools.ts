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
