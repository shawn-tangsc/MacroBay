import type { MacroCalendarEventContextResult } from '../../../service/intelligence/public-query/macroCalendarEventContextQuery'

/**
 * The fact block appended to the question when the reader has an event selected.
 *
 * Reading only, and deliberately blunt about incompleteness: a partial context states that it is
 * partial, and an unavailable one says so instead of shipping an empty list — the agent must know
 * the difference between "nothing happened" and "we hold nothing", or it will narrate the silence.
 */

export type CalendarEventFactContextText = Readonly<{
  factsHeading: string; factsUnavailable: string; factsPartial: string; factsEvidence: string
}>

export function formatCalendarEventFactContext(
  result: MacroCalendarEventContextResult,
  text: CalendarEventFactContextText
): string {
  if (result.coverage === 'unavailable' || result.facts.length === 0) {
    return `[${text.factsHeading}: ${text.factsUnavailable}]`
  }
  const lines = result.facts.map(fact => `${fact.metric} ${fact.value}`)
  if (result.coverage === 'partial') lines.unshift(text.factsPartial)
  if (result.evidenceRefs.length > 0) lines.push(`${text.factsEvidence}: ${result.evidenceRefs.join(', ')}`)
  return `[${text.factsHeading}]\n${lines.join('\n')}`
}
