import { useCallback, useEffect, useRef, useState } from 'react'

import type { MacroEconomicCalendarClient } from '../../../shared/ipc/macroEconomicCalendarClient'
import {
  createEconomicCalendarMonthQuery,
  economicCalendarGridMonths,
  isEconomicCalendarMonth,
  type EconomicCalendarEventView,
  type EconomicCalendarProjection
} from './economicCalendarModel'
import {
  economicCalendarMonthLoadingPolicy,
  toMonthState,
  type EconomicCalendarMonthFailure,
  type EconomicCalendarMonthRead
} from './economicCalendarMonthResult'

/**
 * What the page draws for one month.
 *
 * `projection` is the month's own grid; `events` is the union of the months that grid draws, so
 * the first and last rows can show their own days. `incomplete` is set when a neighbouring month
 * could not be read: the month itself still stands, its edges are just not complete.
 */
export type EconomicCalendarMonthState =
  | { state: 'loading' }
  | { state: 'unavailable'; failureCode: EconomicCalendarMonthFailure }
  | { state: 'available'; projection: EconomicCalendarProjection; events: readonly EconomicCalendarEventView[]; incomplete: boolean; version: number }

/**
 * Loads one month plus the neighbouring months its six-week grid draws.
 *
 * The named month owns the grid: if it cannot be read the page says so. A neighbouring month
 * that fails only costs the edges their rows, and one that never answers is cut off by the
 * budget instead of holding the month that did.
 */
export function useEconomicCalendarMonthWindow({ client, asOf, selectedMonthRef }: {
  client: MacroEconomicCalendarClient
  asOf: string
  /** The month the page is pointing at; a result for any other month is stale. */
  selectedMonthRef: { current: string }
}): { monthState: EconomicCalendarMonthState; loadMonth: (month: string, refresh?: boolean, nextAsOf?: string) => void } {
  const [monthState, setMonthState] = useState<EconomicCalendarMonthState>({ state: 'loading' })
  const mountedRef = useRef(true)
  const operationRef = useRef<{ id: number; month: string } | undefined>(undefined)
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const nextOperationRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (fallbackRef.current) clearTimeout(fallbackRef.current)
    }
  }, [])

  const loadMonth = useCallback((month: string, refresh = false, nextAsOf?: string): void => {
    if (!isEconomicCalendarMonth(month)) return
    const currentOperation = operationRef.current
    if (!refresh && currentOperation?.month === month) return

    const operation = { id: ++nextOperationRef.current, month }
    operationRef.current = operation
    if (fallbackRef.current) clearTimeout(fallbackRef.current)
    fallbackRef.current = undefined
    setMonthState({ state: 'loading' })
    const readAsOf = nextAsOf ?? asOf
    const isCurrentOperation = (): boolean => mountedRef.current && selectedMonthRef.current === month && operationRef.current?.id === operation.id
    /**
     * Every month the grid draws is read, because a cell is drawn whether or not its month was
     * asked for. The named month decides the grid: if it fails the page says so, while a
     * neighbouring month that fails only costs the edges their rows.
     */
    const months = economicCalendarGridMonths(month)
    const reads = new Map<string, EconomicCalendarMonthRead>()
    const finish = (): void => {
      if (fallbackRef.current) clearTimeout(fallbackRef.current)
      fallbackRef.current = undefined
      operationRef.current = undefined
    }
    const applyWindow = (incomplete: boolean): void => {
      const primary = reads.get(month)
      if (!primary || primary.state !== 'available') {
        setMonthState(primary ?? { state: 'unavailable', failureCode: economicCalendarMonthLoadingPolicy.unavailableFailureCode })
        return
      }
      const events = [...primary.projection.events]
      let missing = incomplete
      for (const [candidate, read] of reads) {
        if (candidate === month) continue
        if (read.state === 'available') events.push(...read.projection.events)
        else missing = true
      }
      setMonthState({ state: 'available', projection: primary.projection, events, incomplete: missing, version: operation.id })
    }
    /**
     * A month that answered must not be blanked by a neighbour that never did: the budget first
     * uses what arrived (marked incomplete), and only reports the month unavailable when the
     * month itself is what is missing.
     */
    const settle = (candidate: string, read: EconomicCalendarMonthRead): void => {
      if (!isCurrentOperation()) return
      reads.set(candidate, read)
      // A failed named month has nothing to wait for; the page says so at once.
      if (candidate === month && read.state !== 'available') {
        finish()
        applyWindow(false)
        return
      }
      // One window, one render: the edges are part of the same reading, so the page waits for
      // them. The budget is what keeps a neighbour that never answers from holding the month.
      if (reads.size < months.length) return
      finish()
      applyWindow(false)
    }
    const markIncomplete = (): void => {
      if (!isCurrentOperation()) return
      fallbackRef.current = undefined
      // A month that answered must not be blanked by a neighbour that never did.
      if (reads.has(month)) { finish(); applyWindow(true); return }
      operationRef.current = undefined
      setMonthState({ state: 'unavailable', failureCode: economicCalendarMonthLoadingPolicy.unavailableFailureCode })
    }
    fallbackRef.current = setTimeout(markIncomplete, economicCalendarMonthLoadingPolicy.budgetMs)
    months.forEach((candidate) => {
      const unavailableRead: EconomicCalendarMonthRead = { state: 'unavailable', failureCode: economicCalendarMonthLoadingPolicy.unavailableFailureCode }
      let pending: Promise<unknown>
      try {
        pending = Promise.resolve(client.queryMonth(createEconomicCalendarMonthQuery(candidate, readAsOf)))
      } catch {
        settle(candidate, unavailableRead)
        return
      }
      void pending.then((result) => settle(candidate, toMonthState(result, createEconomicCalendarMonthQuery(candidate, readAsOf))))
        .catch(() => settle(candidate, unavailableRead))
    })
  }, [asOf, client, selectedMonthRef])

  return { monthState, loadMonth }
}
