import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Settings2 } from 'lucide-react'

import { LoadingState } from '@platform/ui/components/loading'
import { resolveSystemTimeZone } from '@platform/ui/time/shellTimeFormat'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { dailyBriefingToMarkdown } from '../../../contracts/dailyBriefingMarkdown'
import { dailyBriefingClient, type DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { DailyBriefingDocumentView, type DailyBriefingText } from './DailyBriefingDocumentView'
import { DailyBriefingHistoryRail } from './DailyBriefingHistoryRail'
import { DailyBriefingAiSettingsModal } from './DailyBriefingAiSettingsModal'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

import './dailyBriefing.css'

type ViewState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'ready'; document: DailyBriefingDocument; kind: 'today' | 'history' }>

/**
 * The daily brief as its own reading page, not a modal: the dashboard entry navigates here and the
 * page keeps the history rail and report in one full-width surface.
 */
export function DailyBriefingPage({ locale, text, eventTitles, onBack, onConfigureSources, client = dailyBriefingClient }: Readonly<{
  locale: 'zh-CN' | 'en-US'
  text: DailyBriefingText
  eventTitles?: Record<string, string>
  onBack: () => void
  onConfigureSources?: () => void
  client?: Pick<DailyBriefingClient, 'getToday' | 'list' | 'get' | 'regenerate' | 'getSettings' | 'saveSettings'>
}>): React.ReactElement {
  const timeZone = useMemo(() => resolveSystemTimeZone(), [])
  const formatTime = useShellTimeFormat()
  const requestRef = useRef(0)
  const [editions, setEditions] = useState<readonly DailyBriefingEditionSummary[]>([])
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateFailed, setRegenerateFailed] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)
  const todayDate = useMemo(() => localDate(timeZone), [timeZone])

  useEffect(() => {
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
  }, [locale, timeZone, client, reloadKey])

  useEffect(() => () => { if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current) }, [])

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

  const regenerate = async (): Promise<void> => {
    setRegenerating(true)
    setRegenerateFailed(false)
    try {
      const result = await client.regenerate({ locale, timeZone })
      if (result.state === 'available') {
        setView({ status: 'ready', document: result.document, kind: 'today' })
        setEditions((current) => current.map((edition) => edition.date === result.document.edition.date ? summaryFromDocument(result.document) : edition))
      } else {
        setRegenerateFailed(true)
      }
    } catch {
      setRegenerateFailed(true)
    } finally {
      setRegenerating(false)
    }
  }

  const copy = async (): Promise<void> => {
    if (view.status !== 'ready') return
    try {
      const markdown = dailyBriefingToMarkdown(view.document, {
        labels: text,
        locale,
        direction: (term) => localizedDirectionTerm(term, locale),
        ...(eventTitles ? { eventTitle: (item) => item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title } : {}),
        formatTime: (value) => formatTime(value, 'minute')
      })
      if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable')
      await navigator.clipboard.writeText(markdown)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopyState('idle'), 2_000)
  }

  const selectedDate = view.status === 'ready' ? view.document.edition.date : undefined
  return <main className="intelligence-page mi-daily-briefing-page" aria-label={text.title}>
    <header className="mi-daily-briefing-page__bar">
      <button className="mi-daily-briefing-page__back" type="button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={15} />{text.backToDashboard}
      </button>
      <div className="mi-daily-briefing-page__actions">
        {view.status === 'ready' && view.kind === 'today' ? <button className="mi-daily-briefing__regenerate" type="button" disabled={regenerating} onClick={() => void regenerate()}>
          {regenerating ? text.regenerating : text.regenerate}
        </button> : null}
        {view.status === 'ready' ? <button className="mi-daily-briefing__copy" type="button" onClick={() => void copy()} aria-live="polite">
          {copyState === 'copied' ? text.copied : copyState === 'failed' ? text.copyFailed : text.copy}
        </button> : null}
        <button className="mi-daily-briefing__gear" type="button" onClick={() => setSettingsOpen(true)} aria-label={text.aiSettings.open}><Settings2 size={14} aria-hidden="true" /></button>
      </div>
    </header>
    <div className="mi-daily-briefing-page__body">
      <DailyBriefingHistoryRail editions={editions} selectedDate={selectedDate} todayDate={todayDate}
        locale={locale} text={text} formatTime={formatTime} onSelect={selectEdition} />
      <section className="mi-daily-briefing-page__content">
        {view.status === 'loading' ? <div className="mi-daily-briefing__state"><LoadingState label={text.loading} minHeight={220} /></div> : null}
        {view.status === 'unavailable' ? <div className="mi-daily-briefing-page__empty" role="alert">
          {editions.every((edition) => edition.state === 'missing') ? <>
            <h2>{text.noBriefTitle}</h2>
            <p>{text.noBriefBody}</p>
          </> : <>
            <h2>{text.unavailable}</h2>
            <p>{text.unavailableHint}</p>
          </>}
          <div className="mi-daily-briefing-page__empty-actions">
            {onConfigureSources ? <button type="button" className="mi-daily-briefing-page__primary" onClick={onConfigureSources}>{text.configureSources}</button> : null}
            <button type="button" onClick={() => setReloadKey((key) => key + 1)}>{text.retry}</button>
          </div>
        </div> : null}
        {regenerateFailed ? <p className="mi-daily-briefing__settings-error" role="alert">{text.regenerateFailed}</p> : null}
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
      </section>
    </div>
    <DailyBriefingAiSettingsModal open={settingsOpen} text={text} client={client} onClose={() => setSettingsOpen(false)} />
  </main>
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
