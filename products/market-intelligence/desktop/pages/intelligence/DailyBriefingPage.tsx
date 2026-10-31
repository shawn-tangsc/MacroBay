import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Settings2 } from 'lucide-react'
import { toPng } from 'html-to-image'

import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { dailyBriefingToMarkdown } from '../../../contracts/dailyBriefingMarkdown'
import { dailyBriefingClient, type DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { openModelSettings } from '../../shared/navigation/productShellNavigation'
import type { DailyBriefingText } from './dailyBriefingText'
import { DailyBriefingHistoryRail } from './DailyBriefingHistoryRail'
import { DailyBriefingAiSettingsModal } from './DailyBriefingAiSettingsModal'
import { DailyBriefingGenerationSettingsModal } from './DailyBriefingGenerationSettingsModal'
import { withWindowHours } from './dailyBriefingWindowText'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

import './dailyBriefing.css'
import './dailyBriefingShareCard.css'

type ViewState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'unavailable'; failureCode?: string }>
  | Readonly<{ status: 'ready'; document: DailyBriefingDocument; kind: 'today' | 'history' }>

type BriefFailure = Readonly<{
  kind: 'editorial' | 'generation'
  code?: string
  detail?: string
}>

type BriefFailureAdvice = 'model' | 'retryOrModel' | 'retryOrSettings' | 'data' | 'system'

/**
 * The reason a generation stopped is a machine code from the service; the panel shows a readable
 * label and a next step instead. Model/provider failures send the reader to model settings, output
 * failures to a retry, and collection failures to the sources.
 */
function failureAdvice(code: string | undefined): BriefFailureAdvice {
  switch (code) {
    case 'model-unavailable':
    case 'model-not-ready':
    case 'provider-disabled':
    case 'missing-api-key':
      return 'model'
    case 'editorial-timeout':
    case 'agent-turn-output-truncated':
    case 'timeout':
      return 'retryOrModel'
    case 'source-failed':
    case 'candidate-overflow':
    case 'build-failed':
      return 'data'
    case 'store-failed':
    case 'time-invalid':
      return 'system'
    default:
      return 'retryOrSettings'
  }
}

const FAILURE_DETAIL_LIMIT = 160

/**
 * `failureDetail` is model/service text. It is never a place for a stack trace or a credential, and
 * an unbounded string must not stretch the panel: cut a stack, redact key-shaped fragments, then
 * trim to a readable length.
 */
