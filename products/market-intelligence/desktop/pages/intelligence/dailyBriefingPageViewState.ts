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
    /**
     * The reload came from a delete, so no read was attempted: an empty pane here means "nothing is
     * left", never "the read failed". The two must not share the unreadable sentence.
     */
    readSkipped?: boolean
  }>
  /** The language tab is a read: this day had no edition written in the language asked for. */
  | Readonly<{ status: 'locale-missing'; locale: 'zh-CN' | 'en-US' }>
  | Readonly<{
    status: 'ready'
    document: DailyBriefingDocument
    kind: 'today' | 'history'
    /** `system` means the settings zone was unusable and the machine's zone stood in. */
    timeZoneSource?: 'settings' | 'system'
  }>
