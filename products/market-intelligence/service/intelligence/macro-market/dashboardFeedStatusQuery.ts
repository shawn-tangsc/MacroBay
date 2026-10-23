import {
  dashboardFeedStatusPublicPolicy, isFailureCode,
  type DashboardFeedFailureCode, type DashboardFeedSourceId, type DashboardFeedSourceStatus
} from '../../../contracts/macro/dashboardFeedStatusContracts'

/**
 * Reads, per source, the four facts the dashboard's 来源状态 strip may not invent: the switch, the
 * credential, the last successful collection, and the last *terminal* failure code.
 *
 * Three rules, each of which exists because its absence produced a lie on the strip:
 *
 * 1. `hasCredential` is read through the credential store's safe view — a boolean, never the key.
 * 2. A failure code is admitted only when the source's own outcome note *says* the last tick failed.
 *    A code left behind by an older failure must not outlive the success that followed it.
 * 3. An outcome or code the boundary cannot name is dropped. The provider's message, the URL the key
 *    travelled in and the key itself therefore have no path onto this wire.
 */
export function createDashboardFeedStatusQuery(deps: Readonly<{
  resolveProfile: (sourceId: DashboardFeedSourceId) => Promise<Readonly<{ enabled?: boolean; credentialRef?: string | null }>>
  /** Whether the credential behind a reference is stored. The value, not the key, is what we keep. */
  hasCredential: (credentialRef: string) => Promise<boolean>
  readNote: (key: string) => string | undefined
  /** The generic collector's own health, for a source that keeps no outcome notes (FRED). */
  readHealth?: (sourceId: DashboardFeedSourceId) => Readonly<{ lastSuccessAt?: string; lastFailureAt?: string }> | undefined
}>) {
  async function sourceStatus(sourceId: DashboardFeedSourceId): Promise<DashboardFeedSourceStatus> {
    let enabled = false
    let hasCredential = false
    try {
      const profile = await deps.resolveProfile(sourceId)
      enabled = profile.enabled === true
      hasCredential = profile.credentialRef ? await deps.hasCredential(profile.credentialRef) === true : false
    } catch { /* An unreadable profile is "not enabled, not keyed" rather than an exception. */ }
    const notes = dashboardFeedStatusPublicPolicy.notesBySource[sourceId] as
      Readonly<{ outcome?: string; failureCode?: string; lastSuccessAtMs?: string }> | undefined
    const failureCode = failureCodeOf(notes)
    const lastSuccessAtMs = lastSuccessAtMsOf(notes) ?? healthSuccessMs(sourceId)
    return Object.freeze({
      sourceId, enabled, hasCredential,
      ...(lastSuccessAtMs === undefined ? {} : { lastSuccessAtMs }),
      ...(failureCode === undefined ? {} : { failureCode })
    })
  }

  /** The last tick's own verdict. Only `unavailable:<code>` names a failure; anything else is a success. */
  function failureCodeOf(notes: Readonly<{ outcome?: string; failureCode?: string }> | undefined) {
    if (!notes) return undefined
    const outcome = notes.outcome ? deps.readNote(notes.outcome) : undefined
    if (outcome !== undefined) {
      const prefix = dashboardFeedStatusPublicPolicy.unavailableOutcomePrefix
      return outcome.startsWith(prefix) ? admitted(outcome.slice(prefix.length)) : undefined
    }
    // No outcome note at all: the source predates the note, so its last failure code is the only word.
    return notes.failureCode ? admitted(deps.readNote(notes.failureCode)) : undefined
  }

  function lastSuccessAtMsOf(notes: Readonly<{ lastSuccessAtMs?: string }> | undefined): number | undefined {
    if (!notes?.lastSuccessAtMs) return undefined
    const raw = deps.readNote(notes.lastSuccessAtMs)
    if (raw === undefined) return undefined
    const parsed = Number(raw)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
  }

  function healthSuccessMs(sourceId: DashboardFeedSourceId): number | undefined {
    try {
      const at = deps.readHealth?.(sourceId)?.lastSuccessAt
      const parsed = at === undefined ? Number.NaN : Date.parse(at)
      return Number.isFinite(parsed) ? parsed : undefined
    } catch { return undefined }
  }

  /** One source's readiness; a thrown read collapses to "not enabled, not keyed" rather than failing all. */
  async function status(): Promise<readonly DashboardFeedSourceStatus[]> {
    const sources: DashboardFeedSourceStatus[] = []
    for (const sourceId of dashboardFeedStatusPublicPolicy.sourceIds) sources.push(await sourceStatus(sourceId))
    return Object.freeze(sources)
  }

  return { status }
}

function admitted(value: string | undefined): DashboardFeedFailureCode | undefined {
  return value !== undefined && isFailureCode(value) ? value : undefined
}

export type DashboardFeedStatusQuery = ReturnType<typeof createDashboardFeedStatusQuery>
