import { useCallback, useEffect, useRef, useState } from 'react'

export const CalendarStatusClockPolicy = Object.freeze({ intervalMs: 60000 })
export function useCalendarStatusClock(now: () => Date): readonly [string, () => void] {
  const clock = useRef(now); clock.current = now
  const [instant, setInstant] = useState(() => now().toISOString())
  const update = useCallback(() => setInstant(clock.current().toISOString()), [])
  useEffect(() => {
    const interval = setInterval(update, CalendarStatusClockPolicy.intervalMs)
    window.addEventListener('focus', update)
    return () => { clearInterval(interval); window.removeEventListener('focus', update) }
  }, [update])
  return [instant, update]
}
