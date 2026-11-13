import { useEffect, useRef, useState } from 'react'

import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * 「下次发布」要的那一个月：**本月读里没有未来的同一指标时**才读下一个月。
 *
 * 三条约束（Chief 2026-11-13）：
 * - 只在需要时读——本月已经有未来的同一指标，就不再读下一个月；
 * - 同一个 `asOf` 只读一次——切日期、hover、重渲染都不会再打一次（按 `month|asOf` 记住已读的键）；
 * - 读不到就是没有：不显示「未提供」，也不猜「12 月之后」。
 */
export type NextMonthReleases = Readonly<{
  /** `unavailable` = 这一次真的没读到；它**不等于**「没有下一次发布」。 */
  state: 'idle' | 'loading' | 'ready' | 'unavailable'
  events: readonly MarketCalendarEvent[]
}>

export function useNextMonthReleases(input: Readonly<{
  enabled: boolean
  month: string
  asOf?: string
  locale?: string
  readMarketEvents?: (month: string, asOf: string) => Promise<readonly unknown[] | null>
}>): NextMonthReleases {
  const [loaded, setLoaded] = useState<Readonly<{ key: string; state: 'ready' | 'unavailable'; events: readonly MarketCalendarEvent[] }> | undefined>(undefined)
  const reader = useRef(input.readMarketEvents)
  reader.current = input.readMarketEvents
  const { enabled, month, asOf, locale } = input
  const key = `${month}|${asOf ?? ''}|${locale ?? ''}`

  useEffect(() => {
    const read = reader.current
    if (!enabled || !read || !asOf || loaded?.key === key) return undefined
    let current = true
    void read(month, asOf)
      .then((page) => {
        if (!current) return
        // `null` 是「没读到」，不是「没有」——两者在卡上必须是两种结果。
        setLoaded(page === null
          ? { key, state: 'unavailable', events: [] }
          : { key, state: 'ready', events: page.flatMap(marketEventOf) })
      })
      .catch(() => { if (current) setLoaded({ key, state: 'unavailable', events: [] }) })
    return () => { current = false }
    // `loaded` 只用来判断「这个键读过了」，不进依赖会让同一份快照反复读。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, asOf, month])

  if (!enabled) return { state: 'idle', events: [] }
  if (loaded?.key !== key) return { state: 'loading', events: [] }
  return { state: loaded.state, events: loaded.events }
}

/** 与列表那一路同一套结构校验：一条残行不能变成一格编出来的日期。 */
function marketEventOf(entry: unknown): readonly MarketCalendarEvent[] {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
  const record = entry as Record<string, unknown>
  const eventKey = typeof record.eventKey === 'string' ? record.eventKey : ''
  const scheduledAt = typeof record.scheduledAt === 'string' ? record.scheduledAt : ''
  if (!eventKey || !Number.isFinite(Date.parse(scheduledAt))) return []
  const measureKeys = Array.isArray(record.measureKeys)
    ? record.measureKeys.filter((value): value is string => typeof value === 'string')
    : []
  return [{
    eventKey,
    title: typeof record.title === 'string' ? record.title : '',
    countryCode: typeof record.countryCode === 'string' ? record.countryCode : null,
    eventType: 'economic-indicator',
    importance: 'high',
    ...(measureKeys.length ? { measureKeys } : {}),
    scheduledAt,
    consensus: null,
    providerPrevious: null,
    providerActual: null,
    source: 'Narwhal',
    sourceObservedAt: typeof record.sourceObservedAt === 'string' ? record.sourceObservedAt : scheduledAt,
    coverage: 'observed-unverified'
  }]
}
