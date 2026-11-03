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
  summaryFromDocument,
  withDeadline
} from './dailyBriefingPageDerived'

import type { DailyBriefingPageViewState as ViewState } from './dailyBriefingPageViewState'
import { DailyBriefingLanguageSwitch } from './DailyBriefingLanguageSwitch'
import { openBriefingEdition } from './openBriefingEdition'
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
  // Follows the run only while one is in flight: the hook stops and forgets on its own.
  const generating = view.status === 'loading' || regenerating
  // With the switch unavailable the stored choice must not decide anything: rendering and requests use
  // the interface language, while the stored preference itself is left untouched for when it returns.
  const effectiveLocale = englishEditionsEnabled ? contentLocale : locale
  const effectiveLocaleRef = useRef(effectiveLocale)
  effectiveLocaleRef.current = effectiveLocale
  useEffect(() => {
    if (view.status === 'ready') lastReadyRef.current = view.document
  }, [view])
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
      const cachedRow = rows.find((row) => row.date === todayDate && row.state === 'generated')
      let keptCachedToday = false
      if (cachedRow) {
        const cached = await client.get({ date: cachedRow.date, locale: localeForLoad }).catch(() => undefined)
        // On the delete reload the captured `view` is the one from before (still ready), and no
        // getToday answer follows to fill the screen: the list's row is what must stand.
        if (active && cached?.state === 'available' && (view.status === 'loading' || skipGenerate)) {
          setView({ status: 'ready', document: cached.document, kind: 'today' })
          keptCachedToday = true
        } else if (active && skipGenerate && cached?.state !== 'available') {
          // The reader just deleted the edition they were reading. If the issue still has another
          // language, fall back to it instead of leaving them on an empty pane; the switch is a
          // read, so it must not open a run.
          const other = (cachedRow.availableLocales ?? []).find((candidate) => candidate !== localeForLoad)
          if (other) {
            setContentLocale(other)
            openEditionRef.current(cachedRow.date, other, cachedRow)
            // The pane is being handled by the other language's read: the branches below must not
            // overwrite it with "nothing here".
            keptCachedToday = true
          }
        }
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
        // the truth. Read that edition by its date before telling the reader anything.
        openEditionRef.current(periodDate, localeForLoad, rows.find((edition) => edition.date === periodDate))
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
        } else setView({ status: 'no-edition', date: periodDate, failed: false })
      } else if (skipGenerate && !keptCachedToday) {
        // Nothing is left for that day. It is the ordinary "nothing generated yet" state, not a
        // special one: what the reader did is said by the one-time delete note, not by the pane.
        setView({ status: 'no-edition', date: pinnedDate ?? todayDate, failed: false })
      } else if (!skipGenerate || !keptCachedToday) {
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
  const regenerate = async (): Promise<void> => {
    setRegenerating(true)
    setRegenerateFailure(null)
    const outcome = await runBriefingRegenerate({ client, locale, timeZone: zoneInvalid ? 'UTC' : timeZone })
    if (outcome.kind === 'available') {
      setView({ status: 'ready', document: outcome.document, kind: 'today' })
      setEditions((current) => current.map((edition) => edition.date === outcome.document.edition.date ? summaryFromDocument(outcome.document) : edition))
    } else {
      setRegenerateFailure(outcome.failure)
    }
    setRegenerating(false)
  }

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
  const hasTodayEdition = editions.some((edition) => edition.date === todayDate && edition.state !== 'missing')
  // The archive belongs to the edition on screen, not to "today": reading a past edition must show
  // its trace and gaps even when today has never been generated.
  // The column is always there, and the language switch lives at its top: the two must not be
  // able to take each other away. Its audit blocks render only when the issue has an edition.
  const hasArchive = !contentBlocked && view.status === 'ready'
  // The newest edition the list still holds is the last one that actually generated: an unreadable
  // state may quote it, so "unreadable" is not mistaken for "nothing was ever made".
  const lastGeneratedAt = editions.find((edition) => edition.generatedAt && edition.state !== 'missing')?.generatedAt
  // The one action that spends a run, and only after a click. It writes this issue, then the list is
  // read again (a read) so the row shows what just landed.
  const generateNow = (): void => {
    setRegenerateFailure(null)
    setRegenerating(true)
    void runBriefingRegenerate({ client, locale, timeZone: zoneInvalid ? 'UTC' : timeZone })
      .then((outcome) => {
        if (outcome.kind === 'available') {
          setView({ status: 'ready', document: outcome.document, kind: 'today' })
          setCurrentPeriodDate(outcome.document.edition.date)
        } else {
          setRegenerateFailure(outcome.failure)
        }
      })
      .finally(() => {
        setRegenerating(false)
        setReloadKey((key) => key + 1)
      })
  }
  // What an empty page can honestly say: the schedule it would run at, in the reader's own zone.
  const scheduledTime = editions.find((edition) => edition.scheduledTime !== undefined)?.scheduledTime
  const todayMissing = editions.some((edition) => edition.date === todayDate && edition.state === 'missing')
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
      <section className="mi-daily-briefing-page__content">
        {deleteOutcome ? <DailyBriefingDeleteOutcomeNote outcome={deleteOutcome} text={text} onRetry={(outcome) => void deletePeriod(outcome.target)} /> : null}
        <DailyBriefingLanguageFallback requested={languageFallback} text={text} />
        <DailyBriefingStorageNotice text={text.migration} />
        {webSearchEnabled === false && settingsSection === null ? <div className="mi-daily-briefing-page__websearch-warning" role="alert">
          <div><strong>{text.aiSettings.webSearchOff}</strong><small>{text.aiSettings.webSearchOffHint}</small></div>
          <Button data-open-settings-section="ai" onClick={() => setSettingsSection('ai')}>{text.aiSettings.goEnable}</Button>
        </div> : null}
        {view.status === 'loading' ? <DailyBriefingGeneratingView formatTime={formatTime} progress={liveProgress} progressUnreadable={progressUnreadable} resolveText={resolveProductText} text={text} /> : null}
        {view.status === 'unavailable' && !failure
          ? <DailyBriefingEmptyState editions={editions} formatTime={formatTime} lastGeneratedAt={lastGeneratedAt} onGenerate={generateNow} text={text} timeZone={timeZone} todayDate={todayDate} />
          : null}
        {view.status === 'locale-missing' ? <DailyBriefingLocaleMissing locale={view.locale} currentPeriod={view.historical !== true && view.date === todayDate} historical={view.historical === true} text={text} onGenerate={generateNow} /> : null}
        {view.status === 'no-edition' ? <DailyBriefingNoEditionPanel view={view} text={text} timeZone={timeZone} scheduledTime={scheduledTime} currentPeriodDate={todayDate} formatTime={formatTime} onOpenSettings={() => setSettingsSection('ai')} /> : null}
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
      <aside className="mi-daily-briefing-page__appendix" data-briefing-detail="true" aria-label={text.sections.limits} {...(hasArchive && issues.length > 0 ? { 'data-briefing-issues': 'true' } : {})}>
        {englishEditionsEnabled ? <DailyBriefingLanguageSwitch value={contentLocale}
          onChange={(value) => {
            // Same read path as a row click, with the language swapped: no second implementation.
            setContentLocale(value)
            openEdition(pinnedDate ?? todayDate, value)
          }} /> : null}
        {hasArchive ? <>
        <section data-briefing-gaps="true">
        {issues.length > 0 ? <details className="mi-briefing-gaps" open={issuesOpen}
          onToggle={(event) => setIssuesOpen((event.currentTarget as HTMLDetailsElement).open)}>
          {/* The counts are the verdict, not the detail: they stay on the summary line even closed. */}
          <summary className="mi-briefing-gaps__head">
            <h2>{text.sections.limits}</h2>
            <span className="mi-briefing-gaps__counts">{issueCountsText(issueCounts, text)}</span>
          </summary>
          <ol className="mi-daily-briefing-page__groups">
            {groups.map((group) => <li key={group.key}>
              {/* Three facts on the row: how bad, which kind, how many. The long titles live in the
                  drawer this opens — keeping them here is what made two of them overlap. */}
              <Button className="mi-daily-briefing-page__group" aria-haspopup="dialog"
                aria-label={text.limits.openGroup.replace('{label}', group.label).replace('{count}', String(group.count))}
                data-group-key={group.key} data-group-severity={group.severity} data-group-category={group.category}
                onClick={(event) => setOpenGroup({ key: group.key, trigger: event.currentTarget })}>
                <span data-issue-severity={group.severity} className="mi-daily-briefing-page__group-severity">{text.limits.severity[group.severity]}</span>
                <span data-issue-label={group.label} className="mi-daily-briefing-page__group-label" title={group.label}>{group.label}</span>
                <span data-issue-count={group.count} className="mi-daily-briefing-page__group-count">{text.limits.groupCount.replace('{count}', String(group.count))}</span>
              </Button>
            </li>)}
          </ol>
        </details> : null}</section>
        <div data-briefing-stages="true"><DailyBriefingGenerationTimeline trace={generationTrace} text={text} formatTime={formatTime} /></div>
        {view.status === 'ready' ? <DailyBriefingAttempts date={view.document.edition.date} periodId="default" locale={editionLocale} text={text} loadAttempts={client.listAttempts ? (date, periodId, language) => client.listAttempts!({ date, locale: language, periodId }) : undefined} /> : null}
        </> : null}
      </aside>
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
