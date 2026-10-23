// Product-owned public boundary for the *sources behind* the dashboard's 市场状态 / 跨市场 rows.
//
// The 来源状态 strip used to have one line for the macro provider, so a credentialed source that had
// no key, was switched off, or had failed read exactly like one that was working — and the dollar row
// silently answered from the synthesis. This boundary carries the three facts the renderer cannot
// read for itself, per source: whether the reader enabled it, whether a credential is stored, and the
// code of the last *terminal* failure.
//
// Two rules keep this payload safe to print:
//
// 1. `hasCredential` is a boolean. No key, no masked preview and no credential reference crosses.
// 2. `failureCode` is a member of the frozen list below. A note that says anything else — a provider
//    message, a URL, a key — is dropped rather than forwarded, so a failure line can never leak the
//    material it failed with.
const dashboardFeedStatusFailureCodes = Object.freeze([
  'credential-missing', 'credential-rejected', 'credential-invalid', 'credential-not-configured',
  'plan-restricted', 'rate-limited', 'transport-unavailable', 'request-timeout',
  'response-invalid', 'response-unavailable', 'authentication-failed', 'decryption-failed'
] as const)

/** The sources that really feed the dashboard's macro and cross-asset rows, and no others. */
const dashboardFeedSourceIds = Object.freeze([
  'realmarketapi-market', 'twelve-data-market', 'fred-rates-liquidity'
] as const)

export const dashboardFeedStatusPublicPolicy = Object.freeze({
  method: 'intelligence.macro.dashboardFeedStatus.query',
  sourceIds: dashboardFeedSourceIds,
  failureCodes: dashboardFeedStatusFailureCodes,
  /**
   * The macro-market store's own notes, per source. A note key is store data, never provider data:
   * the collector writes it on every tick, success or failure, which is what makes it the honest
   * answer to "did the last collection work?".
   */
  notesBySource: Object.freeze({
    'realmarketapi-market': Object.freeze({
      outcome: 'realmarketapi.lastOutcome',
      failureCode: 'realmarketapi.lastFailureCode',
      // Written only after points were actually appended, so it is a success time and not a run time.
      lastSuccessAtMs: 'realmarketapi.lastRunAtMs'
    }),
    'twelve-data-market': Object.freeze({ lastSuccessAtMs: 'lastRunAtMs' }),
    'fred-rates-liquidity': Object.freeze({})
  }),
  /** `unavailable:<code>` is the one outcome spelling that names a failure. */
  unavailableOutcomePrefix: 'unavailable:',
  maximumSources: 3,
  maximumSnapshotBytes: 4 * 1024
} as const)

export type DashboardFeedSourceId = typeof dashboardFeedSourceIds[number]
export type DashboardFeedFailureCode = typeof dashboardFeedStatusFailureCodes[number]

/**
 * One source's readiness. `enabled` and `hasCredential` are the two switches the collector reads, so
 * a row can say 未配置 / 已配置未启用 instead of guessing from an empty store. `lastSuccessAtMs` and
 * `failureCode` are the last collection's own evidence, when the source keeps any.
 */
export type DashboardFeedSourceStatus = Readonly<{
  sourceId: DashboardFeedSourceId
  enabled: boolean
  hasCredential: boolean
  lastSuccessAtMs?: number
  failureCode?: DashboardFeedFailureCode
}>

export type DashboardFeedStatusView =
  | Readonly<{ state: 'available'; sources: readonly DashboardFeedSourceStatus[] }>
  | Readonly<{ state: 'unavailable' }>

/** The one admitted request shape: no arguments at all — the status is product-wide. */
export function isDashboardFeedStatusQuery(value: unknown): value is Record<string, never> {
  try {
    return plainRecord(value) && Reflect.ownKeys(value).length === 0
  } catch { return false }
}

/**
 * Sanitises the status at both ends of the wire. An entry outside the admitted shape, a source this
 * boundary does not serve, a duplicate source or an unlisted failure code fails the whole answer to
 * `unavailable` — the strip then says it cannot read the sources rather than dressing a guess as one.
 */
export function parseDashboardFeedStatus(value: unknown): DashboardFeedStatusView | undefined {
  try {
    if (!plainRecord(value)) return undefined
    if (value.state === 'unavailable') return exactFields(value, ['state']) ? Object.freeze({ state: 'unavailable' as const }) : undefined
    if (value.state !== 'available') return undefined
    if (!exactFields(value, ['state', 'sources'])) return undefined
    const sources = value.sources
    if (!Array.isArray(sources) || sources.length > dashboardFeedStatusPublicPolicy.maximumSources) return undefined
    const parsed: DashboardFeedSourceStatus[] = []
    for (const entry of sources) {
      const source = parseSource(entry)
      if (!source) return undefined
      if (parsed.some(candidate => candidate.sourceId === source.sourceId)) return undefined
      parsed.push(source)
    }
    const view = Object.freeze({ state: 'available' as const, sources: Object.freeze(parsed) })
    return new TextEncoder().encode(JSON.stringify(view)).byteLength <= dashboardFeedStatusPublicPolicy.maximumSnapshotBytes ? view : undefined
  } catch { return undefined }
}

function parseSource(value: unknown): DashboardFeedSourceStatus | undefined {
  if (!exactFields(value, ['sourceId', 'enabled', 'hasCredential'], ['lastSuccessAtMs', 'failureCode'])) return undefined
  const sourceId = value.sourceId
  if (typeof sourceId !== 'string' || !(dashboardFeedSourceIds as readonly string[]).includes(sourceId)) return undefined
  if (typeof value.enabled !== 'boolean' || typeof value.hasCredential !== 'boolean') return undefined
  if (Object.hasOwn(value, 'lastSuccessAtMs') && !(Number.isSafeInteger(value.lastSuccessAtMs) && (value.lastSuccessAtMs as number) >= 0)) return undefined
  if (Object.hasOwn(value, 'failureCode') && !isFailureCode(value.failureCode)) return undefined
  return Object.freeze({
    sourceId: sourceId as DashboardFeedSourceId,
    enabled: value.enabled,
    hasCredential: value.hasCredential,
    ...(value.lastSuccessAtMs === undefined ? {} : { lastSuccessAtMs: value.lastSuccessAtMs as number }),
    ...(value.failureCode === undefined ? {} : { failureCode: value.failureCode as DashboardFeedFailureCode })
  })
}

export function isFailureCode(value: unknown): value is DashboardFeedFailureCode {
  return typeof value === 'string' && (dashboardFeedStatusFailureCodes as readonly string[]).includes(value)
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
  return Object.getOwnPropertySymbols(value).length === 0 &&
    Object.getOwnPropertyNames(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return Boolean(descriptor && 'value' in descriptor)
    })
}

/** Own data fields only: no accessors, no symbols, no extra caller fields. */
function exactFields(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!plainRecord(value)) return false
  const keys = Reflect.ownKeys(value)
  return required.every(key => keys.includes(key)) && keys.every(key => typeof key === 'string' && (required.includes(key) || optional.includes(key)))
}
