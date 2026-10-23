import { isRegisteredReleaseKey } from '../../../../contracts/macro/macroCalendarReleaseIdentity'

/**
 * The calendar events a same-anchor chart can carry, reduced to what a 169-point plot can say.
 *
 * The chart answers "how much did each line move"; these lines answer "what happened there". They are
 * the same events the calendar page lists, read through the same importance rule, and then reduced
 * three ways because the plot is not a calendar:
 *
 * - **High importance only.** A medium or low event has never explained a five-minute move, and drawing
 *   them turns the plot into a fence.
 * - **One line per minute.** The plot's own bar is five minutes wide; clustering at the minute keeps
 *   events that belong together together without fusing neighbours that do not.
 * - **One line per event.** The same release arrives from the official provider and from the aggregate
 *   one. Both are facts about one event, so the line names one of them — the official one, the same
 *   preference the calendar list sorts by — and counts the sources it stands for.
 *
 * A line is **solid once anything in its minute has been published** and **dashed while all of it is
 * still ahead**: the reader has to be able to tell "that dip was the CPI print" from "the CPI print is
 * in two hours", because only one of them explains a move that already happened.
 */
export const crossAssetEventLinePolicy = Object.freeze({
  importance: 'high' as const,
  /** The plot carries this many lines at most, newest releases first; the rest are counted, not drawn. */
  maximumLines: 24,
  minuteMs: 60_000
})

export type CrossAssetEventLineSource = Readonly<{
  eventKey: string
  titleKey: string
  /** Already resolved to the reader's language: this module never sees the calendar's own vocabulary. */
  title: string
  countryCode: string | null
  importance: 'high' | 'medium' | 'low'
  eventType: 'economic-indicator' | 'financial-event' | 'central-bank-activity'
  lifecycleState: 'scheduled' | 'released' | 'cancelled'
  /** When to draw it: the release instant once published, the scheduled one while it is still ahead. */
  atMs: number
  source: 'official' | 'market'
}>

export type CrossAssetEventLineEvent = Readonly<{
  eventKey: string
  title: string
  countryCode: string | null
  eventType: CrossAssetEventLineSource['eventType']
  lifecycleState: CrossAssetEventLineSource['lifecycleState']
  /**
   * 这条来自哪条路线。行内事件带着它，页面才能选"官方那份"作为记录对象（设计 140 §3.2）——
   * 此前它只存在于归并的输入类型上，行本身丢了它，页面就只能按标题顺序挑。
   */
  source: CrossAssetEventLineSource['source']
}>

export type CrossAssetEventLine = Readonly<{
  atMs: number
  events: readonly CrossAssetEventLineEvent[]
  /** True once any event in this line has been published: drawn solid, otherwise dashed. */
  published: boolean
  /** What the tooltip reads: the names, and how many there are when there is more than one. */
  label: string
  /** How many provider reports this line stands for, so a merged event can say it came from both. */
  sources: number
  /**
   * 这一分钟里 provider 的发布**没能**与官方那条建立身份（映射缺失或歧义），两条因此都保留。
   *
   * 是读者可见的痕迹，不是内部标志：两个名字同时出现在一条线上时，读者要能看到"没确认是同一件事"，
   * 而不是自己猜为什么同一次发布有两个名字（设计 145 §8 B）。
   */
  identityUnconfirmed: boolean
}>

export type CrossAssetEventLinesResult = Readonly<{ lines: readonly CrossAssetEventLine[]; collapsed: number }>

/** The title as a dedupe key: spacing, case and punctuation are not what makes two events different. */
function normalizedTitle(title: string): string {
  return title.replace(/[\s·・:：,，.。/／-]/g, '').toLowerCase()
}

/**
 * 同一分钟里"什么算同一条发布"。
 *
 * **已注册**的发布按官方键认（设计 145 §8 B），不按措辞：两条路线对同一次发布的叫法不同，比措辞会把
 * 一条发布画两次；而比"同国同时刻"会把同在 8:30 ET 的 CPI、PPI、零售销售并成一条。其余事件仍是原来
 * 的措辞规则——provider 的长尾发布没有官方键，同一分钟里同名的两条就是同一条。
 */
