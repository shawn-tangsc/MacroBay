import { useEffect, useState } from 'react'

import type { MacroEconomicCalendarClient } from '../../features/macro/economic-calendar'
import {
  dashboardEconomicCalendarPolicy,
  selectDashboardEconomicCalendarMonth,
  type DashboardEconomicCalendarState
} from './dashboardEconomicCalendarModel'

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

  useEffect(() => {
    let active = true
    const asOf = readCanonicalClock(mountInput.now)
    if (!asOf) {
      // 我们自己的时钟坏了：读者看到的仍是「日程读不到」，日志里留一行给排查（不带任何数据）。
      console.error('[dashboard] economic calendar row: the clock is not a canonical instant')
      setState({ state: 'unavailable', cause: 'input-invalid' })
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
        if (active) setState({ state: 'unavailable', cause: 'query-unavailable' })
      })

    return () => { active = false }
  }, [mountInput])

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
