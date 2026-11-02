import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from 'antd'
import { ArrowLeft, Settings2 } from 'lucide-react'
import { toPng } from 'html-to-image'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { dailyBriefingToMarkdown } from '../../../contracts/dailyBriefingMarkdown'
import { dailyBriefingClient, type DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { openModelSettings } from '../../shared/navigation/productShellNavigation'
import { resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'
import { DailyBriefingHistoryRail } from './DailyBriefingHistoryRail'
import { DailyBriefingSettingsModal } from './DailyBriefingSettingsModal'
import { withWindowHours } from './dailyBriefingWindowText'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'
import { briefingIssueCounts, briefingIssues, groupBriefingIssues } from './dailyBriefingIssues'
import { posterExportBackground } from './dailyBriefingExport'
import { DailyBriefingIssueDrawer } from './DailyBriefingIssueDrawer'
import { DailyBriefingLiveSteps, runningRowName } from './DailyBriefingLiveSteps'
import { useDailyBriefingProgress } from './useDailyBriefingProgress'
import { readGenerationTrace, type GenerationTrace } from './dailyBriefingGenerationTrace'
import { DailyBriefingFailurePanel, type BriefFailure } from './DailyBriefingFailurePanel'
import { DailyBriefingGenerationTimeline } from './DailyBriefingGenerationTimeline'
import { DailyBriefingStorageNotice } from './DailyBriefingStorageNotice'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

import './dailyBriefing.css'
import './dailyBriefingShareCard.css'

type ViewState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'unavailable'; failureCode?: string; generationTrace?: GenerationTrace }>
  | Readonly<{ status: 'ready'; document: DailyBriefingDocument; kind: 'today' | 'history' }>

/**
 * The daily brief as its own reading page, not a modal: the dashboard entry navigates here and the
 * page keeps the history rail and report in one full-width surface.
 */
export function DailyBriefingPage({ locale, text, eventTitles, onBack, onConfigureSources, onConfigureWebSearch, onOpenModelSettings, client = dailyBriefingClient }: Readonly<{
  locale: 'zh-CN' | 'en-US'
  text: DailyBriefingText
  eventTitles?: Record<string, string>
  onBack: () => void
  onConfigureSources: () => void
  onConfigureWebSearch?: () => void
  /** Overrides the built-in platform model-service navigation. */
  onOpenModelSettings?: () => void
  client?: Pick<DailyBriefingClient, 'getToday' | 'list' | 'get' | 'regenerate' | 'getSettings' | 'saveSettings' | 'getProgress'>
}>): React.ReactElement {
  const timeZone = useShellTimeZone()
  const resolveProductText = useProductTextKey()
  const formatTime = useShellTimeFormat()
  const timeZoneRef = useRef(timeZone)
  timeZoneRef.current = timeZone
  const requestRef = useRef(0)
  const emptyGenerateRef = useRef(false)
  const [editions, setEditions] = useState<readonly DailyBriefingEditionSummary[]>([])
  // The rail starts empty while the list is still being read. "Nothing yet" and "nothing at all"
  // look the same once the array is empty, so the rail has to be told which one it is.
  const [editionsLoading, setEditionsLoading] = useState(true)
  // A list we could not read is not an empty list: the rail says so and offers the same read again.
  const [editionsFailed, setEditionsFailed] = useState(false)
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean | null>(null)
  // Automatic generation is paused when the stored zone cannot be read; a manual run still works,
  // but it then means the UTC clock, and the panel says so instead of letting the reader guess.
  const [zoneInvalid, setZoneInvalid] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateFailure, setRegenerateFailure] = useState<Readonly<{ code?: string; generationTrace?: GenerationTrace }> | null>(null)
  const [exportState, setExportState] = useState<'idle' | 'exporting' | 'done' | 'failed'>('idle')
  const [issuesOpen, setIssuesOpen] = useState(true)
  const [openGroup, setOpenGroup] = useState<Readonly<{ key: string; trigger: HTMLElement | null }> | null>(null)
  const shareRef = useRef<HTMLDivElement>(null)
  const exportTimer = useRef<number | undefined>(undefined)
  const copyTimer = useRef<number | undefined>(undefined)
  const todayDate = useMemo(() => localDate(timeZone), [timeZone])
  // Follows the run only while one is in flight: the hook stops and forgets on its own.
  const generating = view.status === 'loading' || regenerating
  const progress = useDailyBriefingProgress({ client, running: generating, locale, timeZone })
  const liveProgress = progress?.state === 'running' ? progress.progress : undefined
  // "Could not read the progress" is its own case: it must not fall back to "not generated", and it
  // must not pretend the run stopped either — the pipeline is still spending model calls.
  const progressUnreadable = generating && progress?.state === 'unavailable'

  useEffect(() => {
    let active = true
    setView({ status: 'loading' })
    setEditions([])
    setEditionsLoading(true)
    setEditionsFailed(false)
    setRegenerateFailure(null)
    void (async () => {
      const todayPromise = withDeadline(client.getToday({ locale, timeZone: timeZoneRef.current }), 150_000).catch(() => undefined)
      const listed = await withDeadline(client.list({ locale, timeZone: timeZoneRef.current }), 8_000).catch(() => undefined)
      if (!active) return
      let rows = listed?.state === 'available' ? [...listed.result.editions] : []
      setEditions(rows.slice(0, 14))
      // The list has been read: from here an empty rail means "none" — unless the read itself failed.
      setEditionsLoading(false)
      setEditionsFailed(listed?.state !== 'available')
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
        const generationTrace = readGenerationTrace((today as unknown as Readonly<{ generationTrace?: unknown }> | undefined)?.generationTrace)
        setView({
          status: 'unavailable',
          ...(today?.state === 'unavailable' ? { failureCode: today.failureCode } : {}),
          ...(generationTrace ? { generationTrace } : {})
        })
        if (emptyGenerateRef.current) {
          setRegenerateFailure({
            ...(today?.state === 'unavailable' ? { code: today.failureCode } : {}),
            ...(generationTrace ? { generationTrace } : {})
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
      if (!active || result.state !== 'available') return
      setWebSearchEnabled(result.view.settings.webSearchEnabled)
      setZoneInvalid(result.view.generation.periods?.[0]?.generationTimeZoneInvalid ?? null)
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
      const result = await client.regenerate({ locale, timeZone: zoneInvalid ? 'UTC' : timeZone })
      if (result.state === 'available') {
        setView({ status: 'ready', document: result.document, kind: 'today' })
        setRegenerateFailure(null)
        setEditions((current) => current.map((edition) => edition.date === result.document.edition.date ? summaryFromDocument(result.document) : edition))
      } else {
        const generationTrace = readGenerationTrace((result as unknown as Readonly<{ generationTrace?: unknown }>).generationTrace)
        setRegenerateFailure({ code: result.failureCode, ...(generationTrace ? { generationTrace } : {}) })
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
      // The poster paints its own paper; the export reads that colour back instead of keeping a
      // second copy here, so a palette change cannot leave the downloaded image on the old paper.
      const poster = shareRef.current.querySelector<HTMLElement>('.mi-brief-poster') ?? shareRef.current
      const paper = posterExportBackground(poster)
      const dataUrl = await toPng(poster, { pixelRatio: 2, ...(paper ? { backgroundColor: paper } : {}), width: 1080, cacheBust: true })
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
    failure = {
      kind: 'generation',
      ...(regenerateFailure.code ? { code: regenerateFailure.code } : {}),
      ...(regenerateFailure.generationTrace ? { generationTrace: regenerateFailure.generationTrace } : {})
    }
  } else if (editorialBlocked && view.status === 'ready' && editorialFailureCode) {
    const editorialTrace = readGenerationTrace((view.document.provenance as unknown as Readonly<{ generationTrace?: unknown }>).generationTrace)
    failure = {
      kind: 'editorial',
      code: editorialFailureCode,
      ...(view.document.provenance.editorialFailureDetail ? { detail: view.document.provenance.editorialFailureDetail } : {}),
      ...(editorialTrace ? { generationTrace: editorialTrace } : {})
    }
  } else if (view.status === 'unavailable' && view.failureCode) {
    failure = {
      kind: 'generation',
      code: view.failureCode,
      ...(view.generationTrace ? { generationTrace: view.generationTrace } : {})
    }
  }
  const contentBlocked = editorialBlocked || regenerateFailure !== null
  const selectedDate = view.status === 'ready' ? view.document.edition.date : undefined
  // The right rail audits the edition that was actually generated: a missing source, a hidden
  // change and the conclusion's own gaps are separate facts, not one generic caveat list.
  const issues = view.status === 'ready' && !contentBlocked
    ? briefingIssues({
        document: view.document,
        text,
        formatTime,
        ...(eventTitles ? { eventTitles } : {}),
        webSearchEnabled
      })
    : []
  const issueCounts = briefingIssueCounts(issues)
  const groups = groupBriefingIssues(issues, text)
  const activeGroup = openGroup ? groups.find((group) => group.key === openGroup.key) : undefined
  // A successful edition keeps its stage trace for auditing; a failed attempt carries the same
  // shape in the result, so the timeline survives a refresh once the service returns it.
  const generationTrace = view.status === 'ready'
    ? readGenerationTrace((view.document.provenance as unknown as Readonly<{ generationTrace?: unknown }>).generationTrace)
    : undefined
  const showAppendix = view.status === 'ready' && !contentBlocked
  // The newest edition the list still holds is the last one that actually generated: an unreadable
  // state may quote it, so "unreadable" is not mistaken for "nothing was ever made".
  const lastGeneratedAt = editions.find((edition) => edition.generatedAt && edition.state !== 'missing')?.generatedAt
  const generateNow = (): void => {
    emptyGenerateRef.current = true
    setRegenerateFailure(null)
    setRegenerating(true)
    setReloadKey((key) => key + 1)
  }
  const openModelService = onOpenModelSettings ?? openModelSettings
  const bodyClass = `mi-daily-briefing-page__body${showAppendix ? ' mi-daily-briefing-page__body--with-appendix' : ''}`
  return <main className="intelligence-page mi-daily-briefing-page" aria-label={text.title}>
    <header className="mi-daily-briefing-page__bar">
      <Button className="mi-daily-briefing-page__back" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={15} />{text.backToDashboard}
      </Button>
      <div className="mi-daily-briefing-page__actions">
        {view.status === 'ready' && view.kind === 'today' ? <>
          <Button className="mi-daily-briefing__regenerate" disabled={regenerating} onClick={() => void regenerate()}>
            {regenerating ? text.regenerating : text.regenerate}
          </Button>
          {zoneInvalid ? <small className="mi-daily-briefing__manual-utc" role="status">{text.generationSettings.manualUtcNote}</small> : null}
        </> : null}
        {view.status === 'ready' && !contentBlocked ? <Button className="mi-daily-briefing__export" disabled={exportState === 'exporting'} onClick={() => void exportImage()} aria-live="polite">
          {exportState === 'exporting' ? text.exportingImage : exportState === 'done' ? text.exported : exportState === 'failed' ? text.exportFailed : text.exportImage}
        </Button> : null}
        {view.status === 'ready' && !contentBlocked ? <Button className="mi-daily-briefing__copy" onClick={() => void copy()} aria-live="polite">
          {copyState === 'copied' ? text.copied : copyState === 'failed' ? text.copyFailed : text.copy}
        </Button> : null}
        <IconButton
          ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.settings.open"
          icon={Settings2}
          onSelect={() => setSettingsOpen(true)}
          resolveText={resolveProductText}
          size="md"
        />
      </div>
    </header>
    <div className={bodyClass}>
      <DailyBriefingHistoryRail editions={editions} failed={editionsFailed} loading={editionsLoading} onRetry={() => setReloadKey((key) => key + 1)} selectedDate={selectedDate} todayDate={todayDate}
        generatingStage={liveProgress ? runningRowName(liveProgress, text) : progressUnreadable ? text.generationProgress.unknownStage : undefined}
        locale={locale} text={text} formatTime={formatTime} onSelect={selectEdition} />
      <section className="mi-daily-briefing-page__content">
        <DailyBriefingStorageNotice text={text.migration} />
        {webSearchEnabled === false && !settingsOpen ? <div className="mi-daily-briefing-page__websearch-warning" role="alert">
          <div><strong>{text.aiSettings.webSearchOff}</strong><small>{text.aiSettings.webSearchOffHint}</small></div>
          <Button onClick={() => setSettingsOpen(true)}>{text.aiSettings.goEnable}</Button>
        </div> : null}
        {view.status === 'loading' ? <div className="mi-daily-briefing__state">
          <LoadingState label={text.generating} minHeight={220} />
          <p className="mi-daily-briefing-page__loading-hint">{text.generateHint}</p>
          {/* The one spinner stays; the rows say which step it is on. */}
          {liveProgress ? <DailyBriefingLiveSteps nowMs={Date.now()} progress={liveProgress} text={text} /> : null}
          {progressUnreadable ? <p className="mi-daily-briefing-page__loading-hint" data-progress-unreadable="true">{text.generationProgress.unknown}</p> : null}
        </div> : null}
        {view.status === 'unavailable' && !failure ? (editions.every((edition) => edition.state === 'missing')
          ? <StateView
              state="empty"
              reasonCode="never-created"
              size="lg"
              productReason={{
                key: 'mi.dailyBriefing.noBrief',
                resolve: (key, params) => resolveBriefingStateReason(text, key, params)
              }}
              action={{ labelKey: 'ui.state.action.create', onSelect: generateNow }}
            />
          : lastGeneratedAt
            ? <StateView
                state="error"
                reasonCode="unreadable"
                size="lg"
                productReason={{
                  key: 'mi.dailyBriefing.unreadableSince',
                  params: { moment: formatTime(lastGeneratedAt, 'minute') },
                  resolve: (key, params) => resolveBriefingStateReason(text, key, params)
                }}
                action={{ labelKey: 'ui.state.action.retry', onSelect: generateNow }}
              />
            : <StateView
                state="error"
                reasonCode="unreadable"
                size="lg"
                productReason={{
                  key: 'mi.dailyBriefing.unreadable',
                  resolve: (key, params) => resolveBriefingStateReason(text, key, params)
                }}
                action={{ labelKey: 'ui.state.action.retry', onSelect: generateNow }}
              />) : null}
        {failure ? <DailyBriefingFailurePanel
          failure={failure}
          text={text}
          formatTime={formatTime}
          regenerating={regenerating}
          onRetry={() => void regenerate()}
          onOpenAiSettings={() => setSettingsOpen(true)}
          onOpenModelSettings={openModelService}
          onConfigureSources={onConfigureSources}
        /> : null}
        {view.status === 'ready' && view.document.provenance.editorialFailure === 'editorial-disabled' ? <p className="mi-daily-briefing-page__ai-failure" role="status">{text.aiSettings.notApplied} · {editorialFailureText('editorial-disabled', text)}</p> : null}
        {view.status === 'ready' && !contentBlocked && view.document.status.readingsAvailable === 0 ? <StateView
          state="empty"
          reasonCode="nothing-enabled"
          productReason={{
            key: 'mi.dailyBriefing.nothingEnabled',
            resolve: (key, params) => resolveBriefingStateReason(text, key, params)
          }}
          action={{ labelKey: 'ui.state.action.open-settings', onSelect: onConfigureSources }}
        /> : null}
        {view.status === 'ready' && !contentBlocked ? <div className="mi-daily-briefing-page__paper">
          <DailyBriefingShareCard document={view.document} text={text} locale={locale} readOnly={view.kind === 'history'} {...(eventTitles ? { eventTitles } : {})} formatTime={formatTime} />
        </div> : null}
      </section>
      {showAppendix && !contentBlocked ? <aside className="mi-daily-briefing-page__appendix" aria-label={text.sections.limits} {...(issues.length > 0 ? { 'data-briefing-issues': 'true' } : {})}>
        <DailyBriefingGenerationTimeline trace={generationTrace} text={text} formatTime={formatTime} />
        {issues.length > 0 ? <>
          <header className="mi-daily-briefing-page__appendix-head">
            <h2>{text.sections.limits}</h2>
            <Button className="mi-daily-briefing-page__appendix-toggle" aria-expanded={issuesOpen} onClick={() => setIssuesOpen((open) => !open)}>
              {issuesOpen ? text.limits.collapse : text.limits.expand}
            </Button>
          </header>
          <p className="mi-daily-briefing-page__appendix-counts">{issueCountsText(issueCounts, text)}</p>
          {issuesOpen ? <ol className="mi-daily-briefing-page__groups">
            {groups.map((group) => <li key={group.key}>
              <Button className="mi-daily-briefing-page__group" aria-haspopup="dialog"
                aria-label={text.limits.openGroup.replace('{label}', group.label).replace('{count}', String(group.count))}
                data-group-key={group.key} data-group-severity={group.severity} data-group-category={group.category}
                onClick={(event) => setOpenGroup({ key: group.key, trigger: event.currentTarget })}>
                <span className="mi-daily-briefing-page__group-tags">
                  <span data-severity={group.severity}>{text.limits.severity[group.severity]}</span>
                  <span data-category={group.category}>{text.limits.categories[group.category]}</span>
                </span>
                <span className="mi-daily-briefing-page__group-label">{group.label}</span>
                <span className="mi-daily-briefing-page__group-count">{text.limits.groupCount.replace('{count}', String(group.count))}</span>
                <span className="mi-daily-briefing-page__group-example">{text.limits.groupExample.replace('{text}', group.example)}</span>
              </Button>
            </li>)}
          </ol> : null}
        </> : null}
      </aside> : null}
    </div>
    {activeGroup ? <DailyBriefingIssueDrawer group={activeGroup} text={text} formatTime={formatTime} onClose={() => setOpenGroup(null)} /> : null}
    <DailyBriefingSettingsModal open={settingsOpen} text={text} client={client} onClose={() => {
      setSettingsOpen(false)
      void client.getSettings?.().then((result) => { if (result.state === 'available') setWebSearchEnabled(result.view.settings.webSearchEnabled) }).catch(() => undefined)
    }} />
    {view.status === 'ready' && !contentBlocked ? <div className="mi-daily-briefing-share-host" aria-hidden="true">
      <div ref={shareRef}>
        {/* The exported node only: rows that are just a fallback reading stay on the page above. */}
        <DailyBriefingShareCard document={view.document} text={text} locale={locale} readOnly={view.kind === 'history'} omitFallbackReadings {...(eventTitles ? { eventTitles } : {})} formatTime={formatTime} />
      </div>
    </div> : null}
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

/** "2 blocking · 3 warnings · 1 note", with empty severities omitted. */
function issueCountsText(
  counts: Readonly<Record<'blocking' | 'warning' | 'info', number>>,
  text: DailyBriefingText
): string {
  return (['blocking', 'warning', 'info'] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => text.limits.counts[severity].replace('{count}', String(counts[severity])))
    .join(' · ')
}
