import { useEffect, useRef, useState } from 'react'

/**
 * 这里只需要「什么时候、覆盖哪些指标」两件事——**不造完整事件**。
 *
 * 早先这一路为了填类型，给每条编了 `importance: 'high'`：那是编出来的数据。市场侧的重要性本来就
 * 是占位值，占位值不许再复制到第二条路径上。
 */
export type NextMonthRelease = Readonly<{ scheduledAt: string; measureKeys?: readonly string[] }>

/**
 * 「下次发布」要的那一个月：**本月读里没有未来的同一指标时**才读下一个月。
 *
 * 三条约束（Chief 2026-11-13）：
 * - 只在需要时读——本月已经有未来的同一指标，就不再读下一个月；
 * - 同一个 `asOf` 只读一次——切日期、hover、重渲染都不会再打一次（按 `month|asOf` 记住已读的键）；
 * - 读不到**不等于**没有：`unavailable` 由调用方翻译成「暂时读不到」，不是「没有下一次发布」。
 */
export type NextMonthReleases = Readonly<{
  /** `unavailable` = 这一次真的没读到；它**不等于**「没有下一次发布」。 */
  state: 'idle' | 'loading' | 'ready' | 'unavailable'
  events: readonly NextMonthRelease[]
}>

export function useNextMonthReleases(input: Readonly<{
  enabled: boolean
  month: string
  asOf?: string
  locale?: string
  readMarketEvents?: (month: string, asOf: string) => Promise<readonly unknown[] | null>
}>): NextMonthReleases {
  const [loaded, setLoaded] = useState<Readonly<{ key: string; state: 'ready' | 'unavailable'; events: readonly NextMonthRelease[] }> | undefined>(undefined)
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
          : { key, state: 'ready', events: page.flatMap(nextMonthReleaseOf) })
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
/** 只取「时刻 + 覆盖的指标」，别的字段一概不碰——不为了类型好看去编值。 */
function nextMonthReleaseOf(entry: unknown): readonly NextMonthRelease[] {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
  const record = entry as Record<string, unknown>
  const scheduledAt = typeof record.scheduledAt === 'string' ? record.scheduledAt : ''
  if (!Number.isFinite(Date.parse(scheduledAt))) return []
  const measureKeys = Array.isArray(record.measureKeys)
    ? record.measureKeys.filter((value): value is string => typeof value === 'string')
    : []
  return [{ scheduledAt, ...(measureKeys.length ? { measureKeys } : {}) }]
}
