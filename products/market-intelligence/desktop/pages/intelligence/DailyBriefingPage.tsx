import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from 'antd'
import { ArrowLeft, CircleHelp } from 'lucide-react'
import { toPng } from 'html-to-image'

import { IconButton } from '@platform/ui/components/icon-button'
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
import { DailyBriefingDeleteOutcomeNote } from './DailyBriefingDeleteOutcomeNote'
import { useBriefingShareActions } from './useBriefingShareActions'
import { runBriefingRegenerate } from './runBriefingRegenerate'
import { useDailyBriefingIssueDeletion } from './useDailyBriefingIssueDeletion'
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
import { DailyBriefingGeneratingView } from './DailyBriefingGeneratingStates'
import { DailyBriefingPageActions } from './DailyBriefingPageActions'
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
  briefingFailure,
  briefingListFacts,
  summaryFromDocument,
  withDeadline
} from './dailyBriefingPageDerived'

import type { DailyBriefingPageViewState as ViewState } from './dailyBriefingPageViewState'
import { DailyBriefingLanguageSwitch } from './DailyBriefingLanguageSwitch'
import { openBriefingEdition } from './openBriefingEdition'
import { DailyBriefingAppendix } from './DailyBriefingAppendix'
import { DailyBriefingContent } from './DailyBriefingContent'
import { useBriefingRunActions } from './useBriefingRunActions'
import { DailyBriefingLocaleMissing } from './DailyBriefingLocaleMissing'
import { DailyBriefingNoEditionPanel } from './DailyBriefingNoEditionPanel'

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
  client?: Pick<DailyBriefingClient, 'getToday' | 'list' | 'get' | 'regenerate' | 'getSettings' | 'saveSettings' | 'getProgress'> & Partial<Pick<DailyBriefingClient, 'listAttempts' | 'deletePeriod'>>
}>): React.ReactElement {
  const timeZone = useShellTimeZone()
  const resolveProductText = useProductTextKey()
  const formatTime = useShellTimeFormat()
  const timeZoneRef = useRef(timeZone)
  timeZoneRef.current = timeZone
  const requestRef = useRef(0)
  // The one read path, reachable from effects that must not re-implement it (the delete fallback).
  const openEditionRef = useRef<(date: string, locale: 'zh-CN' | 'en-US', row?: { state: string; attemptCount?: number }) => void>(() => undefined)
  // The language to read after a delete: decided from the row as it was before the delete, and
  // consumed by the reload. Choosing it here keeps "which language to show" ahead of "read it",
  // so the pane and the switch cannot disagree.
  const afterDeleteLocaleRef = useRef<'zh-CN' | 'en-US' | null>(null)
  // The language this component last loaded for; a change means the stored edition language arrived.
  const loadedLocaleRef = useRef<'zh-CN' | 'en-US' | null>(null)
  // The last readable edition, kept so a failed retry keeps the content under the failure notice.
  const lastReadyRef = useRef<DailyBriefingDocument | null>(null)
  const [showingStale, setShowingStale] = useState(false)
  const [editions, setEditions] = useState<readonly DailyBriefingEditionSummary[]>([])
  // The rail starts empty while the list is still being read. "Nothing yet" and "nothing at all"
  // look the same once the array is empty, so the rail has to be told which one it is.
  const [editionsLoading, setEditionsLoading] = useState(true)
  // A list we could not read is not an empty list: the rail says so and offers the same read again.
  const [editionsFailed, setEditionsFailed] = useState(false)
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  // The rail keeps its place when the pane empties: where the reader was is about the reader, not
  // about whether this issue still has content.
  const [pinnedDate, setPinnedDate] = useState<string | undefined>(undefined)
  const [reloadKey, setReloadKey] = useState(0)
  // One settings surface: the entry opens it at the top, the web-search banner and a failed attempt
  // open the same drawer aimed at its AI block. Two dialogs is what this replaces.
  const [settingsSection, setSettingsSection] = useState<BriefingSettingsSection | null>(null)
  // Content language: one hook owns it; the tab's selection state derives from it.
  const [contentLocale, setContentLocale] = useBriefingContentLocale(locale)
  // The switch only exists when the brief may have more than one edition language at all.
  const [englishEditionsEnabled, setEnglishEditionsEnabled] = useState(false)
  // Until the settings answer arrives we do not know whether an English edition is even possible.
  const [languageSettingsKnown, setLanguageSettingsKnown] = useState(false)
  // Bumped when settings may have changed elsewhere (drawer closed, window focused) to read again.
  const [settingsReloadKey, setSettingsReloadKey] = useState(0)
  const { outcome: deleteOutcome, deletePeriod, takeSkipGenerate } = useDailyBriefingIssueDeletion({ client, onSettled: () => setReloadKey((key) => key + 1) })
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean | null>(null)
  // The language this reader asked for but this version cannot write in; a state, not an explanation.
  const [languageFallback, setLanguageFallback] = useState<string | null>(null)
  // Automatic generation is paused when the stored zone cannot be read; a manual run still works,
  // but it then means the UTC clock, and the panel says so instead of letting the reader guess.
  const [zoneInvalid, setZoneInvalid] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateFailure, setRegenerateFailure] = useState<Readonly<{ code?: string; generationTrace?: GenerationTrace }> | null>(null)
  // Open by default: the reader asked to see the groups without a click; the counts stay on the
  // summary line either way.
  const [issuesOpen, setIssuesOpen] = useState(true)
  const [openGroup, setOpenGroup] = useState<Readonly<{ key: string; trigger: HTMLElement | null }> | null>(null)
  const shareRef = useRef<HTMLDivElement>(null)
  // The issue day ("current period") is the service's, not the wall clock's: before the generation
  // hour the current period is still the previous calendar day, and two definitions make a past day
  // look like today. The wall clock is only the fallback before the list answers.
  const wallClockToday = useMemo(() => localDate(timeZone), [timeZone])
  const [currentPeriodDate, setCurrentPeriodDate] = useState<string | undefined>(undefined)
  const todayDate = currentPeriodDate ?? wallClockToday
  // A run this page started, or one it is loading for. The service's own answer joins below.
  const busyLocally = view.status === 'loading' || regenerating
  // With the switch unavailable the stored choice must not decide anything: rendering and requests use
  // the interface language, while the stored preference itself is left untouched for when it returns.
  const effectiveLocale = englishEditionsEnabled ? contentLocale : locale
  const effectiveLocaleRef = useRef(effectiveLocale)
  effectiveLocaleRef.current = effectiveLocale
  useEffect(() => {
    if (view.status === 'ready') lastReadyRef.current = view.document
  }, [view])
  const progress = useDailyBriefingProgress({ client, running: busyLocally, locale, timeZone })
  // One question, every source: what this page started, what it is loading for, and what the service
  // says is running right now (a scheduled run, or one started in another window).
  const generating = busyLocally || progress?.state === 'running'
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
      // One-shot: only the reload a delete asked for skips the generation; the next ordinary open
      // must be able to generate today again.
      const skipGenerate = takeSkipGenerate()
      // Opening the page may generate today's edition; everything else is a read. The language tab
      // therefore never comes through here — it calls the same read path a row click does.
      const afterDeleteLocale = afterDeleteLocaleRef.current
      afterDeleteLocaleRef.current = null
      const localeForLoad = afterDeleteLocale ?? effectiveLocaleRef.current
      if (afterDeleteLocale && afterDeleteLocale !== effectiveLocaleRef.current) setContentLocale(afterDeleteLocale)
      loadedLocaleRef.current = localeForLoad
      const todayPromise = skipGenerate
        ? Promise.resolve(undefined)
        : withDeadline(client.getToday({ locale: localeForLoad, timeZone: timeZoneRef.current, generate: false }), 15_000).catch(() => undefined)
      const listed = await withDeadline(client.list({ locale: localeForLoad, timeZone: timeZoneRef.current }), 8_000).catch(() => undefined)
      if (!active) return
      // The issue day this load is about: the service's, when the list answered.
      const periodDate = listed?.state === 'available' && typeof listed.result.today === 'string' ? listed.result.today : todayDate
      setCurrentPeriodDate(periodDate)
      let rows = listed?.state === 'available' ? [...listed.result.editions] : []
      setEditions(rows.slice(0, 14))
      // The list has been read: from here an empty rail means "none" — unless the read itself failed.
      setEditionsLoading(false)
      setEditionsFailed(listed?.state !== 'available')
      // The row this load is about. `periodDate` is the list's own answer; using the wall-clock
      // `todayDate` here is what made a delete reload look at a day the list does not contain, find
      // nothing, and report the whole issue as empty.
      const periodRow = rows.find((row) => row.date === periodDate)
      let keptCachedToday = false
      if (skipGenerate) {
        // A delete reload reads the edition that is left, in the language that is left, and puts it
        // on screen. Only an issue with no language at all may land on "nothing generated".
        const available = periodRow?.availableLocales ?? []
        const wanted = available.includes(localeForLoad) ? localeForLoad : available.find((candidate) => candidate !== localeForLoad)
        if (wanted) {
          if (wanted !== localeForLoad) setContentLocale(wanted)
          const read = await client.get({ date: periodDate, locale: wanted }).catch(() => undefined)
          if (!active) return
          if (read?.state === 'available') {
            setView({ status: 'ready', document: read.document, kind: periodDate === todayDate ? 'today' : 'history' })
            keptCachedToday = true
          }
        }
        if (!keptCachedToday) setView({ status: 'no-edition', date: periodDate, failed: false })
        keptCachedToday = true
      } else if (periodRow && view.status === 'loading') {
        const cached = await client.get({ date: periodDate, locale: localeForLoad }).catch(() => undefined)
        if (active && cached?.state === 'available') {
          setView({ status: 'ready', document: cached.document, kind: periodDate === todayDate ? 'today' : 'history' })
          keptCachedToday = true
        }
      }
      // Before saying "nothing was generated", ask whether something is being generated right now.
      // The 07:00 scheduled run (or one started in another window) is invisible to local state, and
      // its nine steps must be on screen while it works.
      const serviceRunInFlight = async (): Promise<boolean> => {
        const live = await client.getProgress({ locale: localeForLoad, timeZone: timeZoneRef.current }).catch(() => undefined)
        return live?.state === 'running'
      }
      const today = await todayPromise
      if (!active) return
      if (today?.state === 'available') {
        const date = today.document.edition.date
        setCurrentPeriodDate(date)
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
      } else if (today?.state === 'unavailable' && today.failureCode === 'not-generated' && !keptCachedToday
        && rows.some((edition) => edition.date === periodDate && edition.availableLocales.includes(localeForLoad))) {
        // The list says this language exists, so the answer "nothing written" is the read's miss, not
        // the truth. Read that edition by its date and put the answer on screen here — handing it to
        // the row path made the result depend on state that was still settling after a delete.
        const again = await client.get({ date: periodDate, locale: localeForLoad }).catch(() => undefined)
        if (!active) return
        if (again?.state === 'available') {
          setView({ status: 'ready', document: again.document, kind: periodDate === todayDate ? 'today' : 'history' })
          setRegenerateFailure(null)
        } else {
          setView({ status: 'locale-missing', locale: localeForLoad, date: periodDate })
        }
      } else if (today?.state === 'unavailable' && today.failureCode === 'not-generated' && !keptCachedToday) {
        // Nothing is written in this language. Whether that means "the issue has no content" or
        // "this issue has the other language" is the list's answer, not this branch's guess.
        const row = rows.find((edition) => edition.date === periodDate)
        const other = (row?.availableLocales ?? []).find((candidate) => candidate !== localeForLoad)
        if (other) {
          if (skipGenerate) {
            setContentLocale(other)
            openEditionRef.current(periodDate, other, row)
          } else {
            setView({ status: 'locale-missing', locale: localeForLoad, date: periodDate })
          }
        } else if (await serviceRunInFlight()) setView({ status: 'loading' })
        else setView({ status: 'no-edition', date: periodDate, failed: false })
      } else if (skipGenerate && !keptCachedToday) {
        // Nothing is left for that day — same sentence as any day that never generated.
        setView({ status: 'no-edition', date: pinnedDate ?? periodDate, failed: false })
      } else if (!keptCachedToday) {
        // A read that failed still says so. The delete reload is the opposite case: today was never
        // read, so it must not be reported as unreadable — the row the list already returned stands.
        const generationTrace = readGenerationTrace((today as unknown as Readonly<{ generationTrace?: unknown }> | undefined)?.generationTrace)
        const stale = lastReadyRef.current
        // A retry that failed after an earlier success: the issue still has an edition, so the reader
        // keeps reading it under the failure notice. Only a day that never produced one goes blank.
        // The stale copy is what a failed retry keeps on screen. A delete reload is the opposite:
        // the reader removed that edition, so putting it back would undo their action.
        if (!skipGenerate && stale && stale.edition.date === todayDate && rows.some((row) => row.date === todayDate && row.state !== 'missing')) {
          setView({ status: 'ready', document: stale, kind: 'today' })
          setShowingStale(true)
          setRegenerating(false)
          return
        }
        setView({
          status: 'unavailable',
          ...(today?.state === 'unavailable' ? { failureCode: today.failureCode } : {}),
          ...(generationTrace ? { generationTrace } : {})
        })
      }
      setEditions(rows.slice(0, 14))
      setRegenerating(false)
    })()
    return () => { active = false }
  }, [client, reloadKey])

  useEffect(() => {
    let active = true
    if (!client.getSettings) {
      // No settings reader at all: there is no English edition to switch to.
      setLanguageSettingsKnown(true)
      return undefined
    }
    void client.getSettings().then((result) => {
      if (!active || result.state !== 'available') return
      setWebSearchEnabled(result.view.settings.webSearchEnabled)
      setEnglishEditionsEnabled(result.view.language.settings.additional.includes('en-US'))
      setLanguageSettingsKnown(true)
      setZoneInvalid(result.view.generation.periods?.[0]?.generationTimeZoneInvalid ?? null)
      const plan = result.view.language.plan.primary; setLanguageFallback(plan.fallbackReason === 'ui-language-unsupported' ? plan.requested : null)
    }).catch(() => { if (active) setLanguageSettingsKnown(true) })
    return () => { active = false }
  }, [client, settingsReloadKey])

  // The stored edition language arrives with the settings answer, after the first read. Reading
  // again here is the open path (it may generate today); the language tab never comes through it.
  const initialLocaleAppliedRef = useRef(false)
  useEffect(() => {
    if (!languageSettingsKnown || initialLocaleAppliedRef.current) return
    initialLocaleAppliedRef.current = true
    if (loadedLocaleRef.current !== null && loadedLocaleRef.current !== effectiveLocale) setReloadKey((key) => key + 1)
  }, [effectiveLocale, languageSettingsKnown])

  // A setting changed in the drawer (or in another window) takes effect without a reload.
  useEffect(() => {
    const bump = (): void => setSettingsReloadKey((key) => key + 1)
    const onVisibility = (): void => { if (document.visibilityState === 'visible') bump() }
    window.addEventListener('focus', bump)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', bump)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  /**
   * The one way an edition is read: a row click and a language switch both land here, with the
   * date the reader is on and the language they asked for. It never generates.
   */
  const openEdition = (date: string, target: 'zh-CN' | 'en-US', rowHint?: { state: string; attemptCount?: number }): void =>
    openBriefingEdition({
      client, date, locale: target, rows: editions, todayDate, current: view, request: requestRef,
      onStart: setPinnedDate,
      onFailureCleared: () => setRegenerateFailure(null),
      setView,
      ...(rowHint ? { row: rowHint } : {})
    })
  openEditionRef.current = openEdition
  const selectEdition = (date: string): void => openEdition(date, effectiveLocaleRef.current)
  const { regenerate, generateNow } = useBriefingRunActions({
    client, locale, zoneInvalid, timeZone,
    setView, setRegenerating, setRegenerateFailure, setEditions,
    setCurrentPeriodDate, onSettled: () => setReloadKey((key) => key + 1)
  })

  const { exportState, copyState, exportImage, copy } = useBriefingShareActions({
    document: view.status === 'ready' ? view.document : undefined,
    locale, text, ...(eventTitles ? { eventTitles } : {}), shareRef
  })

  const { failure, editorialBlocked } = briefingFailure({ view, regenerateFailure })
  // A stored edition under a failure notice is content, not a blocked state.
  const contentBlocked = editorialBlocked || (regenerateFailure !== null && view.status !== 'ready')
  // A ready pane always knows its own date; an emptied one falls back to where the reader was,
  // so a delete never makes the rail jump to today.
  const selectedDate = view.status === 'ready' ? view.document.edition.date : (pinnedDate ?? todayDate)
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
  // The right-hand archive follows "this issue has an edition", not "the latest attempt succeeded":
  // regenerating today, or failing after an earlier success, must not make the stored archive vanish.
  // The archive belongs to the edition on screen, not to "today": reading a past edition must show
  // its trace and gaps even when today has never been generated.
  // The column is always there, and the language switch lives at its top: the two must not be
  // able to take each other away. Its audit blocks render only when the issue has an edition.
  const hasArchive = !contentBlocked && view.status === 'ready'
  // The newest edition the list still holds is the last one that actually generated: an unreadable
  // state may quote it, so "unreadable" is not mistaken for "nothing was ever made".
  const { lastGeneratedAt, scheduledTime, todayMissing, hasTodayEdition } = briefingListFacts(editions, todayDate)
  // The one action that spends a run, and only after a click. It writes this issue, then the list is
  // read again (a read) so the row shows what just landed.
  // What an empty page can honestly say: the schedule it would run at, in the reader's own zone.
  const openModelService = onOpenModelSettings ?? openModelSettings
  // The grid never changes shape: the detail column keeps its width even with nothing to show, so the
  // body does not jump sideways when an edition appears or disappears.
  const bodyClass = 'mi-daily-briefing-page__body mi-daily-briefing-page__body--with-appendix'
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
      <DailyBriefingPageActions
        text={text}
        resolveText={resolveProductText}
        progress={liveProgress}
        loading={view.status === 'loading'}
        generating={generating}
        regenerating={regenerating}
        todayReady={view.status === 'ready' && view.kind === 'today'}
        hasTodayEdition={hasTodayEdition}
        targetDate={todayDate}
        zoneInvalid={zoneInvalid !== null}
        systemZone={view.status === 'ready' && view.timeZoneSource === 'system'}
        exportable={view.status === 'ready' && !contentBlocked}
        exportState={exportState}
        copyState={copyState}
        onExport={() => void exportImage()}
        onCopy={() => void copy()}
        onOpenSettings={() => setSettingsSection('generation')}
        onGenerate={generateNow}
        onRegenerate={regenerate}
      />
    </header>
    <div className={bodyClass}>
      <DailyBriefingHistoryRail editions={editions} failed={editionsFailed} loading={editionsLoading} onRetry={() => setReloadKey((key) => key + 1)} selectedDate={selectedDate} todayDate={todayDate}
        generatingStage={generating ? (progressUnreadable ? text.generationProgress.unknownStage : ((liveProgress ? runningRowName(liveProgress, text) : undefined) ?? text.generationProgress.railRunning)) : undefined}
        locale={locale} text={text} timeZone={timeZone} resolveText={resolveProductText} onSelect={selectEdition}
        onDeletePeriod={(target) => {
          // Decide what to show next before the delete runs: the other language of this issue, if
          // there is one. The reload consumes it, so the switch and the pane move together.
          const row = editions.find((edition) => edition.date === target.date)
          const other = (row?.availableLocales ?? []).find((language) => language !== target.locale)
          afterDeleteLocaleRef.current = other ?? null
          // 删完再读一次：行还在就说明没删掉，比悄悄把它从列表里抹掉诚实。
          void deletePeriod(target)
        }} />
      <DailyBriefingContent {...{
        text, view, generating, failure, regenerating, liveProgress, progressUnreadable, resolveProductText,
        editions, lastGeneratedAt, timeZone, todayDate, scheduledTime, editionText, editionLocale,
        eventTitles, formatTime, contentBlocked, deleteOutcome, languageFallback, webSearchEnabled,
        settingsOpen: settingsSection !== null, onGenerate: generateNow, onRetry: () => void regenerate(),
        onOpenSettings: () => setSettingsSection('ai'), onConfigureSources,
        onDeleteRetry: (target) => void deletePeriod(target)
      }} />
      <DailyBriefingAppendix {...{
        text, view, contentBlocked, hasArchive, issues, issueCounts, groups, generationTrace, formatTime,
        editionLocale, englishEditionsEnabled, contentLocale, issuesOpen, setIssuesOpen, openGroup,
        setOpenGroup, listAttempts: client.listAttempts,
        onSwitch: (value) => { setContentLocale(value); openEdition(pinnedDate ?? todayDate, value) }
      }} />
    </div>
    {activeGroup ? <DailyBriefingIssueDrawer group={activeGroup} text={text} formatTime={formatTime} onClose={() => setOpenGroup(null)} /> : null}
    {/* Mounted only while open: both blocks read settings on mount, so a closed page reads none. */}
    {settingsSection ? <DailyBriefingSettingsDrawer client={client} open section={settingsSection} text={text}
      onConfigureWebSearch={onConfigureWebSearch ?? openWebSearchSettings}
      onOpenModelSettings={openModelService}
      onClose={() => {
        setSettingsSection(null)
        // Saving may have added or removed the English edition: read the settings again.
        setSettingsReloadKey((key) => key + 1)
      }} /> : null}
    {view.status === 'ready' && !contentBlocked ? <div className="mi-daily-briefing-share-host" aria-hidden="true">
      {/* The exported node only: rows that are just a fallback reading stay on the page above. */}
      <div ref={shareRef}><DailyBriefingShareCard document={view.document} text={poster.text} locale={poster.locale} readOnly={view.kind === 'history'} omitFallbackReadings {...(poster.completenessNote ? { completenessNote: poster.completenessNote } : {})} {...(eventTitles ? { eventTitles } : {})} formatTime={formatTime} /></div>
    </div> : null}
  </main>
}
