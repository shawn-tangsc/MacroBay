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