function readableFailureDetail(detail: string | undefined, labels: Readonly<Record<string, string>>): string | undefined {
  if (!detail) return undefined
  const mapped = Object.hasOwn(labels, detail) ? labels[detail] : undefined
  if (mapped) return mapped
  const stackAt = detail.search(/\n\s*at\s/)
  const withoutStack = stackAt >= 0 ? detail.slice(0, stackAt) : detail
  const cleaned = withoutStack
    .replace(/\r?\n/g, ' ')
    .replace(/(?:sk|pk|api|key)[-_][A-Za-z0-9_-]{6,}/gi, '[redacted]')
    .replace(/(Bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return undefined
  return cleaned.length > FAILURE_DETAIL_LIMIT ? `${cleaned.slice(0, FAILURE_DETAIL_LIMIT)}…` : cleaned
}

function briefFailureCodeLabel(code: string | undefined, text: DailyBriefingText): string {
  if (!code) return text.failurePanel.unknownCode
  return (text.aiSettings.failure as Readonly<Record<string, string>>)[code] ?? text.failurePanel.unknownCode
}

/**
 * The daily brief as its own reading page, not a modal: the dashboard entry navigates here and the
 * page keeps the history rail and report in one full-width surface.
 */
export function DailyBriefingPage({ locale, text, eventTitles, onBack, onConfigureSources, onConfigureWebSearch, onOpenModelSettings, client = dailyBriefingClient }: Readonly<{
  locale: 'zh-CN' | 'en-US'
  text: DailyBriefingText
  eventTitles?: Record<string, string>
  onBack: () => void
  onConfigureSources?: () => void
  onConfigureWebSearch?: () => void
  /** Overrides the built-in platform model-service navigation. */
  onOpenModelSettings?: () => void
  client?: Pick<DailyBriefingClient, 'getToday' | 'list' | 'get' | 'regenerate' | 'getSettings' | 'saveSettings'>
}>): React.ReactElement {
  const timeZone = useShellTimeZone()
  const formatTime = useShellTimeFormat()
  const timeZoneRef = useRef(timeZone)
  timeZoneRef.current = timeZone
  const requestRef = useRef(0)
  const emptyGenerateRef = useRef(false)
  const [editions, setEditions] = useState<readonly DailyBriefingEditionSummary[]>([])
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [generationSettingsOpen, setGenerationSettingsOpen] = useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateFailure, setRegenerateFailure] = useState<Readonly<{ code?: string }> | null>(null)
  const [exportState, setExportState] = useState<'idle' | 'exporting' | 'done' | 'failed'>('idle')
  const shareRef = useRef<HTMLDivElement>(null)
  const exportTimer = useRef<number | undefined>(undefined)
  const copyTimer = useRef<number | undefined>(undefined)
  const todayDate = useMemo(() => localDate(timeZone), [timeZone])

  useEffect(() => {
    let active = true
    setView({ status: 'loading' })
    setEditions([])
    setRegenerateFailure(null)
    void (async () => {
      const todayPromise = withDeadline(client.getToday({ locale, timeZone: timeZoneRef.current }), 150_000).catch(() => undefined)
      const listed = await withDeadline(client.list({ locale, timeZone: timeZoneRef.current }), 8_000).catch(() => undefined)
      if (!active) return
      let rows = listed?.state === 'available' ? [...listed.result.editions] : []
      setEditions(rows.slice(0, 14))
      const cachedRow = rows.find((row) => row.date === todayDate && row.state === 'generated')
      if (cachedRow) {
        const cached = await client.get({ date: cachedRow.date, locale }).catch(() => undefined)
        if (active && cached?.state === 'available' && view.status === 'loading') {
          setView({ status: 'ready', document: cached.document, kind: 'today' })
        }
      }
      const today = await todayPromise
      if (!active) return
      if (today?.state === 'available') {
        const date = today.document.edition.date
        rows = rows.some((row) => row.date === date)
          ? rows.map((row) => row.date === date ? summaryFromDocument(today.document) : row)
          : [summaryFromDocument(today.document), ...rows]
        setView({ status: 'ready', document: today.document, kind: 'today' })
        setRegenerateFailure(null)
      } else {
        setView({
          status: 'unavailable',
          ...(today?.state === 'unavailable' ? { failureCode: today.failureCode } : {})
        })
        if (emptyGenerateRef.current) {
          setRegenerateFailure({
            ...(today?.state === 'unavailable' ? { code: today.failureCode } : {})
          })
        }
      }
      emptyGenerateRef.current = false
      setEditions(rows.slice(0, 14))
      setRegenerating(false)
    })()
    return () => { active = false }
  }, [locale, client, reloadKey])

  useEffect(() => {
    let active = true
    void client.getSettings?.().then((result) => {
      if (active && result.state === 'available') setWebSearchEnabled(result.view.settings.webSearchEnabled)
    }).catch(() => undefined)
    return () => { active = false }
  }, [client])

  useEffect(() => () => {
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
    if (exportTimer.current !== undefined) window.clearTimeout(exportTimer.current)
  }, [])

  const selectEdition = (date: string): void => {
    const row = editions.find((edition) => edition.date === date)
    if (!row || row.state === 'missing') return
    if (view.status === 'ready' && view.document.edition.date === date) return
    const request = ++requestRef.current
    setRegenerateFailure(null)
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
    setRegenerateFailure(null)
    try {
      const result = await client.regenerate({ locale, timeZone })
      if (result.state === 'available') {
        setView({ status: 'ready', document: result.document, kind: 'today' })
        setRegenerateFailure(null)
        setEditions((current) => current.map((edition) => edition.date === result.document.edition.date ? summaryFromDocument(result.document) : edition))
      } else {
        setRegenerateFailure({ code: result.failureCode })
      }
    } catch {
      setRegenerateFailure({})
    } finally {
      setRegenerating(false)
    }
  }

  const exportImage = async (): Promise<void> => {
    if (view.status !== 'ready' || !shareRef.current) return
    setExportState('exporting')
    try {
      const dataUrl = await toPng(shareRef.current, { pixelRatio: 2, backgroundColor: '#f4efe4', width: 1080, cacheBust: true })
      const link = document.createElement('a')
      link.download = `mi-daily-brief-${view.document.edition.date}-${locale}.png`
      link.href = dataUrl
      link.click()
      setExportState('done')
    } catch {
      setExportState('failed')
    }
    if (exportTimer.current !== undefined) window.clearTimeout(exportTimer.current)
    exportTimer.current = window.setTimeout(() => setExportState('idle'), 2_500)
  }

  const copy = async (): Promise<void> => {
    if (view.status !== 'ready') return
    try {
      const markdown = dailyBriefingToMarkdown(view.document, {
        labels: withWindowHours(text, view.document.edition.windowHours ?? 24),
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

  const editorialFailureCode = view.status === 'ready' ? view.document.provenance.editorialFailure : undefined
  const editorialBlocked = Boolean(editorialFailureCode && editorialFailureCode !== 'editorial-disabled')
  let failure: BriefFailure | null = null
  if (regenerateFailure) {
    failure = { kind: 'generation', ...(regenerateFailure.code ? { code: regenerateFailure.code } : {}) }
  } else if (editorialBlocked && view.status === 'ready' && editorialFailureCode) {
    failure = {
      kind: 'editorial',
      code: editorialFailureCode,
      ...(view.document.provenance.editorialFailureDetail ? { detail: view.document.provenance.editorialFailureDetail } : {})
    }
  } else if (view.status === 'unavailable' && view.failureCode) {
    failure = { kind: 'generation', code: view.failureCode }
  }
  const contentBlocked = editorialBlocked || regenerateFailure !== null
  const selectedDate = view.status === 'ready' ? view.document.edition.date : undefined
  const appendix = view.status === 'ready' && !contentBlocked && view.document.conclusion
    ? [...new Set([...view.document.conclusion.dataGaps, ...view.document.conclusion.caveats])]
    : []
  const openModelService = onOpenModelSettings ?? openModelSettings
  const bodyClass = `mi-daily-briefing-page__body${appendix.length > 0 ? ' mi-daily-briefing-page__body--with-appendix' : ''}`
  return <main className="intelligence-page mi-daily-briefing-page" aria-label={text.title}>
    <header className="mi-daily-briefing-page__bar">
      <button className="mi-daily-briefing-page__back" type="button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={15} />{text.backToDashboard}
      </button>
      <div className="mi-daily-briefing-page__actions">
        {view.status === 'ready' && view.kind === 'today' ? <button className="mi-daily-briefing__regenerate" type="button" disabled={regenerating} onClick={() => void regenerate()}>
          {regenerating ? text.regenerating : text.regenerate}
        </button> : null}
        {view.status === 'ready' && !contentBlocked ? <button className="mi-daily-briefing__export" type="button" disabled={exportState === 'exporting'} onClick={() => void exportImage()} aria-live="polite">
          {exportState === 'exporting' ? text.exportingImage : exportState === 'done' ? text.exported : exportState === 'failed' ? text.exportFailed : text.exportImage}
        </button> : null}
        {view.status === 'ready' && !contentBlocked ? <button className="mi-daily-briefing__copy" type="button" onClick={() => void copy()} aria-live="polite">
          {copyState === 'copied' ? text.copied : copyState === 'failed' ? text.copyFailed : text.copy}
        </button> : null}
        <button className="mi-daily-briefing__regenerate" type="button" onClick={() => setGenerationSettingsOpen(true)} aria-label={text.generationSettings.open}>
          {text.generationSettings.open}
        </button>
        <button className="mi-daily-briefing__gear" type="button" onClick={() => setSettingsOpen(true)} aria-label={text.aiSettings.open}><Settings2 size={14} aria-hidden="true" /></button>
      </div>
    </header>
    <div className={bodyClass}>
      <DailyBriefingHistoryRail editions={editions} selectedDate={selectedDate} todayDate={todayDate}
        locale={locale} text={text} formatTime={formatTime} onSelect={selectEdition} />
      <section className="mi-daily-briefing-page__content">
        {webSearchEnabled === false && !settingsOpen ? <div className="mi-daily-briefing-page__websearch-warning" role="alert">
          <div><strong>{text.aiSettings.webSearchOff}</strong><small>{text.aiSettings.webSearchOffHint}</small></div>
          <button type="button" onClick={() => setSettingsOpen(true)}>{text.aiSettings.goEnable}</button>
        </div> : null}
        {view.status === 'loading' ? <div className="mi-daily-briefing__state"><LoadingState label={text.generating} minHeight={220} /><p className="mi-daily-briefing-page__loading-hint">{text.generateHint}</p></div> : null}
        {view.status === 'unavailable' && !failure ? <div className="mi-daily-briefing-page__empty" role="alert">
          {editions.every((edition) => edition.state === 'missing') ? <>
            <h2>{text.noBriefTitle}</h2>
            <p>{text.noBriefBody}</p>
          </> : <>
            <h2>{text.unavailable}</h2>
            <p>{text.unavailableHint}</p>
          </>}
          <div className="mi-daily-briefing-page__empty-actions">
            {onConfigureSources ? <button type="button" className="mi-daily-briefing-page__primary" onClick={onConfigureSources}>{text.configureSources}</button> : null}
            <button type="button" disabled={regenerating} onClick={() => { emptyGenerateRef.current = true; setRegenerateFailure(null); setRegenerating(true); setReloadKey((key) => key + 1) }}>{regenerating ? text.regenerating : text.generateNow}</button>
          </div>
        </div> : null}
        {failure ? <DailyBriefingFailurePanel
          failure={failure}
          text={text}
          regenerating={regenerating}
          onRetry={() => void regenerate()}
          onOpenAiSettings={() => setSettingsOpen(true)}
          onOpenModelSettings={openModelService}
          {...(onConfigureSources ? { onConfigureSources } : {})}
        /> : null}
        {view.status === 'ready' && view.document.provenance.editorialFailure === 'editorial-disabled' ? <p className="mi-daily-briefing-page__ai-failure" role="status">{text.aiSettings.notApplied} · {editorialFailureText('editorial-disabled', text)}</p> : null}
        {view.status === 'ready' && !contentBlocked && view.document.status.readingsAvailable === 0 ? <div className="mi-daily-briefing__guide">
          <p>{text.emptyGuide}</p>
          {onConfigureSources ? <button type="button" onClick={onConfigureSources}>{text.configureSources}</button> : null}
        </div> : null}
        {view.status === 'ready' && !contentBlocked ? <div className="mi-daily-briefing-page__paper">
          <DailyBriefingShareCard document={view.document} text={text} locale={locale} readOnly={view.kind === 'history'} {...(eventTitles ? { eventTitles } : {})} formatTime={formatTime} />
        </div> : null}
      </section>
      {appendix.length > 0 && !contentBlocked ? <aside className="mi-daily-briefing-page__appendix" aria-label={text.sections.limits}>
        <h2>{text.sections.limits}</h2>
        {appendix.map((entry) => <p key={entry}>{entry}</p>)}
      </aside> : null}
    </div>
    <DailyBriefingAiSettingsModal open={settingsOpen} text={text} client={client} onClose={() => {
      setSettingsOpen(false)
      void client.getSettings?.().then((result) => { if (result.state === 'available') setWebSearchEnabled(result.view.settings.webSearchEnabled) }).catch(() => undefined)
    }} />
    <DailyBriefingGenerationSettingsModal open={generationSettingsOpen} text={text} client={client} onClose={() => setGenerationSettingsOpen(false)} />
    {view.status === 'ready' && !contentBlocked ? <div className="mi-daily-briefing-share-host" aria-hidden="true">
      <div ref={shareRef}>
        <DailyBriefingShareCard document={view.document} text={text} locale={locale} readOnly={view.kind === 'history'} {...(eventTitles ? { eventTitles } : {})} formatTime={formatTime} />
      </div>
    </div> : null}
  </main>
}

function DailyBriefingFailurePanel({ failure, text, regenerating, onRetry, onOpenAiSettings, onOpenModelSettings, onConfigureSources }: Readonly<{
  failure: BriefFailure
  text: DailyBriefingText
  regenerating: boolean
  onRetry: () => void
  onOpenAiSettings: () => void
  onOpenModelSettings: () => void
  onConfigureSources?: () => void
}>): React.ReactElement {
  const advice = failureAdvice(failure.code)
  const codeLabel = briefFailureCodeLabel(failure.code, text)
  const detail = readableFailureDetail(failure.detail, text.failurePanel.detail)
  const separator = text.labelSeparator
  return <div className="mi-daily-briefing-page__empty mi-daily-briefing-page__failure" role="alert"
    data-daily-brief-failure="true" data-failure-kind={failure.kind} data-failure-advice={advice}
    {...(failure.code ? { 'data-failure-code': failure.code } : {})}>
    <h2>{failure.kind === 'editorial' ? text.failurePanel.editorialTitle : text.failurePanel.generationTitle}</h2>
    <p data-failure-code-label>{text.failurePanel.codeLabel}{separator}{codeLabel}</p>
    {detail ? <p data-failure-detail>{text.failurePanel.detailLabel}{separator}{detail}</p> : null}
    <p data-failure-advice-text>{text.failurePanel.suggestionLabel}{separator}{text.failurePanel.advice[advice]}</p>
    <div className="mi-daily-briefing-page__empty-actions">
      <button type="button" className="mi-daily-briefing-page__primary" data-failure-action="retry" disabled={regenerating} onClick={onRetry}>
        {regenerating ? text.regenerating : text.regenerate}
      </button>
      <button type="button" data-failure-action="ai-settings" onClick={onOpenAiSettings}>{text.failurePanel.openAiSettings}</button>
      {advice !== 'data' ? <button type="button" data-failure-action="model-service" onClick={onOpenModelSettings}>{text.failurePanel.openModelService}</button> : null}
      {advice === 'data' && onConfigureSources ? <button type="button" data-failure-action="sources" onClick={onConfigureSources}>{text.configureSources}</button> : null}
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

async function withDeadline<T>(read: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('daily-briefing-request-timeout')), milliseconds)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
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

function editorialFailureText(code: string, text: DailyBriefingText): string {
  return (text.aiSettings.failure as Readonly<Record<string, string>>)[code] ?? code
}
