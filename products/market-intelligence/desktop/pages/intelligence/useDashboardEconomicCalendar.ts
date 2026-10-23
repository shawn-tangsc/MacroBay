import { useEffect, useState } from 'react'

import type { MacroEconomicCalendarClient } from '../../features/macro/economic-calendar'
import { shiftEconomicCalendarMonth } from '../../features/macro/economic-calendar'
import {
  dashboardMacroReleaseDynamicsPolicy,
  selectDashboardMacroReleaseDynamicsMonth,
  type DashboardMacroReleaseDynamicsState
} from './dashboardEconomicCalendarModel'

type Input = {
  client: Pick<MacroEconomicCalendarClient, 'queryMonth'>
  now: () => Date
}

export function useDashboardEconomicCalendar({ client, now }: Input): DashboardMacroReleaseDynamicsState {
  const [state, setState] = useState<DashboardMacroReleaseDynamicsState>({ state: 'loading' })
  const [mountInput] = useState(() => ({ client, now }))

  useEffect(() => {
    let active = true
    const asOf = readCanonicalClock(mountInput.now)
    if (!asOf) {
      setState({ state: 'unavailable' })
      return () => { active = false }
    }

    const currentMonth = asOf.slice(0, 7)
    const query = async (): Promise<void> => {
      const current = selectDashboardMacroReleaseDynamicsMonth(await mountInput.client.queryMonth({ month: currentMonth, asOf }), { month: currentMonth, asOf })
      if (!active) return
      if (current.state === 'unavailable') {
        setState({ state: 'unavailable' })
        return
      }

      let upcoming = current.upcoming
      let released = current.released
      if (!released) {
        const previousMonth = shiftEconomicCalendarMonth(currentMonth, -1)
        const previous = selectDashboardMacroReleaseDynamicsMonth(await mountInput.client.queryMonth({ month: previousMonth, asOf }), { month: previousMonth, asOf })
        if (!active) return
        if (previous.state === 'unavailable') {
          setState({ state: 'unavailable' })
          return
        }
        released = previous.released
      }

      if (!upcoming) {
        const nextMonth = shiftEconomicCalendarMonth(currentMonth, 1)
        const next = selectDashboardMacroReleaseDynamicsMonth(await mountInput.client.queryMonth({ month: nextMonth, asOf }), { month: nextMonth, asOf })
        if (!active) return
        if (next.state === 'unavailable') {
          setState({ state: 'unavailable' })
          return
        }
        upcoming = next.upcoming
      }

      setState(upcoming || released ? { state: 'available', ...(upcoming ? { upcoming } : {}), ...(released ? { released } : {}) } : { state: 'empty' })
    }
    void query().catch(() => {
      if (active) setState({ state: 'unavailable' })
    })

    return () => { active = false }
  }, [mountInput])

  return state
}

function isCanonicalUtcMillis(value: string): boolean {
  if (!dashboardMacroReleaseDynamicsPolicy.canonicalUtcMillisPattern.test(value)) return false
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
