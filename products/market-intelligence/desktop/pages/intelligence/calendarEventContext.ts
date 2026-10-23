import { calendarUpcomingPolicy } from './calendarUpcomingPolicy'
import type { CalendarCardRow } from './projectUpcomingCalendarCard'

/**
 * The context block the agent receives for the event the reader selected.
 *
 * Pure and display-injected so it can be reasoned about without a clock or a locale. Its one rule
 * is honesty: a value that is not in the data is named as missing rather than omitted quietly or
 * guessed, because the agent's whole job here is to read these numbers and say what they mean.
 */

export type CalendarEventContextText = Readonly<{
  heading: string; state: string; released: string; upcoming: string; cancelled: string
  missing: string; related: string; metric: Readonly<Record<'actual' | 'consensus' | 'previous', string>>
}>

export type CalendarEventContextInput = Readonly<{
  row: CalendarCardRow
  /** Events sharing the row's hour, so the agent can tell a busy hour from a quiet one. */
  related: readonly CalendarCardRow[]
  text: CalendarEventContextText
  /** Display-zone stamp and readable names, injected by the caller. */
  stamp: (row: CalendarCardRow) => string
  name: (titleKey: string) => string
  category: (row: CalendarCardRow) => string
}>

function stateOf(row: CalendarCardRow, text: CalendarEventContextText): string {
  if (row.kind === 'released-changed' && row.actual) return text.released
  return row.at !== null && Date.parse(row.at) < Date.now() ? text.upcoming : text.upcoming
}

/** Named, never invented: only the values the row actually carries appear, and gaps are called out. */
function valuesOf(row: CalendarCardRow, text: CalendarEventContextText): readonly string[] {
  const published = row.kind === 'released-changed'
  const lines: readonly (string | null)[] = [
    row.actual ? `${text.metric.actual} ${row.actual}` : published || row.kind === 'upcoming' ? `${text.metric.actual}：${text.missing}` : null,
    row.consensus ? `${text.metric.consensus} ${row.consensus}` : null,
    row.previous ? `${text.metric.previous} ${row.previous}` : null
  ]
  return lines.filter((line): line is string => line !== null)
}

export function buildCalendarEventContextBlock(input: CalendarEventContextInput): string {
  const { row, related, text, stamp, name, category } = input
  const sameHour = related
    .filter(candidate => candidate.eventKey !== row.eventKey && candidate.at !== null && row.at !== null
      && candidate.at.slice(0, 13) === row.at.slice(0, 13))
    .slice(0, calendarUpcomingPolicy.maximumRelatedRows)
  return [
    `${text.heading}：${stamp(row)} · ${category(row)} · ${name(row.titleKey)}`,
    `${text.state}：${stateOf(row, text)}`,
    ...valuesOf(row, text),
    sameHour.length > 0 ? `${text.related}：${sameHour.map(candidate => name(candidate.titleKey)).join('、')}` : null
  ].filter((line): line is string => line !== null).join('\n')
}
