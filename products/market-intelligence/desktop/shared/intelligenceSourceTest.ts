import { intelligenceSourcesClient } from './ipc/intelligenceSourcesClient'
import { macroCalendarProviderClient } from './ipc/macroCalendarProviderClient'

type TestableSource = { sourceId: string; kind: string }

export type SourceConnectionResult = { ok: boolean; unsupported?: boolean; failureCode?: string }

/** Network-layer refusals. A rejected credential is deliberately not one of them. */
const networkFailureCodes: ReadonlySet<string> = new Set([
  'transport-unavailable',
  'response-unavailable',
  'request-timeout'
])

function normalize(value: unknown): SourceConnectionResult {
  if (!value || typeof value !== 'object') return { ok: false }
  const record = value as { ok?: unknown; state?: unknown; failureCode?: unknown }
  const failureCode = typeof record.failureCode === 'string' ? record.failureCode : undefined
  return {
    ok: record.ok === true || record.state === 'succeeded',
    ...(failureCode ? { failureCode } : {})
  }
}

/**
 * True only when the provider answered with a transport-level refusal. It answers "is the network
 * reachable", not "is the key right": an invalid or rate-limited key must never be reported as a
 * proxy problem.
 */
export function isNetworkConnectionFailure(result: SourceConnectionResult): boolean {
  return !result.ok && result.unsupported !== true && result.failureCode !== undefined && networkFailureCodes.has(result.failureCode)
}

/**
 * Routes a provider connection test to the service that owns the source.
 * Official Fed/BEA schedules use the provider probe; BLS and product-scheduled
 * market calendars have no interactive probe.
 */
export async function testSourceConnection(source: TestableSource): Promise<SourceConnectionResult> {
  if (source.kind === 'official-calendar') {
    if (source.sourceId === 'macro-calendar-bls' || source.sourceId === 'macro-calendar-coinmarketcal') {
      return { ok: false, unsupported: true }
    }
    return normalize(await macroCalendarProviderClient.testProviderConnection(source.sourceId as never).catch(() => undefined))
  }
  if (source.kind === 'market-calendar') return { ok: false, unsupported: true }
  return normalize(await intelligenceSourcesClient.testConnection(source.sourceId).catch(() => undefined))
}
