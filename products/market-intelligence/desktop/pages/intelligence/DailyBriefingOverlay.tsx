import { useEffect, useMemo, useRef, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { resolveSystemTimeZone } from '@platform/ui/time/shellTimeFormat'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { dailyBriefingClient, type DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { DailyBriefingDocumentView, type DailyBriefingText } from './DailyBriefingDocumentView'
import { DailyBriefingHistoryRail } from './DailyBriefingHistoryRail'

import './dailyBriefing.css'

type ViewState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'ready'; document: DailyBriefingDocument; kind: 'today' | 'history' }>

export function DailyBriefingOverlay({ open, locale, text, eventTitles, onClose, onConfigureSources, client = dailyBriefingClient }: Readonly<{
  open: boolean
  locale: 'zh-CN' | 'en-US'
  text: DailyBriefingText
  eventTitles?: Record<string, string>
  onClose: () => void
  onConfigureSources?: () => void
  client?: Pick<DailyBriefingClient, 'getToday' | 'list' | 'get'>
}>): React.ReactElement | null {
  const timeZone = useMemo(() => resolveSystemTimeZone(), [])
  const formatTime = useShellTimeFormat()
  const closeRef = useRef<HTMLButtonElement>(null)
  const requestRef = useRef(0)
  const [editions, setEditions] = useState<readonly DailyBriefingEditionSummary[]>([])
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const todayDate = useMemo(() => localDate(timeZone), [timeZone])

  useEffect(() => {
    if (!open) return
    let active = true
    setView({ status: 'loading' })
    setEditions([])
    void (async () => {
      const today = await client.getToday({ locale, timeZone }).catch(() => undefined)
      const listed = await client.list({ locale, timeZone }).catch(() => undefined)
      if (!active) return
      const rows = listed?.state === 'available' ? [...listed.result.editions] : []
      if (today?.state === 'available') {
        const date = today.document.edition.date
        if (!rows.some((row) => row.date === date)) rows.unshift(summaryFromDocument(today.document))
        setView({ status: 'ready', document: today.document, kind: 'today' })
      } else {
        setView({ status: 'unavailable' })
      }
      setEditions(rows.slice(0, 14))
    })()
    return () => { active = false }
  }, [open, locale, timeZone, client, reloadKey])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const selectEdition = (date: string): void => {
    const row = editions.find((edition) => edition.date === date)
    if (!row || row.state === 'missing') return
    if (view.status === 'ready' && view.document.edition.date === date) return
    const request = ++requestRef.current
    setView({ status: 'loading' })
    void client.get({ date, locale })
      .then((result) => {
        if (request !== requestRef.current) return
        setView(result.state === 'available'
          ? { status: 'ready', document: result.document, kind: date === todayDate ? 'today' : 'history' }
          : { status: 'unavailable' })
      })
      .catch(() => { if (request === requestRef.current) setView({ status: 'unavailable' }) })
  }

  if (!open) return null
  const selectedDate = view.status === 'ready' ? view.document.edition.date : undefined
  return <div className="mi-daily-briefing" role="dialog" aria-modal="true" aria-label={text.title}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="mi-daily-briefing__panel">
      <button ref={closeRef} className="mi-daily-briefing__close" type="button" onClick={onClose} aria-label={text.close}>×</button>
      <div className="mi-daily-briefing__layout">
        <DailyBriefingHistoryRail editions={editions} selectedDate={selectedDate} todayDate={todayDate}
          locale={locale} text={text} onSelect={selectEdition} />
        <div className="mi-daily-briefing__content">
          {view.status === 'loading' ? <div className="mi-daily-briefing__state"><LoadingState label={text.loading} minHeight={220} /></div> : null}
          {view.status === 'unavailable' ? <div className="mi-daily-briefing__state" role="alert">
            <h2>{text.title}</h2>
            <p>{text.unavailable}</p>
            <button type="button" onClick={() => setReloadKey((key) => key + 1)}>{text.retry}</button>
          </div> : null}
          {view.status === 'ready' && view.document.status.readingsAvailable === 0 ? <div className="mi-daily-briefing__guide">
            <p>{text.emptyGuide}</p>
            {onConfigureSources ? <button type="button" onClick={onConfigureSources}>{text.configureSources}</button> : null}
          </div> : null}
          {view.status === 'ready' ? <DailyBriefingDocumentView
            document={view.document}
            text={text}
            locale={locale}
            readOnly={view.kind === 'history'}
            {...(eventTitles ? { eventTitles } : {})}
            formatTime={formatTime}
          /> : null}
        </div>
      </div>
    </div>
  </div>
}

function summaryFromDocument(document: DailyBriefingDocument): DailyBriefingEditionSummary {
  return {
    date: document.edition.date,
    locale: document.edition.locale,
    availableLocales: [document.edition.locale],
    state: 'generated',
    generatedAt: document.edition.generatedAt,
    ...(document.conclusion ? { direction: document.conclusion.direction } : {}),
    readingsAvailable: document.status.readingsAvailable,
    windowEnd: document.edition.windowEnd
  }
}

function localDate(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}
