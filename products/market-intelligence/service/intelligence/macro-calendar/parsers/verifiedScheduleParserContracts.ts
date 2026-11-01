import type { MacroCalendarLifecycleState, MacroCalendarRevisionKind } from '../macroCalendarContracts'
import type { MacroCalendarOfficialSourceDescriptor } from '../macroCalendarOfficialSourceRegistry'

export type MacroCalendarScheduleDraft = {
  eventKey: string
  releaseGroupKey: string
  eventFamily: 'fomc' | 'cpi' | 'core-cpi' | 'consumer-price-index' | 'employment-situation' | 'pce' | 'core-pce' | 'gdp'
  eventNameKey: string
  periodKey: string
  lifecycleState: MacroCalendarLifecycleState
  revisionKind: MacroCalendarRevisionKind
  scheduledDate: string
  scheduledAt?: string
  /**
   * Whether this meeting publishes projection materials (the SEP / dot plot).
   *
   * The official calendar marks those meetings with a trailing asterisk on the date block, which
   * is the only machine-readable signal on the page; without it a reader cannot tell an ordinary
   * meeting from one that will also move the median path.
   */
  hasProjectionMaterials?: boolean
  providerId: MacroCalendarOfficialSourceDescriptor['providerId']
  descriptorId: MacroCalendarOfficialSourceDescriptor['descriptorId']
  sourceUrl: string
  parserVersion: string
  caveats: string[]
}

export type VerifiedScheduleParserInput = {
  body: string
  descriptor: MacroCalendarOfficialSourceDescriptor
}
