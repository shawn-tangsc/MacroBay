/**
 * The timeline reads like a phone feed: eight nodes a page, and pulling past the end of what is
 * shown is what brings the next eight in.
 *
 * The page here is a window over what the workspace already read, not a second read of its own. The
 * product hands the workspace up to fifty nodes per cursor, and re-reading in eights would have made
 * the background refresh — which re-reads the first page on a timer and on window focus — collapse a
 * list the reader had pulled through back to the newest eight.
 */
export const analysisTimelinePagingPolicy = Object.freeze({
  pageSize: 8,
  /** How far before the end of the list the pull starts, as the observer's bottom margin. */
  loadAheadPx: 160
})

export type AnalysisTimelineWindow = Readonly<{
  /** How many of the read nodes to render. */
  visible: number
  /** Whether nodes are already read behind the window, so a pull needs no product read. */
  hasUnread: boolean
}>

/** The window over `total` read nodes once the reader has pulled `pages` times. */
export function analysisTimelinePaging(total: number, pages: number): AnalysisTimelineWindow {
  const visible = Math.max(0, Math.min(total, Math.max(0, pages) * analysisTimelinePagingPolicy.pageSize))
  return Object.freeze({ visible, hasUnread: visible < total })
}
