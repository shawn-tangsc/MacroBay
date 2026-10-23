/**
 * The right column's calendar card: how far ahead it looks and how much it shows.
 *
 * Every number here is a product decision, named once so the card, its tests and the plan
 * cannot drift apart. The card is a read-only projection of the calendar the page already
 * queries, so nothing in this file may trigger a fetch of its own.
 */
export const calendarUpcomingPolicy = Object.freeze({
  version: 'marketIntelligenceCalendarCardPolicy.v1',
  /** How many days ahead count as "what to watch". */
  upcomingWindowDays: 7,
  /** Rows shown for the upcoming section. */
  maximumUpcomingRows: 5,
  /**
   * How long an event whose time has passed stays listed while its value is still missing. A
   * print can be late; dropping the row at the scheduled instant removed it from the reader's view
   * exactly when they were waiting for it.
   */
  pendingGraceHours: 2,
  /** How far back a released value still counts as "just moved". */
  releasedWindowDays: 3,
  /** Same-hour events quoted in the agent's context block, so it stays bounded. */
  maximumRelatedRows: 3,
  /** Rows shown for the recently-released section. */
  maximumTodayRows: 3,
  /** High importance gets the marker; both tiers are listed, because the provider's medium
   *  events are most of what the calendar actually shows and hiding them left the card empty. */
  markerImportance: 'high' as const,
  /** Only the top tier is listed: the card is the short list of what is worth watching, and
   *  medium and low events were noise in it. This is also why only high rows carry the dot. */
  visibleImportance: ['high'] as readonly ('high' | 'medium' | 'low')[]
})
