import type { WebSearchResult, WebSearchStatus } from '../contracts/webSearchContracts'
import {
  normalizeBlacklistDomainPattern,
  normalizeBlacklistDomains
} from '../contracts/webSearchSettings'

export function normalizeWebSearchBlacklist(value: unknown): string[] {
  return normalizeBlacklistDomains(value, [])
}

export type WebSearchBlacklistFilterResult = {
  results: WebSearchResult[]
  status?: WebSearchStatus
}

export function filterWebSearchBlacklist(
  results: WebSearchResult[],
  patterns: string[]
): WebSearchBlacklistFilterResult {
  const normalizedPatterns = patterns.flatMap((pattern) => normalizeBlacklistDomainPattern(pattern) ?? [])
  if (normalizedPatterns.length === 0) return { results }

  const filtered = results.filter((result) => {
    const hostname = getHostname(result.url)
    if (!hostname) return true
    return !normalizedPatterns.some((pattern) => isDomainBlocked(hostname, pattern))
  })

  if (filtered.length === results.length) return { results }
  return {
    results: filtered,
    status: {
      phase: 'blacklist_filtered',
      countBefore: results.length,
      countAfter: filtered.length
    }
  }
}

export function isDomainBlocked(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    return host !== suffix && host.endsWith(`.${suffix}`)
  }
  return host === pattern
}

function getHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return undefined
  }
}
