import { useCallback, useEffect, useRef, useState } from 'react'
import { marketCalendarClient, type MarketCalendarClient } from '../../../shared/ipc/marketCalendarClient'
import type { MarketCalendarEvent, MarketCalendarSource, MarketCalendarRefreshResult } from '../../../../contracts/macro/marketCalendarQueryContracts'

// Three selected batches of at most 1000 rows; also bounds pathological empty continuations.
export const marketCalendarReadPolicy = { maximumEvents: 3000, maximumPages: 3000 } as const

/**
 * 某一个月自己的读取结论——**三个月不许合成一个布尔**（2026-11-09）。
 *
 * 原来只有一个 `failure`：命名月读到了、相邻月读失败时它也是 `true`，于是上层拿它挡空态就会把
 * 「相邻月读不到」写成「本月读不到」——同一个错误换个方向犯。每个月各自记账之后，命名月的结论只由
 * 命名月自己决定，相邻月的失败不参与。
 *
 * `not-requested` 也包含「正在读」：读的顺序是命名月先、边缘月后，一个月在它自己的读取落定之前
 * 不进任何结论；「在读」由窗口级的 `loading` 表达，不在这里再造第四个状态。
 */
export type MarketCalendarMonthRead =
  | Readonly<{ status: 'read' }>
  | Readonly<{ status: 'failed'; reason: MarketCalendarMonthFailureReason }>
  | Readonly<{ status: 'not-requested' }>

/**
 * `query-unavailable` / `input-invalid` 是 provider 自己给的码；其余三个是读取这一侧判的：
 * 抛错、超过窗口上限、游标打转。
 */
export type MarketCalendarMonthFailureReason =
  | 'query-unavailable' | 'input-invalid'
  | 'read-threw' | 'too-large' | 'cursor-loop'

export type MarketCalendarMonthReadStates = Readonly<Record<string, MarketCalendarMonthRead>>

const notRequested = (months: readonly string[]): MarketCalendarMonthReadStates =>
  Object.freeze(Object.fromEntries(months.map((month): [string, MarketCalendarMonthRead] => [month, { status: 'not-requested' }])))

/**
 * The provider's calendar for the months a grid draws.
 *
 * `months` is the read window with the page's own month first: that first month is the one a
 * manual refresh targets, the rest are the days the grid's edges borrow. The window exists
 * because a six-week grid draws its neighbours' days: reading only one month left those cells
 * permanently blank.
 */
