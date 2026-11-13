import { useEffect, useRef, useState } from 'react'

/**
 * 曲线窗口里已发生的发布/事件，供曲线标注「这一刻动了多少」。
 *
 * 取数只有一条通道：宿主原来读日历用的那个 `readMarketEvents`（按月、按 asOf）。
 * 这里不新建客户端、不新开 IPC；只是把曲线覆盖的那几个月读一遍，因为页面原有的日历读
 * 只覆盖它自己的窗口（几天），盖不住曲线回溯的 30 天。
 *
 * 读失败按「没有事件」处理：标注是解释层，读不到就少几个圈，不许因此让曲线报错。
 */
export type CurveReleaseEvent = Readonly<{ at: string; label: string }>

export function useCurveReleaseEvents(input: Readonly<{
  /** 抽屉关着就不读：没人看的东西不花一次请求。 */
  enabled: boolean
  readMarketEvents?: (month: string, asOf: string) => Promise<readonly unknown[] | null>
  windowStart?: string
  windowEnd?: string
}>): readonly CurveReleaseEvent[] {
  const [events, setEvents] = useState<readonly CurveReleaseEvent[]>([])
  // 窗口是触发条件；asOf 每个时钟滴答都在动，不能进依赖，否则每次渲染都读一遍月页。
  const asOf = useRef(new Date().toISOString())
  asOf.current = new Date().toISOString()
  const { enabled, readMarketEvents, windowStart, windowEnd } = input
  useEffect(() => {
    if (!enabled || !readMarketEvents || !windowStart || !windowEnd) {
      setEvents((previous) => previous.length ? [] : previous)
      return undefined
    }
    const months = monthsBetween(windowStart, windowEnd)
    if (!months.length) return undefined
    let current = true
    const instant = asOf.current
    void Promise.all(months.map((month) => readMarketEvents(month, instant).catch(() => null)))
      .then((pages) => {
        if (!current) return
        const next: CurveReleaseEvent[] = []
        for (const page of pages) {
          for (const entry of page ?? []) {
            if (!entry || typeof entry !== 'object') continue
            const record = entry as Record<string, unknown>
            const at = typeof record.scheduledAt === 'string' ? record.scheduledAt : ''
            const label = typeof record.title === 'string' ? record.title : ''
            if (!Number.isFinite(Date.parse(at)) || !label) continue
            next.push({ at, label })
          }
        }
        // 同一时刻同名的行只留一条：来源批次的重复不该在图上叠两圈。
        const unique = new Map(next.map((event) => [`${event.at}|${event.label}`, event]))
        setEvents([...unique.values()].sort((left, right) => Date.parse(left.at) - Date.parse(right.at)))
      })
      .catch(() => { if (current) setEvents([]) })
    return () => { current = false }
  }, [enabled, readMarketEvents, windowEnd, windowStart])
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
