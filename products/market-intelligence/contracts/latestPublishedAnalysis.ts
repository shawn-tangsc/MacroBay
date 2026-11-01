/**
 * The newest published analysis node, shared by the conclusion card and the daily-briefing service.
 *
 * Both surfaces read the same timeline page shape but live in different processes, so this selector
 * takes the two fields it needs instead of a renderer-only type. One implementation keeps the card
 * and the briefing from disagreeing about which conclusion is "latest".
 */
export type LatestPublishedCandidate = Readonly<{ status: string; kind: string }>

export function selectLatestPublishedEntry<T extends LatestPublishedCandidate>(
  entries: readonly T[]
): T | undefined {
  return entries.find((entry) => entry.status === 'published' && (entry.kind === 'analysis' || entry.kind === 'review'))
}
