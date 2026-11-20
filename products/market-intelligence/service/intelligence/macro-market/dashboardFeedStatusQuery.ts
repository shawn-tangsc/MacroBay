import {
  dashboardFeedStatusPublicPolicy, isFailureCode,
  type DashboardFeedFailureCode, type DashboardFeedSourceId, type DashboardFeedSourceStatus,
  type DashboardFeedSourceSymbolFailure
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
      Readonly<{ outcome?: string; failureCode?: string; symbolFailures?: string; lastSuccessAtMs?: string }> | undefined
    /**
     * 备注读取与 profile 同形：**失败只影响这一源**。`readNote` 读的是宏行情库的 note，
     * 库损坏/锁住时它会抛错；以前没有保护，一处抛错让整个 `status()` reject，整张源状态表变
     * unavailable，七行被放成「暂时读不到」、所有读请求被门禁挡下（用户 2026-11-11 真机）。
     */
    let failureCode: ReturnType<typeof failureCodeOf>
    let symbolFailures: ReturnType<typeof symbolFailuresOf>
    let lastSuccessAtMs: number | undefined
    try {
      failureCode = failureCodeOf(notes)
      symbolFailures = symbolFailuresOf(notes)
      lastSuccessAtMs = lastSuccessAtMsOf(notes) ?? healthSuccessMs(sourceId)
    } catch {
      failureCode = undefined
      symbolFailures = undefined
      lastSuccessAtMs = undefined
    }
    return Object.freeze({
      sourceId, enabled, hasCredential,
      ...(lastSuccessAtMs === undefined ? {} : { lastSuccessAtMs }),
      ...(failureCode === undefined ? {} : { failureCode }),
      ...(symbolFailures === undefined ? {} : { symbolFailures })
    })
  }

  /**
   * 品种级失败：`DXY:symbol-not-supported,USTEC:…` 这样的列表，采集每轮重写、成功那轮写空串。
   *
   * 它和运行级 `lastOutcome` 是两个问题：那一轮只要有**一只**品种进了库就是 `stored`，另一只被
   * 永久拒绝时不留下任何痕迹。空串是"这一轮没有品种失败"的写法，不是缺失。
   */
  function symbolFailuresOf(notes: Readonly<{ symbolFailures?: string }> | undefined) {
    if (!notes?.symbolFailures) return undefined
    const raw = deps.readNote(notes.symbolFailures)
    if (raw === undefined || raw.trim() === '') return undefined
    const parsed: DashboardFeedSourceSymbolFailure[] = []
    for (const entry of raw.split(',')) {
      const [symbol, code] = entry.trim().split(':')
      if (!symbol || !/^[A-Z0-9]{1,12}$/.test(symbol) || !isFailureCode(code)) continue
      if (parsed.some(candidate => candidate.symbol === symbol)) continue
      parsed.push(Object.freeze({ symbol, failureCode: code }))
      if (parsed.length >= dashboardFeedStatusPublicPolicy.maximumSymbolFailures) break
    }
    return parsed.length === 0 ? undefined : Object.freeze(parsed)
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
