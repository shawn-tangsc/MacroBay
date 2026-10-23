import type { CrossAssetEventLine } from '../../features/industry/cross-asset/crossAssetEventLines'

/**
 * The calendar event the page currently holds as its selection.
 *
 * One shape for every entry that picks one — the calendar's own list, the chart's event line, the
 * clear control — so the Agent column is never bound to something other than what the reader
 * picked last.
 */
export type SelectedCalendarEvent = Readonly<{ eventKey: string; month: string; label: string }>

export const chartEventSelectionPolicy = Object.freeze({
  /**
   * Which event of a line the page records when the line carries more than one.
   *
   * A line is one minute, and a minute can hold several events. A **released** event explains the
   * move the reader was just looking at, so it is the one the drawer opens on; while every event in
   * the line is still ahead, the line's own first event does. The label stays the line's own, which
   * names all of them.
   *
   * 同一行里既有官方行又有 provider 行时，**官方行优先**：读者点开的是他能自己去核对的那一份，
   * 这也与设计 140 §3.2"归并后取官方源作为代表"一致。此前这里取的是排序后的第一个已发布事件，
   * 实测会选到 provider 的副本（独立评审 be5e5e55 的 ④）。
   */
  representative: (line: CrossAssetEventLine) => {
    const released = line.events.filter(event => event.lifecycleState === 'released')
    return released.find(event => event.source === 'official') ?? released[0] ?? line.events[0]
  }
})

/**
 * The selection a chart line stands for.
 *
 * The month is the one the calendar itself scopes a read by — UTC, `YYYY-MM`. When the page has it,
 * it is the month the panel **read the event from**, because that is the month the calendar filed the
 * event under: a release scheduled on the 30th and detected just after midnight belongs to the
 * earlier month, and deriving the month from the instant would send the Agent's facts lookup to a
 * month the event is not in. The instant is the fallback for a caller with no month to give, and it
 * is what the line was drawn on in the first place.
 */
export function chartEventSelection(line: CrossAssetEventLine, month?: string): SelectedCalendarEvent | undefined {
  const representative = chartEventSelectionPolicy.representative(line)
  return representative
    ? Object.freeze({ eventKey: representative.eventKey, month: month ?? new Date(line.atMs).toISOString().slice(0, 7), label: line.label })
    : undefined
}

/**
 * Opening the detail is first and unconditional; recording it is second and additive.
 *
 * A reader clicking a line on the chart asked "what was that", so the drawer is what the click means.
 * Recording the event as the Agent's current context is an extra, and a recorder that fails — an
 * unavailable Agent, a rejected write — must not cost the reader the detail they just asked for.
 */
export function openEventDetailThenRecord<S>(selection: S, open: (selection: S) => void, record: (selection: S) => void): void {
  open(selection)
  try { record(selection) } catch { /* recording is additive: the detail stays open */ }
}
