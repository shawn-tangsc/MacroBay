import { useEffect, useMemo, useRef, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { resolveSystemTimeZone } from '@platform/ui/time/shellTimeFormat'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import { dailyBriefingClient, type DailyBriefingClient, type DailyBriefingClientTodayResult } from '../../shared/ipc/dailyBriefingClient'
import { DailyBriefingDocumentView, type DailyBriefingText } from './DailyBriefingDocumentView'

import './dailyBriefing.css'

export function DailyBriefingOverlay({ open, locale, text, eventTitles, onClose, client = dailyBriefingClient }: Readonly<{
  open: boolean
  locale: 'zh-CN' | 'en-US'
  text: DailyBriefingText
  eventTitles?: Record<string, string>
  onClose: () => void
  client?: Pick<DailyBriefingClient, 'getToday'>
}>): React.ReactElement | null {
  const timeZone = useMemo(() => resolveSystemTimeZone(), [])
  const formatTime = useShellTimeFormat()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [result, setResult] = useState<DailyBriefingClientTodayResult | undefined>()
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!open) return
    let active = true
    setResult(undefined)
    void client.getToday({ locale, timeZone })
      .then((next) => { if (active) setResult(next) })
      .catch(() => { if (active) setResult({ state: 'unavailable', failureCode: 'daily-briefing-request-failed' }) })
    return () => { active = false }
  }, [open, locale, timeZone, client, reloadKey])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null
  return <div className="mi-daily-briefing" role="dialog" aria-modal="true" aria-label={text.title}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="mi-daily-briefing__panel">
      <button ref={closeRef} className="mi-daily-briefing__close" type="button" onClick={onClose} aria-label={text.close}>×</button>
      {!result ? <div className="mi-daily-briefing__state"><LoadingState label={text.loading} minHeight={220} /></div> : null}
      {result?.state === 'unavailable' ? <div className="mi-daily-briefing__state" role="alert">
        <h2>{text.title}</h2>
        <p>{text.unavailable}</p>
        <button type="button" onClick={() => setReloadKey((key) => key + 1)}>{text.retry}</button>
      </div> : null}
      {result?.state === 'available' ? <DailyBriefingDocumentView
        document={result.document}
        text={text}
        locale={locale}
        {...(eventTitles ? { eventTitles } : {})}
        formatTime={formatTime}
      /> : null}
    </div>
  </div>
}
