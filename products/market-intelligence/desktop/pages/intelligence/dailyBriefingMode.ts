import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'

/**
 * What the page is showing, decided once.
 *
 * The row's state, the pane's state and the reader's own run used to be weighed separately in a
 * dozen branches, which is how one screen ended up saying "generating" in the rail and "nothing
 * generated" in the pane. Every surface reads this one answer now: the pane's branches, the switch's
 * selected state, the audit column's visibility and the header action.
 *
 * Six values, no booleans: a boolean could only answer one question, and the rest would stay spread
 * over the callers — which is exactly the shape this function replaces.
 */
export type DailyBriefingMode = 'generating' | 'failed' | 'no-edition' | 'ready' | 'ready-with-failure' | 'locale-missing'

/** The row's own state, as the rail reports it. `published` means it has an edition. */
export type DailyBriefingRowState = 'idle' | 'running' | 'failed' | 'published'

export function resolveBriefingMode(input: Readonly<{
  rowState: DailyBriefingRowState
  viewStatus: 'loading' | 'no-edition' | 'ready' | 'unavailable' | 'locale-missing'
  hasEdition: boolean
  /** Whether the language the reader asked for exists in this issue. */
  localeAvailable: boolean
}>): DailyBriefingMode {
  // A run in flight owns the pane, whoever started it and whatever the local view says.
  if (input.rowState === 'running' || input.viewStatus === 'loading') return 'generating'
  // An edition on screen keeps the pane even when the latest attempt failed: content, not an error.
  if (input.viewStatus === 'ready') return input.rowState === 'failed' ? 'ready-with-failure' : 'ready'
  if (input.rowState === 'failed' || input.viewStatus === 'unavailable') return 'failed'
  // This issue has an edition, just not in the language asked for.
  if (input.hasEdition && !input.localeAvailable) return 'locale-missing'
  return 'no-edition'
}

/** The one place the pane's state is narrowed into a document. */
export function briefingDocument(view: DailyBriefingPageViewState): DailyBriefingDocument | undefined {
  return view.status === 'ready' ? view.document : undefined
}

/** The pane's state as the mode function wants it. */
export function briefingViewStatus(view: DailyBriefingPageViewState): 'loading' | 'no-edition' | 'ready' | 'unavailable' | 'locale-missing' {
  return view.status
}

/** The row's state as the mode function wants it: running wins, then a failure, then an edition. */
export function briefingRowState(row: Readonly<{ availableLocales: readonly string[]; state: string; attemptCount?: number }> | undefined, generating: boolean): DailyBriefingRowState {
  if (generating) return 'running'
  if (row && row.availableLocales.length > 0) return 'published'
  return row?.attemptCount ? 'failed' : 'idle'
}

/** The ready pane's kind, without each caller narrowing the state itself. */
export function readyKind(view: DailyBriefingPageViewState): 'today' | 'history' | undefined {
  return view.status === 'ready' ? view.kind : undefined
}

/** Where the window's zone came from, when the pane is ready. */
export function readyZone(view: DailyBriefingPageViewState): 'settings' | 'system' | undefined {
  return view.status === 'ready' ? view.timeZoneSource : undefined
}

/** Whether the page is still loading; kept here so callers never compare the status themselves. */
export function isBriefingLoading(view: DailyBriefingPageViewState): boolean {
  return view.status === 'loading'
}
