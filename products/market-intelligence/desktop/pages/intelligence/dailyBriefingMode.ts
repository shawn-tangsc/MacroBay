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
  // An edition on screen is content, and **a run does not take it away**: the run reports in the rail
  // and in the right column, while the pane keeps whatever edition the reader asked for. That is the
  // whole point of switching language during a generation — the two facts ("an issue is running" and
  // "which version am I reading") must not lock each other out.
  if (input.viewStatus === 'ready') return input.rowState === 'failed' ? 'ready-with-failure' : 'ready'
  // The reader asked for a version this issue does not have. That answer is about what they asked for,
  // so it survives a run in flight too: the pane says it, the steps keep reporting beside it. A failed
  // attempt still speaks first, because its retry is the reader's next move.
  if (input.viewStatus === 'locale-missing') return input.rowState === 'failed' ? 'failed' : 'locale-missing'
  // A run in flight owns the pane only when there is nothing else to show it.
  if (input.rowState === 'running' || input.viewStatus === 'loading') return 'generating'
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
/**
 * 这一行**自己**的状态：`running` 只看"这一行、这一门语言"的 `generating`，全局布尔不再是输入
 * （它会把别处的运行算到这一版头上，正是"选中了别的版却显示在跑"的根）。
 */
export function briefingRowState(
  row: Readonly<{ availableLocales: readonly string[]; state: string; attemptCount?: number
    languages?: readonly Readonly<{ locale: string; state: string }>[] }> | undefined,
  locale: string
): DailyBriefingRowState {
  if (row?.languages?.some((language) => language.locale === locale && language.state === 'generating')) return 'running'
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
