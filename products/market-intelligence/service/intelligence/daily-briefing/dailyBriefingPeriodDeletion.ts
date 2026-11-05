/**
 * Deleting one edition — one day, one language. The edition row and that language's session links
 * go; the attempts and period runs stay, because they record what happened to the issue, not what
 * one language of it said. A failure on the session side returns what the edition side removed and
 * says it is partial — the caller can retry the rest, and nobody is told an edition is gone when
 * half of it is not.
 *
 * Extracted from the module assembly: the function is business logic with two collaborators, and
 * keeping it there pushed that file past its size baseline.
 */
export type DailyBriefingPeriodDeletion = (input: Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US' }>) => Promise<Readonly<{
  editions: number
  attempts: number
  periodRuns: number
  sessionLinks: number
  /** How many writing sessions themselves were deleted from the session list (not just unlinked). */
  sessions: number
  /** How many issues that day still has; null means this path cannot tell (the UI shows no count). */
  remaining: number | null
  allDone: boolean
}>>

type BriefSideCounts = Readonly<{ editions: number; attempts: number; periodRuns: number }>

export function createDailyBriefingPeriodDeletion(deps: Readonly<{
  store: Readonly<{ deletePeriod?: (date: string, periodId: string, locale: 'zh-CN' | 'en-US') => Promise<BriefSideCounts> }>
  links: Readonly<{
    deletePeriod: (date: string, periodId: string, locale: 'zh-CN' | 'en-US') => Promise<number>
    /** 这一版的会话连接；拿它们去删会话本体，而不是只把连接抹掉。 */
    listByEdition?: (date: string, periodId: string, locale: 'zh-CN' | 'en-US') => Promise<readonly Readonly<{ sessionId: string }>[]>
  }>
  /** 会话列表里的本体：只删连接的话，读者还能在会话列表里看到那一版的写作会话。 */
  deleteAgentSessions?: (sessionIds: string[]) => Promise<unknown>
}>): DailyBriefingPeriodDeletion {
  return async function deleteDailyBriefingPeriod(input) {
    // 先取连接、再删：删完连接就查不到会话 id 了。
    let sessionIds: readonly string[] = []
    try {
      sessionIds = (await deps.links.listByEdition?.(input.date, input.periodId, input.locale) ?? []).map((link) => link.sessionId)
    } catch {
      sessionIds = []
    }
    const brief = await deps.store.deletePeriod?.(input.date, input.periodId, input.locale)
    const counts = brief ?? { editions: 0, attempts: 0, periodRuns: 0 }
    let sessionLinks = 0
    let allDone = true
    let sessions = 0
    if (sessionIds.length > 0 && deps.deleteAgentSessions) {
      try {
        await deps.deleteAgentSessions([...sessionIds])
        sessions = sessionIds.length
      } catch {
        // 连接照删：会话本体没删掉是"一半"，由 allDone 说出来，读者仍能看到这一版已消失。
        allDone = false
      }
    } else if (sessionIds.length > 0) {
      // 宿主没给删除会话的通道：不能假装删了。
      allDone = false
    }
    try {
      sessionLinks = await deps.links.deletePeriod(input.date, input.periodId, input.locale)
    } catch {
      allDone = false
    }
    // 这一版不从存储再读一次剩余期数：读不准的「剩余 N 期」比 null（不知道）更糟。
    return Object.freeze({ ...counts, sessionLinks, sessions, remaining: null, allDone })
  }
}
