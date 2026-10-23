import { useRef, useState } from 'react'

import { macroEconomicCalendarClient } from '../../shared/ipc/macroEconomicCalendarClient'
import type { BlsScheduleFeedback } from './BlsScheduleControls'

export type BlsScheduleSyncState = {
  pending: boolean
  feedback?: { selection: string; result: BlsScheduleFeedback }
  sync: () => Promise<void>
}

const unavailable: BlsScheduleFeedback = { schedule: 'unavailable', cpi: 'unavailable', employment: 'unavailable' }

export function useBlsScheduleSync(selection = 'macro-calendar-bls'): BlsScheduleSyncState {
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ selection: string; result: BlsScheduleFeedback } | undefined>()
  const inFlight = useRef(false)

  async function sync(): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setFeedback(undefined)
    try {
      const response = await macroEconomicCalendarClient.syncBlsEmploymentSchedule({
        year: String(new Date().getUTCFullYear()) as `${number}`
      })
      setFeedback({
        selection,
        result: response.state === 'completed'
          ? { schedule: response.schedule, cpi: response.values.cpi, employment: response.values.employment }
          : unavailable
      })
    } catch {
      setFeedback({ selection, result: unavailable })
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return { pending, feedback, sync }
}
