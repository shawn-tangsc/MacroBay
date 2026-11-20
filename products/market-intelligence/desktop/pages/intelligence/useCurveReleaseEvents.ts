import type { MarketCalendarMonthRead } from './readMarketCalendarMonth'
import { useEffect, useRef, useState } from 'react'

import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'

/**
 * 曲线窗口里已发生的发布/事件，供曲线标注「这一刻动了多少」。
 *
 * 取数只有一条通道：宿主原来读日历用的那个 `readCalendarMonth`（按月、按 asOf）。
 * 这里不新建客户端、不新开 IPC；只是把曲线覆盖的那几个月读一遍，因为页面原有的日历读
 * 只覆盖它自己的窗口（几天），盖不住曲线回溯的 30 天。
 *
 * 读失败按「没有事件」处理：标注是解释层，读不到就少几个圈，不许因此让曲线报错。
 */
export type CurveReleaseEvent = Readonly<{
  at: string
  /** 日历当前语言的完整标题；图上会被换成短名。 */
  label: string
  /** 主 measure 的身份：只用于展示名，不参与资格。 */
  eventNameKey?: string
  /** 这次发布覆盖的全部 metric_key：**资格只看这个列表**。 */
  measureKeys?: readonly string[]
  seriesId?: string
}>

export function useCurveReleaseEvents(input: Readonly<{
  /** 抽屉关着就不读：没人看的东西不花一次请求。 */
  enabled: boolean
  readCalendarMonth?: (month: string, asOf: string) => Promise<MarketCalendarMonthRead | null>
  /**
   * 曲线那次读数的 `asOf`——**不许自己 `new Date()`**。
   *
   * 事件与曲线必须是同一份快照：各取各的「现在」，标注就会对不上它标的那次跳变。
   * 缺席就不读（宁可没有标注，也不拿另一个时钟去凑）。
   */
  asOf?: string
  /** 抽屉当前语言：换语言要重读，否则标注停在旧语言上。 */
  locale?: string
  /** 曲线那次读数：窗口端点从它的序列里取，读数的形状只在这里认识。 */
  reading?: PolicyPathReading
}>): readonly CurveReleaseEvent[] {
  const [events, setEvents] = useState<readonly CurveReleaseEvent[]>([])
  // 读入口放进 ref：页面每次渲染都可能传一个新函数，进依赖会让同一个快照被反复读。
  const reader = useRef(input.readCalendarMonth)
  reader.current = input.readCalendarMonth
  const { enabled, asOf, locale, reading } = input
  const windowStart = reading?.probability?.series?.[0]?.at
  const windowEnd = reading?.probability?.series?.at(-1)?.at
  useEffect(() => {
    const read = reader.current
    if (!enabled || !read || !asOf || !windowStart || !windowEnd) {
      setEvents((previous) => previous.length ? [] : previous)
      return undefined
    }
    const months = monthsBetween(windowStart, windowEnd)
    if (!months.length) return undefined
    let current = true
    // 同一个 asOf + 窗口只读一次：依赖里只有这两个窗口端点、快照与语言。
    void Promise.all(months.map((month) => read(month, asOf).catch(() => null)))
      .then((pages) => {
        if (!current) return
        const next: CurveReleaseEvent[] = []
        for (const page of pages) {
          // 读入口给整页（事件 + 来源状态）；标注只要事件。
          for (const entry of page?.events ?? []) {
            if (!entry || typeof entry !== 'object') continue
            const record = entry as Record<string, unknown>
            const at = typeof record.scheduledAt === 'string' ? record.scheduledAt : ''
            const label = typeof record.title === 'string' ? record.title : ''
            if (!Number.isFinite(Date.parse(at)) || !label) continue
            // 身份字段照抄，不按名字补：没有身份的行由契约那层整条挡掉。
            const eventNameKey = typeof record.eventNameKey === 'string' ? record.eventNameKey : undefined
            const measureKeys = Array.isArray(record.measureKeys)
              ? record.measureKeys.filter((key): key is string => typeof key === 'string')
              : undefined
            const seriesId = typeof record.seriesId === 'string' ? record.seriesId : undefined
            next.push({
              at,
              label,
              ...(eventNameKey ? { eventNameKey } : {}),
              ...(measureKeys && measureKeys.length ? { measureKeys } : {}),
              ...(seriesId ? { seriesId } : {})
            })
          }
        }
        // 同一时刻同名的行只留一条：来源批次的重复不该在图上叠两圈。
        const unique = new Map(next.map((event) => [`${event.at}|${event.label}`, event]))
        setEvents([...unique.values()].sort((left, right) => Date.parse(left.at) - Date.parse(right.at)))
      })
      .catch(() => { if (current) setEvents([]) })
    return () => { current = false }
  }, [enabled, asOf, locale, windowEnd, windowStart])
  return events
}

/** 覆盖这个窗口的所有月份，升序；窗口不可解析时返回空。 */
function monthsBetween(from: string, to: string): readonly string[] {
  const fromMs = Date.parse(from)
  const toMs = Date.parse(to)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return []
  const months: string[] = []
  const cursor = new Date(fromMs)
  cursor.setUTCDate(1)
  while (cursor.getTime() <= toMs) {
    months.push(cursor.toISOString().slice(0, 7))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    if (months.length > 24) break
  }
  return months
}
