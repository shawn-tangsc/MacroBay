import { useCallback, useRef, useState } from 'react'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'

/**
 * Deleting one issue from the history rail, and what the page says afterwards.
 *
 * A delete spans two databases, so it can finish on one side and fail on the other. The page must
 * not then say "gone": `remaining` is the real leftover count when the reply carries one, and
 * `null` when nobody can tell — the two are shown differently on purpose.
 *
 * It also carries the one-shot "do not generate" flag: the reload that follows a real delete must
 * read what exists, because calling `getToday` there would generate a fresh edition right after the
 * reader removed one. A failed attempt leaves the flag alone — nothing was deleted, so the reload
 * behaves like any other.
 *
 * Extracted from the page component: the state, the retry target and the sentence around them are
 * one capability, and keeping them inline pushed that file past its size baseline.
 */
export type BriefingIssueTarget = Readonly<{ date: string; periodId: string }>

export type BriefingDeleteOutcome = Readonly<{
  target: BriefingIssueTarget
  /** Rows left behind; null means this path cannot tell, which is not the same as zero. */
  remaining: number | null
}>

export function useDailyBriefingIssueDeletion(deps: Readonly<{
  client: Partial<Pick<DailyBriefingClient, 'deletePeriod'>>
  /** Called after every attempt (including a failed one) so the list can be read again. */
  onSettled: () => void
}>): Readonly<{
  outcome: BriefingDeleteOutcome | null
  deletePeriod: (target: BriefingIssueTarget) => Promise<void>
  /** True once, on the reload a delete asked for; the page reads this before reading today. */
  takeSkipGenerate: () => boolean
}> {
  const [outcome, setOutcome] = useState<BriefingDeleteOutcome | null>(null)
  const skipGenerateOnce = useRef(false)
  const remove = deps.client.deletePeriod
  const onSettled = deps.onSettled
  const deletePeriod = useCallback(async (target: BriefingIssueTarget): Promise<void> => {
    if (!remove) return
    try {
      const result = await remove(target)
      skipGenerateOnce.current = true
      setOutcome(result.allDone ? null : { target, remaining: result.remaining })
    } catch {
      // The call itself failed: which rows remain is unknown, and "unknown" is not zero.
      setOutcome({ target, remaining: null })
    }
    onSettled()
  }, [onSettled, remove])
  const takeSkipGenerate = useCallback(() => {
    const skip = skipGenerateOnce.current
    skipGenerateOnce.current = false
    return skip
  }, [])
  return { outcome, deletePeriod, takeSkipGenerate }
}
