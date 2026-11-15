import { useCallback, useEffect, useRef, useState } from 'react'

import type { UnmappedCalendarObservation } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarUnmappedMonthRead'
import { marketCalendarClient, type UnmappedMonthView } from '../../shared/ipc/marketCalendarClient'

/**
 * 那个月的**未映射观测**（进不了标准表的那批），只给日历列表用。
 *
 * 三条与读口一致的约束，这里不重新解释、只透传：
 * - 「读不到」是 `state: 'unavailable'`，**不是空数组**——界面据此显示「读不到」而不是 0 条；
 * - 只读派生，不写标准表；
 * - **不进简报、不进 AI 分析**：这个 hook 只被日历列表用（依赖方向由契约 §10 约束）。
 */
export type UnmappedMonth = Readonly<{
  state: 'idle' | 'loading' | 'ready' | 'unavailable'
  entries: readonly UnmappedCalendarObservation[]
  /** 缺日期、进不了月视图的条数（读口给的，不能悄悄丢）。 */
  undated: number
  /** 已被标准表接管的条数（读口已剔除，只报数，供守恒式解释）。 */
  superseded: number
  reload: () => void
}>

const EMPTY: readonly UnmappedCalendarObservation[] = Object.freeze([])

export function useUnmappedMonthObservations(input: Readonly<{
  enabled: boolean
  month: string
  locale: 'zh-CN' | 'en-US'
  /** 换月、刷新、重新打开都要重读；调用方把这个计数 +1 即可。 */
  reloadKey?: number
  read?: (month: string, locale: 'zh-CN' | 'en-US') => Promise<UnmappedMonthView>
}>): UnmappedMonth {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [entries, setEntries] = useState<readonly UnmappedCalendarObservation[]>(EMPTY)
  const [counts, setCounts] = useState<{ undated: number; superseded: number }>({ undated: 0, superseded: 0 })
  const [tick, setTick] = useState(0)
  // 读入口进 ref：调用方每次渲染都可能传新函数，进依赖会让同一份快照被反复读。
  const reader = useRef(input.read)
  reader.current = input.read
  const reload = useCallback(() => setTick((value) => value + 1), [])
  const { enabled, month, locale } = input
  const reloadKey = input.reloadKey ?? 0

  useEffect(() => {
    if (!enabled) {
      setState('idle')
      setEntries(EMPTY)
      setCounts({ undated: 0, superseded: 0 })
      return undefined
    }
    let current = true
    setState('loading')
    const read = reader.current ?? ((nextMonth: string, nextLocale: 'zh-CN' | 'en-US') =>
      marketCalendarClient.queryUnmappedMonth({ month: nextMonth, locale: nextLocale }))
    void read(month, locale)
      .then((view) => {
        if (!current) return
        if (view.state !== 'available') {
          // 读不到：**不**把上一次的结果留在列表里，也**不**报 0 条（那是把没读到画成没有）。
          setState('unavailable')
          setEntries(EMPTY)
          setCounts({ undated: 0, superseded: 0 })
          return
        }
        setState('ready')
        setEntries(view.items)
        setCounts({ undated: view.undated, superseded: view.superseded })
      })
      .catch(() => {
        if (!current) return
        setState('unavailable')
        setEntries(EMPTY)
        setCounts({ undated: 0, superseded: 0 })
      })
    return () => { current = false }
  }, [enabled, month, locale, tick, reloadKey])

  return { state, entries, undated: counts.undated, superseded: counts.superseded, reload }
}
