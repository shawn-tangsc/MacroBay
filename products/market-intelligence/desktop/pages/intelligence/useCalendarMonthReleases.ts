import { useCallback, useEffect, useRef, useState } from 'react'

import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * 抽屉里那一个月的事件：**走宿主已有的那一次日历读**（`readMarketEvents`，按月 + `asOf`）。
 *
 * 不新建客户端、不新开 IPC：抽屉的迷你日历和右列当日列表是同一份数据的两种画法，
 * 各读一次会出现「格子里有点、右列没有」。
 */
export type CalendarMonthReleases = Readonly<{
  state: 'idle' | 'loading' | 'ready' | 'unavailable'
  events: readonly MarketCalendarEvent[]
  /** 只有**手动刷新**才置位：换月也在读，但那时不该把整格换成转圈。 */
  refreshing: boolean
  reload: () => void
}>

export function useCalendarMonthReleases(input: Readonly<{
  enabled: boolean
  month: string
  /**
   * 读快照：与「今天」用同一个时刻，否则格子里的「已发布/待发布」会和日期对不上。
   *
   * **它必须是稳定值。** 传一个每次渲染都重新取的「现在」会让这个 effect 每次都跑——
   * 读操作因此无限重读（真机上反复打接口、界面忽明忽暗）。调用方在挂载时取一次或按分钟节流。
   */
  asOf?: string
  /** 换语言要重读，否则格子里停在旧语言的名字上。 */
  locale?: string
  readMarketEvents?: (month: string, asOf: string) => Promise<readonly unknown[] | null>
}>): CalendarMonthReleases {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [events, setEvents] = useState<readonly MarketCalendarEvent[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)
  // 读入口放进 ref：宿主每次渲染都可能传新函数，进依赖会让同一份快照被反复读。
  const reader = useRef(input.readMarketEvents)
  reader.current = input.readMarketEvents
  const { enabled, month, asOf, locale } = input
  const reload = useCallback(() => { setRefreshing(true); setTick(value => value + 1) }, [])

  useEffect(() => {
    const read = reader.current
    if (!enabled || !read || !asOf) {
      setState('idle')
      setEvents([])
      setRefreshing(false)
      return undefined
    }
    let current = true
    setState('loading')
    void read(month, asOf)
      .then((page) => {
        if (!current) return
        if (page === null) { setState('unavailable'); setEvents([]); return }
        setState('ready')
        setEvents(page.flatMap(marketEventOf))
      })
      .catch(() => { if (current) { setState('unavailable'); setEvents([]) } })
      .finally(() => { if (current) setRefreshing(false) })
    return () => { current = false }
  }, [enabled, month, asOf, locale, tick])

  return { state, events, refreshing, reload }
}

/**
 * 一条线上事件：只认结构，不按名字猜。
 *
 * 宿主那一路（`readMarketCalendarMonth`）已经把整页校验过一遍；这里仍逐字段确认，
 * 是因为这个入参在宿主那头是 `unknown[]`——一条残行混进格子里，就是一条编出来的日程。
 */
/**
 * 一行宿主记录 → 事件。导出只为一件事：**证明 `coverage` 是透传的**（用例在 `useCalendarMonthReleases.test.ts`）。
 */
export function marketEventOf(entry: unknown): readonly MarketCalendarEvent[] {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
  const record = entry as Record<string, unknown>
  const eventKey = typeof record.eventKey === 'string' ? record.eventKey : ''
  const title = typeof record.title === 'string' ? record.title : ''
  const scheduledAt = typeof record.scheduledAt === 'string' ? record.scheduledAt : ''
  if (!eventKey || !title || !Number.isFinite(Date.parse(scheduledAt))) return []
  if (!(marketCalendarPublicPolicy.kinds as readonly unknown[]).includes(record.eventType)) return []
  if (!(marketCalendarPublicPolicy.importance as readonly unknown[]).includes(record.importance)) return []
  if (record.source !== 'Narwhal' && record.source !== '0xRouter') return []
  // 覆盖口径只认这两档；不认识就别把这一行抬进来——**缺省不是「未核验」**，那会把官方行标错。
  if (!(marketCalendarPublicPolicy.coverage as readonly unknown[]).includes(record.coverage)) return []
  const value = (input: unknown): MarketCalendarEvent['consensus'] =>
    input !== null && typeof input === 'object' && typeof (input as { displayValue?: unknown }).displayValue === 'string'
      ? { displayValue: (input as { displayValue: string }).displayValue }
      : null
  return [{
    eventKey,
    title,
    countryCode: typeof record.countryCode === 'string' ? record.countryCode : null,
    ...(typeof record.countryName === 'string' ? { countryName: record.countryName } : {}),
    ...(typeof record.observationKey === 'string' ? { observationKey: record.observationKey } : {}),
    ...(typeof record.eventNameKey === 'string' ? { eventNameKey: record.eventNameKey } : {}),
    ...(typeof record.seriesId === 'string' ? { seriesId: record.seriesId } : {}),
    ...(Array.isArray(record.measureKeys)
      ? { measureKeys: record.measureKeys.filter((key): key is string => typeof key === 'string') }
      : {}),
    eventType: record.eventType as MarketCalendarEvent['eventType'],
    importance: record.importance as MarketCalendarEvent['importance'],
    scheduledAt,
    consensus: value(record.consensus),
    providerPrevious: value(record.providerPrevious),
    providerActual: value(record.providerActual),
    source: record.source,
    sourceObservedAt: typeof record.sourceObservedAt === 'string' ? record.sourceObservedAt : '',
    /* `coverage` **透传**宿主读回来的那一份，不再在这里另推一遍：
       同一份数据两处各贴一个标签，迟早出现「同一条事件两个状态」。
       服务端适配器已经是官方行 `available`、数据商行 `observed-unverified`，这里照抄。 */
    coverage: record.coverage as MarketCalendarEvent['coverage']
  }]
}
