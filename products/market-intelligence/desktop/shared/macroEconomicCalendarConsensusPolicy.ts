import type { MacroEconomicCalendarEventView } from '../../contracts/macro/economicCalendarQueryContracts'

/**
 * Renderer-owned admission policy for the market consensus fields of a public Macro
 * Calendar event. The contract admits a real consensus (the 0xRouter market calendar
 * provides one, the official calendar does not), so a renderer reader must accept any
 * shape-correct value instead of requiring the `null` / `unavailable` /
 * `consensus-unavailable` triple that only the official producer emits. The Calendar IPC
 * sanitizer and the Dashboard boundary share this one source of truth so they cannot drift.
 */
const states: readonly MacroEconomicCalendarEventView['consensusState'][] = ['available', 'unavailable']
const surprises: readonly MacroEconomicCalendarEventView['surprise'][] = ['beat', 'miss', 'inline', 'consensus-unavailable']

export const macroEconomicCalendarConsensusPolicy = Object.freeze({
  states: Object.freeze(states),
  surprises: Object.freeze(surprises),
  isState: (value: unknown): value is MacroEconomicCalendarEventView['consensusState'] =>
    typeof value === 'string' && states.includes(value as MacroEconomicCalendarEventView['consensusState']),
  isSurprise: (value: unknown): value is MacroEconomicCalendarEventView['surprise'] =>
    typeof value === 'string' && surprises.includes(value as MacroEconomicCalendarEventView['surprise'])
})