export function useMarketCalendar({ months, locale, now, client = marketCalendarClient }: {
  months: readonly string[]; locale: 'zh' | 'en'; now: () => Date; client?: MarketCalendarClient
}) {
  const [events, setEvents] = useState<readonly MarketCalendarEvent[]>([])
  const [sources, setSources] = useState<readonly MarketCalendarSource[]>([])
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState(false)
  const [monthStates, setMonthStates] = useState<MarketCalendarMonthReadStates>(() => notRequested(months))
  const [feedback, setFeedback] = useState<MarketCalendarRefreshResult>()
  const generation = useRef(0)
  const scopeGeneration = useRef(0)
  const scopeKey = `${months.join(',')}\n${locale}`
  const scope = useRef({ months, locale, key: scopeKey }); scope.current = { months, locale, key: scopeKey }
  const clock = useRef(now); clock.current = now
  const activeRefresh = useRef(false)
  const mounted = useRef(true)
  const load = useCallback(async () => {
    const id = ++generation.current
    const requested = scope.current
    const asOf = clock.current().toISOString()
    setLoading(true); setFailure(false)
    // 这一次读取的逐月账本：先整月记成「未请求」，哪个月落定就改哪个月。
    const states: Record<string, MarketCalendarMonthRead> = Object.fromEntries(
      requested.months.map((month): [string, MarketCalendarMonthRead] => [month, { status: 'not-requested' }]))
    const publish = (): void => setMonthStates({ ...states })
    let inFlight: string | undefined
    publish()
    const accumulated: MarketCalendarEvent[] = []
    const seen = new Set<string>()
    const cursors = new Set<string>()
    let sources: readonly MarketCalendarSource[] = []
    let pages = 0
    // The caller puts the named month first, so its source status is on screen while the edges load.
    try {
      for (const candidate of requested.months) {
        let cursor: string | undefined
        do {
          inFlight = candidate
          const page = await client.queryMonth({ month: candidate, locale: requested.locale, asOf, ...(cursor ? { cursor } : {}) })
          if (id !== generation.current || requested.key !== scope.current.key) return
          if (page.state !== 'available') {
            // 落在这个月自己的账上：命名月失败才算命名月失败，相邻月失败只写在相邻月。
            states[candidate] = { status: 'failed', reason: page.failureCode }
            publish(); setFailure(true); return
          }
          pages += 1
          // The window reads several month pages and a month page is itself paged: an event is
          // kept once, so a repeated row can never be counted or drawn twice.
          const fresh = page.events.filter(event => !seen.has(event.eventKey))
          for (const event of fresh) seen.add(event.eventKey)
          if (accumulated.length + fresh.length > marketCalendarReadPolicy.maximumEvents) {
            states[candidate] = { status: 'failed', reason: 'too-large' }; publish(); setFailure(true); return
          }
          accumulated.push(...fresh)
          if (candidate === requested.months[0]) sources = page.sources
          setEvents([...accumulated]); setSources(sources)
          cursor = page.nextCursor
          if (cursor && pages >= marketCalendarReadPolicy.maximumPages) {
            states[candidate] = { status: 'failed', reason: 'too-large' }; publish(); setFailure(true); return
          }
          if (cursor && cursors.has(`${candidate}\n${cursor}`)) {
            states[candidate] = { status: 'failed', reason: 'cursor-loop' }; publish(); setFailure(true); return
          }
          if (cursor) cursors.add(`${candidate}\n${cursor}`)
        } while (cursor)
        // 这个月的每一页都落定了，才记「读到」。
        states[candidate] = { status: 'read' }; publish()
      }
    } catch {
      if (inFlight !== undefined) { states[inFlight] = { status: 'failed', reason: 'read-threw' }; publish() }
      if (id === generation.current) setFailure(true)
    }
    finally { if (id === generation.current) setLoading(false) }
  }, [client])
  useEffect(() => {
    mounted.current = true
    scopeGeneration.current++
    setEvents([]); setSources([]); setFeedback(undefined); setMonthStates(notRequested(months))
    void load()
    return () => { mounted.current = false; generation.current++ }
  }, [scopeKey, load])
  const refresh = useCallback(async () => {
    if (activeRefresh.current) return
    activeRefresh.current = true; setPending(true)
    const requested = scope.current
    const requestedGeneration = scopeGeneration.current
    const isCurrent = () => mounted.current && requestedGeneration === scopeGeneration.current && requested.key === scope.current.key
    try {
      // A refresh stays one month: it is a provider request the reader asked for, not a window read.
      const result = await client.refresh({ month: requested.months[0]!, locale: requested.locale })
      if (!isCurrent()) return
      setFeedback(result)
      await load()
    } catch { if (isCurrent()) setFailure(true) }
    finally { activeRefresh.current = false; if (mounted.current) setPending(false) }
  }, [client, load])
  const namedMonth = months[0] ?? ''
  return {
    month: namedMonth,
    /**
     * 命名月自己的结论：**上层的「本月是读不到还是确实为空」只读这一格**。相邻月的失败不参与。
     */
    namedMonthState: monthStates[namedMonth] ?? { status: 'not-requested' } as const,
    /** 每个月各自的结论，键是 `YYYY-MM`；未请求（含正在读）的月份是 `not-requested`。 */
    monthStates,
    events, sources, loading, pending, failure, feedback, refresh
  }
}
