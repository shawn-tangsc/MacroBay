import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { GenerationTrace } from './dailyBriefingGenerationTrace'

/**
 * What the reading pane is showing. One of these, never a mix: "nothing was ever made" and
 * "this language was not written" are different facts with different actions.
 */
export type DailyBriefingPageViewState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{
    status: 'unavailable'
    failureCode?: string
    generationTrace?: GenerationTrace
  }>
  /**
   * The language tab is a read: this day had no edition written in the language asked for.
   * `historical` marks a past day, where this version cannot write the missing edition at all.
   */
  | Readonly<{ status: 'locale-missing'; locale: 'zh-CN' | 'en-US'; date?: string; historical?: boolean }>
  /**
   * The reader selected a day that has no edition. `failed` separates "the run failed" from "the
   * run never happened": both have nothing to read, and only one of them has a reason to show.
   */
  | Readonly<{ status: 'no-edition'; date: string; failed: boolean; failureCode?: string; generationTrace?: GenerationTrace }>
  | Readonly<{
    status: 'ready'
    document: DailyBriefingDocument
    kind: 'today' | 'history'
    /** `system` means the settings zone was unusable and the machine's zone stood in. */
    timeZoneSource?: 'settings' | 'system'
  }>
