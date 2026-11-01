import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'

/**
 * Whether the list on screen mixes events.
 *
 * The timeline is a read across event groups, and each sentiment item, macro release or funding
 * move publishes its own conclusion. Two rows a few seconds apart then carry nearly the same
 * bearish sentence, which reads as the same conclusion posted twice. Naming the group on every row
 * answers that — but only where it is needed: scoped to a single group, the caption would repeat
 * on every line and say nothing.
 */
export function timelineSpansGroups(entries: readonly Pick<MarketAnalysisTimelineEntry, 'eventGroupId'>[]): boolean {
  const first = entries[0]?.eventGroupId
  if (first === undefined) return false
  return entries.some(entry => entry.eventGroupId !== first)
}

/**
 * The one-line caption that tells two nearby rows apart, or null when the row has no name.
 *
 * The subject is the group's own name (a news headline, a macro series); the type is its kind. A
 * missing label for the type still leaves a usable caption, and a missing subject leaves none: the
 * row already carries its own conclusion, so a caption of "情绪" alone would only add noise.
 */
export function groupCaptionFor(
  entry: Pick<MarketAnalysisTimelineEntry, 'groupType' | 'groupSubject'>,
  typeLabels: Readonly<Record<string, string>>
): string | null {
  const subject = entry.groupSubject
  if (!subject) return null
  const label = entry.groupType ? typeLabels[entry.groupType] : undefined
  return label ? `${label} · ${subject}` : subject
}
