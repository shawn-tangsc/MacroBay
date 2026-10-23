import { fedFomcOfficialValueProjectionPolicy } from '../../contracts/macro/economicCalendarQueryContracts'

/**
 * Renderer-owned admission and display policy for safe Macro Calendar caveats.
 * The Calendar IPC sanitizer, page boundary, and presentation projection must
 * use this single source of truth. Product maintainers own additions here.
 */
const macroEconomicCalendarCaveatDefinitions = [
  { key: fedFomcOfficialValueProjectionPolicy.revisedCaveat, display: 'visible' },
  { key: 'official-time-not-published', display: 'visible' },
  { key: 'official-timezone-not-published', display: 'visible' },
  { key: 'official-period-not-published-in-ics', display: 'visible' },
  { key: 'manual-ics-import', display: 'visible' },
  { key: 'bls-python-schedule', display: 'visible' },
  // This source-path provenance has no user-facing operational guidance.
  { key: 'bea-official-rss-release-page', display: 'hidden' }
] as const

export type MacroEconomicCalendarCaveat = (typeof macroEconomicCalendarCaveatDefinitions)[number]['key']

const admittedCaveats = macroEconomicCalendarCaveatDefinitions.map((definition) => definition.key)
const visibleCaveats: readonly MacroEconomicCalendarCaveat[] = macroEconomicCalendarCaveatDefinitions
  .filter((definition) => definition.display === 'visible')
  .map((definition) => definition.key)

export const macroEconomicCalendarCaveatPolicy = Object.freeze({
  admittedCaveats: Object.freeze(admittedCaveats),
  visibleCaveats: Object.freeze(visibleCaveats),
  isAdmitted: (value: unknown): value is MacroEconomicCalendarCaveat =>
    typeof value === 'string' && admittedCaveats.includes(value as MacroEconomicCalendarCaveat),
  isVisible: (value: unknown): value is MacroEconomicCalendarCaveat =>
    typeof value === 'string' && visibleCaveats.includes(value as MacroEconomicCalendarCaveat)
})
