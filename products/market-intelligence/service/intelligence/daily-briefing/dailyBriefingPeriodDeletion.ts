/**
 * Deleting one issue of one day: the three brief tables go in one transaction inside the store,
 * then the session links (a different database) are removed. A failure on the session side returns
 * what the brief side removed and says it is partial — the caller can retry the rest, and nobody
 * is told an issue is fully gone when half of it is not.
 *
 * Extracted from the module assembly: the function is business logic with two collaborators, and
 * keeping it there pushed that file past its size baseline.
 */
export type DailyBriefingPeriodDeletion = (input: Readonly<{ date: string; periodId: string }>) => Promise<Readonly<{
  editions: number
  attempts: number
  periodRuns: number
  sessionLinks: number
  allDone: boolean
}>>

type BriefSideCounts = Readonly<{ editions: number; attempts: number; periodRuns: number }>

export function createDailyBriefingPeriodDeletion(deps: Readonly<{
  store: Readonly<{ deletePeriod?: (date: string, periodId: string) => Promise<BriefSideCounts> }>
  links: Readonly<{ deletePeriod: (date: string, periodId: string) => Promise<number> }>
}>): DailyBriefingPeriodDeletion {
  return async function deleteDailyBriefingPeriod(input) {
    const brief = await deps.store.deletePeriod?.(input.date, input.periodId)
    const counts = brief ?? { editions: 0, attempts: 0, periodRuns: 0 }
    let sessionLinks = 0
    let allDone = true
    try {
      sessionLinks = await deps.links.deletePeriod(input.date, input.periodId)
    } catch {
      allDone = false
    }
    return Object.freeze({ ...counts, sessionLinks, allDone })
  }
}