function lineIdentity(event: CrossAssetEventLineSource): string {
  return isRegisteredReleaseKey(event.titleKey) ? event.titleKey : normalizedTitle(event.title)
}

/** The minute an instant belongs to, as the identity the clustering uses. */
function minuteOf(atMs: number): number {
  return Math.floor(atMs / crossAssetEventLinePolicy.minuteMs)
}

export function crossAssetEventLines(input: Readonly<{
  events: readonly CrossAssetEventLineSource[]
  fromMs: number
  toMs: number
}>): CrossAssetEventLinesResult {
  const inWindow = input.events.filter(event =>
    event.importance === crossAssetEventLinePolicy.importance && event.atMs >= input.fromMs && event.atMs <= input.toMs)

  // Dedupe first, inside each minute: the official report of an event and the aggregate report of the
  // same event are one line, and the official one is the one named — the source a reader can check.
  const byIdentity = new Map<string, { representative: CrossAssetEventLineSource; sources: number }>()
  for (const event of inWindow) {
    const identity = `${minuteOf(event.atMs)}:${event.countryCode ?? ''}:${lineIdentity(event)}`
    const existing = byIdentity.get(identity)
    if (!existing) {
      byIdentity.set(identity, { representative: event, sources: 1 })
      continue
    }
    const preferred = existing.representative.source === 'official' || event.source !== 'official' ? existing.representative : event
    byIdentity.set(identity, { representative: preferred, sources: existing.sources + 1 })
  }

  const clusters = new Map<number, { atMs: number; entries: { event: CrossAssetEventLineSource; sources: number }[] }>()
  for (const { representative, sources } of byIdentity.values()) {
    const minute = minuteOf(representative.atMs)
    const cluster = clusters.get(minute) ?? { atMs: minute * crossAssetEventLinePolicy.minuteMs, entries: [] }
    cluster.entries.push({ event: representative, sources })
    clusters.set(minute, cluster)
  }

  const candidates = [...clusters.values()].map(cluster => {
    const events = [...cluster.entries]
      .sort((left, right) => left.event.title.localeCompare(right.event.title))
      .map(({ event }) => Object.freeze({
        eventKey: event.eventKey, title: event.title, countryCode: event.countryCode,
        eventType: event.eventType, lifecycleState: event.lifecycleState, source: event.source
      }))
    const published = cluster.entries.some(({ event }) => event.lifecycleState === 'released')
    const sources = cluster.entries.reduce((total, entry) => total + entry.sources, 0)
    // 这一分钟里官方与 provider 都在，而 provider 那条没有官方身份（映射缺失或歧义）：两条都保留，
    // 并把"没确认是同一件事"说出来——痕迹留在线上，见 `identityUnconfirmed`。
    const identityUnconfirmed =
      cluster.entries.some(({ event }) => event.source === 'official') &&
      cluster.entries.some(({ event }) => event.source === 'market' && !isRegisteredReleaseKey(event.titleKey))
    const label = events.length === 1 ? events[0]!.title : `${events.map(item => item.title).join('、')}（${events.length}）`
    return Object.freeze({ atMs: cluster.atMs, events: Object.freeze(events), published, label, sources, identityUnconfirmed })
  })

  if (candidates.length <= crossAssetEventLinePolicy.maximumLines) {
    return Object.freeze({ lines: Object.freeze(candidates.sort((left, right) => left.atMs - right.atMs)), collapsed: 0 })
  }
  // What already happened comes first when the plot cannot carry everything: a release explains the move
  // beside it, while a wall of scheduled events only says the calendar is busy.
  const kept = [...candidates]
    .sort((left, right) => Number(right.published) - Number(left.published) || left.atMs - right.atMs)
    .slice(0, crossAssetEventLinePolicy.maximumLines)
    .sort((left, right) => left.atMs - right.atMs)
  return Object.freeze({ lines: Object.freeze(kept), collapsed: candidates.length - kept.length })
}
