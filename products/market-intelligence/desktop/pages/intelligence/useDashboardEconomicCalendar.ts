import { useEffect, useRef, useState } from 'react'

import type { MacroEconomicCalendarClient } from '../../features/macro/economic-calendar'
import {
  dashboardEconomicCalendarPolicy,
  selectDashboardEconomicCalendarMonth,
  type DashboardEconomicCalendarState
} from './dashboardEconomicCalendarModel'
import { trackQuietRevision, useDataChangeRevision } from './useDataChangeRevision'

type Input = {
  client: Pick<MacroEconomicCalendarClient, 'queryMonth'>
  now: () => Date
}

/**
 * The calendar source row's state.
 *
 * One current-month read is enough now that the row only reports whether the month is readable;
 * the previous/next fallbacks existed to fill release groups the dashboard no longer renders.
 */
export function useDashboardEconomicCalendar({ client, now }: Input): DashboardEconomicCalendarState {
  const [state, setState] = useState<DashboardEconomicCalendarState>({ state: 'loading' })
  const [mountInput] = useState(() => ({ client, now }))
  // 日历月读口自己订自己的面板：这一屏与日历卡共用同一个 hook，订阅跟着读口走一处。
  const revision = useDataChangeRevision({ panel: 'economic-calendar' })
  const revisionRef = useRef<number | undefined>(revision)

  useEffect(() => {
    let active = true
    const quiet = trackQuietRevision(revisionRef, revision)
    const asOf = readCanonicalClock(mountInput.now)
    if (!asOf) {
      // 我们自己的时钟坏了：读者看到的仍是「日程读不到」，日志里留一行给排查（不带任何数据）。
      console.error('[dashboard] economic calendar row: the clock is not a canonical instant')
      if (!quiet) setState({ state: 'unavailable', cause: 'input-invalid' })
      return () => { active = false }
    }

    const month = asOf.slice(0, 7)
    void Promise.resolve()
      .then(() => mountInput.client.queryMonth({ month, asOf }))
      .then(reply => {
        if (!active) return
        const next = selectDashboardEconomicCalendarMonth(reply, { month, asOf })
        // 只记「我们自己的程序错误」那一种：参数/时钟是我们拼的，坏了要留痕。
        if (next.state === 'unavailable' && next.cause === 'input-invalid') {
          console.error('[dashboard] economic calendar row: the month or the clock is invalid')
        }
        setState(next)
      })
      .catch(() => {
        // 后台重读失败沿用上一次；屏上只有「加载中」时才说读不到。
        if (active) setState(current => quiet && current.state !== 'loading' ? current : { state: 'unavailable', cause: 'query-unavailable' })
      })

    return () => { active = false }
  }, [mountInput, revision])

  return state
}

function isCanonicalUtcMillis(value: string): boolean {
  if (!dashboardEconomicCalendarPolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function readCanonicalClock(now: () => unknown): string | undefined {
  try {
    const instant = now()
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) return undefined
    const asOf = instant.toISOString()
    return isCanonicalUtcMillis(asOf) ? asOf : undefined
  } catch {
    return undefined
  }
}
