import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import type { BriefingRegenerateFailure } from './runBriefingRegenerate'
import { runBriefingRegenerate } from './runBriefingRegenerate'
import { summaryFromDocument } from './dailyBriefingPageDerived'
import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'

/**
 * The two actions that spend a model run: "generate this issue" and "regenerate it again".
 *
 * Both call the same service path and report through the same two setters, so the pane and the rail
 * cannot end up describing the outcome differently. Kept out of the page because it is a
 * capability, not layout.
 */
export function useBriefingRunActions(input: Readonly<{
  client: Pick<DailyBriefingClient, 'regenerate'>
  locale: 'zh-CN' | 'en-US'
  /** An unreadable stored zone means the run works on the UTC clock, and says so on screen. */
  zoneInvalid: string | null
  timeZone: string
  setView: (next: DailyBriefingPageViewState | ((current: DailyBriefingPageViewState) => DailyBriefingPageViewState)) => void
  setRegenerating: (busy: boolean) => void
  setRegenerateFailure: (failure: BriefingRegenerateFailure | null) => void
  setEditions: (next: (current: readonly DailyBriefingEditionSummary[]) => readonly DailyBriefingEditionSummary[]) => void
  setCurrentPeriodDate?: (date: string) => void
  /** Read the list again once the run settles: the row must show what just landed. */
  onSettled?: () => void
}>): Readonly<{ regenerate: () => Promise<void>; generateNow: () => void }> {
  const run = (): Promise<DailyBriefingDocument | undefined> => runBriefingRegenerate({
    client: input.client,
    locale: input.locale,
    timeZone: input.zoneInvalid ? 'UTC' : input.timeZone
  }).then((outcome) => {
    if (outcome.kind === 'available') return outcome.document
    input.setRegenerateFailure(outcome.failure)
    return undefined
  })

  return {
    async regenerate() {
      input.setRegenerating(true)
      input.setRegenerateFailure(null)
      const document = await run()
      if (document) {
        input.setView({ status: 'ready', document, kind: 'today' })
        input.setEditions((current) => current.map((edition) => edition.date === document.edition.date ? summaryFromDocument(document) : edition))
      }
      input.setRegenerating(false)
    },
    generateNow() {
      input.setRegenerateFailure(null)
      input.setRegenerating(true)
      void run()
        .then((document) => {
          if (document) {
            input.setView({ status: 'ready', document, kind: 'today' })
            input.setCurrentPeriodDate?.(document.edition.date)
          }
        })
        .finally(() => {
          input.setRegenerating(false)
          input.onSettled?.()
        })
    }
  }
}
