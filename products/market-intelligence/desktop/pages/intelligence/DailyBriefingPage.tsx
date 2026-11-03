import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from 'antd'
import { ArrowLeft, CircleHelp, Settings2 } from 'lucide-react'
import { toPng } from 'html-to-image'

import { IconButton } from '@platform/ui/components/icon-button'
import { Tabs } from '@platform/ui/components/tabs'
import { Popover } from '@platform/ui/components/popover'
import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { dailyBriefingToMarkdown } from '../../../contracts/dailyBriefingMarkdown'
import { dailyBriefingClient, type DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { openModelSettings, openWebSearchSettings } from '../../shared/navigation/productShellNavigation'
import { briefingTextForLocale, resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'
import { DailyBriefingHistoryRail } from './DailyBriefingHistoryRail'
import { DailyBriefingSettingsDrawer, type BriefingSettingsSection } from './DailyBriefingSettingsDrawer'
import { withWindowHours } from './dailyBriefingWindowText'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'
import { briefingIssueCounts, briefingIssues, groupBriefingIssues } from './dailyBriefingIssues'
import { briefingExportFileName, posterExportBackground } from './dailyBriefingExport'
import { DailyBriefingIssueDrawer } from './DailyBriefingIssueDrawer'
import { DailyBriefingLiveSteps, runningRowName } from './DailyBriefingLiveSteps'
import { useDailyBriefingProgress } from './useDailyBriefingProgress'
import { readGenerationTrace, type GenerationTrace } from './dailyBriefingGenerationTrace'
import { DailyBriefingFailurePanel, type BriefFailure } from './DailyBriefingFailurePanel'
import { DailyBriefingAttempts } from './DailyBriefingAttempts'
import { useBriefingContentLocale } from './useBriefingContentLocale'
import { DailyBriefingEmptyState } from './DailyBriefingEmptyState'
import { DailyBriefingGeneratingAside, DailyBriefingGeneratingStatus, DailyBriefingGeneratingView } from './DailyBriefingGeneratingStates'
import { DailyBriefingGenerationTimeline } from './DailyBriefingGenerationTimeline'
import { DailyBriefingLanguageFallback } from './DailyBriefingLanguageFallback'
import { posterProps } from './dailyBriefingPoster'
import { DailyBriefingStorageNotice } from './DailyBriefingStorageNotice'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

import './dailyBriefing.css'
import './dailyBriefingShareCard.css'
import {
  editorialFailureText,
  issueCountsText,
  localDate,
  summaryFromDocument,
  withDeadline
} from './dailyBriefingPageDerived'

type ViewState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'unavailable'; failureCode?: string; generationTrace?: GenerationTrace }>
  | Readonly<{
    status: 'ready'
    document: DailyBriefingDocument
    kind: 'today' | 'history'
    /** `system` means the settings zone was unusable and the machine's zone stood in. */
    timeZoneSource?: 'settings' | 'system'
  }>

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
  client?: Pick<DailyBriefingClient, 'getToday' | 'list' | 'get' | 'regenerate' | 'getSettings' | 'saveSettings' | 'getProgress'> & Partial<Pick<DailyBriefingClient, 'listAttempts'>>
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
  // One settings surface: the entry opens it at the top, the web-search banner and a failed attempt
  // open the same drawer aimed at its AI block. Two dialogs is what this replaces.
  const [settingsSection, setSettingsSection] = useState<BriefingSettingsSection | null>(null)
  // Content language: one hook owns it; the tab's selection state derives from it.
  const [contentLocale, setContentLocale] = useBriefingContentLocale(locale)
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean | null>(null)
  // The language this reader asked for but this version cannot write in; a state, not an explanation.
  const [languageFallback, setLanguageFallback] = useState<string | null>(null)
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
      const todayPromise = withDeadline(client.getToday({ locale: contentLocale, timeZone: timeZoneRef.current }), 150_000).catch(() => undefined)
      const listed = await withDeadline(client.list({ locale: contentLocale, timeZone: timeZoneRef.current }), 8_000).catch(() => undefined)
      if (!active) return
      let rows = listed?.state === 'available' ? [...listed.result.editions] : []
      setEditions(rows.slice(0, 14))
      // The list has been read: from here an empty rail means "none" — unless the read itself failed.
      setEditionsLoading(false)
      setEditionsFailed(listed?.state !== 'available')
      const cachedRow = rows.find((row) => row.date === todayDate && row.state === 'generated')
      if (cachedRow) {
        const cached = await client.get({ date: cachedRow.date, locale: contentLocale }).catch(() => undefined)
        if (active && cached?.state === 'available' && view.status === 'loading') {
          setView({ status: 'ready', document: cached.document, kind: 'today' })
        }
      }
      const today = await todayPromise
      if (!active) return
      if (today?.state === 'available') {
        const date = today.document.edition.date
        rows = rows.some((row) => row.date === date)
          ? rows.map((row) => row.date === date
            // The fresh document knows the text; the list row knows which languages this period
            // was meant to have. Dropping that would make an incomplete period look complete.
            ? { ...row, ...summaryFromDocument(today.document), availableLocales: row.availableLocales, ...(row.expectedLocales ? { expectedLocales: row.expectedLocales } : {}) }
            : row)
          : [summaryFromDocument(today.document), ...rows]
        setView({
          status: 'ready',
          document: today.document,
          kind: 'today',
          ...(today.timeZoneSource === 'system' ? { timeZoneSource: 'system' as const } : {})
        })
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
  }, [contentLocale, client, reloadKey])

  useEffect(() => {
    let active = true
    void client.getSettings?.().then((result) => {
      if (!active || result.state !== 'available') return
      setWebSearchEnabled(result.view.settings.webSearchEnabled)
      setZoneInvalid(result.view.generation.periods?.[0]?.generationTimeZoneInvalid ?? null)
      const plan = result.view.language.plan.primary; setLanguageFallback(plan.fallbackReason === 'ui-language-unsupported' ? plan.requested : null)
    }).catch(() => undefined)
    return () => { active = false }
  }, [client])

  useEffect(() => () => {
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
    if (exportTimer.current !== undefined) window.clearTimeout(exportTimer.current)
  }, [])

  const selectEdition = (date: string, language?: 'zh-CN' | 'en-US'): void => {
    const target = language ?? locale
    const row = editions.find((edition) => edition.date === date && edition.locale === target) ?? editions.find((edition) => edition.date === date)
    if (!row || row.state === 'missing') return
    if (view.status === 'ready' && view.document.edition.date === date && view.document.edition.locale === target) return
    const request = ++requestRef.current
    setRegenerateFailure(null)
    setView({ status: 'loading' })
    void client.get({ date, locale: target })
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
      link.download = briefingExportFileName(view.document)
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
        labels: withWindowHours(view.document.edition.locale === locale ? text : briefingTextForLocale(view.document.edition.locale), view.document.edition.windowHours ?? 24),
        locale: view.document.edition.locale,
        direction: (term) => localizedDirectionTerm(term, view.document.edition.locale),
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
  const selectedLocale = view.status === 'ready' ? view.document.edition.locale : undefined
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
  // What an empty page can honestly say: the schedule it would run at, in the reader's own zone.
  const scheduledTime = editions.find((edition) => edition.scheduledTime !== undefined)?.scheduledTime
  const todayMissing = editions.some((edition) => edition.date === todayDate && edition.state === 'missing')
  const openModelService = onOpenModelSettings ?? openModelSettings
  const bodyClass = `mi-daily-briefing-page__body${showAppendix ? ' mi-daily-briefing-page__body--with-appendix' : ''}`
  // The exported image follows the edition it shows, not the interface (see dailyBriefingPoster).
  const poster = posterProps({ document: view.status === 'ready' ? view.document : undefined, editions, fallbackText: text })
  // Content follows the edition, chrome follows the interface: the rail, buttons and counts stay.
  const editionText = view.status === 'ready' ? briefingTextForLocale(view.document.edition.locale) : text
  const editionLocale = view.status === 'ready' ? view.document.edition.locale : locale

  return <main className="intelligence-page mi-daily-briefing-page" aria-label={text.title}>
    <header className="mi-daily-briefing-page__bar">
      <Button className="mi-daily-briefing-page__back" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={15} />{text.backToDashboard}
      </Button>
      <div className="mi-daily-briefing-page__actions">
        <div className="mi-daily-briefing-page__lang-tabs" data-content-language-tabs="true">
          <Tabs
            ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.languageTabs.label"
            items={[{ value: 'zh-CN', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.languageTabs.zh-CN' }, { value: 'en-US', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.languageTabs.en-US' }]}
            onChange={(value) => setContentLocale(value === 'en-US' ? 'en-US' : 'zh-CN')}
            panels={{ 'zh-CN': null, 'en-US': null }}
            resolveText={resolveProductText}
            value={contentLocale}
          />
        </div>
        {view.status === 'loading' ? <DailyBriefingGeneratingStatus progress={liveProgress} resolveText={resolveProductText} text={text} /> : null}
        {view.status === 'ready' && view.kind === 'today' && failure === null ? <>
          <Button className="mi-daily-briefing__regenerate" data-toolbar-action="regenerate" disabled={regenerating} onClick={() => void regenerate()}>
            {regenerating ? text.regenerating : text.regenerate}
          </Button>
          {zoneInvalid ? <small className="mi-daily-briefing__clock-note" role="status">{text.generationSettings.manualUtcNote}</small> : null}
          {/* The settings zone was unusable, so the window was computed in the machine's zone. The
              reader configured a time and is getting another day boundary; saying nothing would let
              them read the edition against the wrong one. */}
          {view.status === 'ready' && view.timeZoneSource === 'system'
            ? <small className="mi-daily-briefing__clock-note" role="status">{text.timeZoneFromSystem}</small>
            : null}
        </> : null}
        {view.status === 'ready' && !contentBlocked ? <Button className="mi-daily-briefing__export" disabled={exportState === 'exporting'} onClick={() => void exportImage()} aria-live="polite">
          {exportState === 'exporting' ? text.exportingImage : exportState === 'done' ? text.exported : exportState === 'failed' ? text.exportFailed : text.exportImage}
        </Button> : null}
        {view.status === 'ready' && !contentBlocked ? <Button className="mi-daily-briefing__copy" onClick={() => void copy()} aria-live="polite">
          {copyState === 'copied' ? text.copied : copyState === 'failed' ? text.copyFailed : text.copy}
        </Button> : null}
        {/* One entry for every brief setting. The icon-only AI-settings trigger that used to sit
            beside it opened a second dialog for half of the same form. */}
        <Button className="mi-daily-briefing__settings-entry" data-briefing-settings-open="true" onClick={() => setSettingsSection('generation')}>
          <Settings2 aria-hidden="true" size={14} />{text.settingsDrawer.open}
        </Button>
      </div>
    </header>
    <div className={bodyClass}>
      <DailyBriefingHistoryRail editions={editions} failed={editionsFailed} loading={editionsLoading} onRetry={() => setReloadKey((key) => key + 1)} selectedDate={selectedDate} selectedLocale={selectedLocale} todayDate={todayDate}
        generatingStage={generating ? (progressUnreadable ? text.generationProgress.unknownStage : ((liveProgress ? runningRowName(liveProgress, text) : undefined) ?? text.generationProgress.railRunning)) : undefined}
        locale={locale} text={text} timeZone={timeZone} resolveText={resolveProductText} onSelect={selectEdition} />
      <section className="mi-daily-briefing-page__content">
        <DailyBriefingLanguageFallback requested={languageFallback} text={text} />
        <DailyBriefingStorageNotice text={text.migration} />
        {webSearchEnabled === false && settingsSection === null ? <div className="mi-daily-briefing-page__websearch-warning" role="alert">
          <div><strong>{text.aiSettings.webSearchOff}</strong><small>{text.aiSettings.webSearchOffHint}</small></div>
          <Button data-open-settings-section="ai" onClick={() => setSettingsSection('ai')}>{text.aiSettings.goEnable}</Button>
        </div> : null}
        {view.status === 'loading' ? <DailyBriefingGeneratingView progressUnreadable={progressUnreadable} resolveText={resolveProductText} text={text} /> : null}
        {view.status === 'unavailable' && !failure
          ? <DailyBriefingEmptyState editions={editions} formatTime={formatTime} lastGeneratedAt={lastGeneratedAt} onGenerate={generateNow} text={text} timeZone={timeZone} todayDate={todayDate} />
          : null}
        {failure ? <DailyBriefingFailurePanel
          failure={failure}
          text={text}
          formatTime={formatTime}
          regenerating={regenerating}
          onRetry={() => void regenerate()}
          onOpenSettings={() => setSettingsSection('ai')}
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
          <DailyBriefingShareCard document={view.document} text={editionText} locale={editionLocale} readOnly={view.kind === 'history'} {...(eventTitles ? { eventTitles } : {})} formatTime={formatTime} />
        </div> : null}
      </section>
      {view.status === 'loading' ? <DailyBriefingGeneratingAside formatTime={formatTime} progress={liveProgress} text={text} /> : null}
      {showAppendix && !contentBlocked ? <aside className="mi-daily-briefing-page__appendix" data-briefing-detail="true" aria-label={text.sections.limits} {...(issues.length > 0 ? { 'data-briefing-issues': 'true' } : {})}>
        <div data-briefing-stages="true"><DailyBriefingGenerationTimeline trace={generationTrace} text={text} formatTime={formatTime} /></div>
        <section data-briefing-gaps="true">
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
        </> : null}</section>
        {view.status === 'ready' ? <DailyBriefingAttempts date={view.document.edition.date} periodId="default" locale={editionLocale} text={text} loadAttempts={client.listAttempts ? (date, periodId, language) => client.listAttempts!({ date, locale: language, periodId }) : undefined} /> : null}
      </aside> : null}
    </div>
    {activeGroup ? <DailyBriefingIssueDrawer group={activeGroup} text={text} formatTime={formatTime} onClose={() => setOpenGroup(null)} /> : null}
    {/* Mounted only while open: both blocks read settings on mount, so a closed page reads none. */}
    {settingsSection ? <DailyBriefingSettingsDrawer client={client} open section={settingsSection} text={text}
      onConfigureWebSearch={onConfigureWebSearch ?? openWebSearchSettings}
      onOpenModelSettings={openModelService}
      onClose={() => {
        setSettingsSection(null)
        // The banner follows the saved value, so a save inside the drawer has to be re-read.
        void client.getSettings().then((result) => { if (result.state === 'available') setWebSearchEnabled(result.view.settings.webSearchEnabled) }).catch(() => undefined)
      }} /> : null}
    {view.status === 'ready' && !contentBlocked ? <div className="mi-daily-briefing-share-host" aria-hidden="true">
      {/* The exported node only: rows that are just a fallback reading stay on the page above. */}
      <div ref={shareRef}><DailyBriefingShareCard document={view.document} text={poster.text} locale={poster.locale} readOnly={view.kind === 'history'} omitFallbackReadings {...(poster.completenessNote ? { completenessNote: poster.completenessNote } : {})} {...(eventTitles ? { eventTitles } : {})} formatTime={formatTime} /></div>
    </div> : null}
  </main>
}
