import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import { toPng } from 'html-to-image'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import { DEFAULT_PERIOD_ID, briefingEditionPeriod, type DailyBriefingDocument, type DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { dailyBriefingToMarkdown } from '../../../contracts/dailyBriefingMarkdown'
import { dailyBriefingClient, type DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { openModelSettings, openWebSearchSettings } from '../../shared/navigation/productShellNavigation'
import { briefingTextForLocale, resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'
import { DailyBriefingHistoryRail, railClock } from './DailyBriefingHistoryRail'
import { DailyBriefingDeleteOutcomeNote } from './DailyBriefingDeleteOutcomeNote'
import { useBriefingShareActions } from './useBriefingShareActions'
import { runBriefingRegenerate } from './runBriefingRegenerate'
import { useBriefingEditionDelete } from './useBriefingEditionDelete'
import { DailyBriefingSettingsDrawer, type BriefingSettingsSection } from './DailyBriefingSettingsDrawer'
import { withWindowHours } from './dailyBriefingWindowText'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'
import { briefingIssueCounts, briefingIssues, groupBriefingIssues } from './dailyBriefingIssues'
import { briefingExportFileName, posterExportBackground } from './dailyBriefingExport'
import { DailyBriefingIssueDrawer } from './DailyBriefingIssueDrawer'
import { DailyBriefingPageBar } from './DailyBriefingPageBar'
import { DailyBriefingLiveSteps, runningRowName } from './DailyBriefingLiveSteps'
import { useDailyBriefingProgress } from './useDailyBriefingProgress'
import { useBriefingSettingsFacts } from './useBriefingSettingsFacts'
import { readGenerationTrace, type GenerationTrace } from './dailyBriefingGenerationTrace'
import { DailyBriefingFailurePanel, type BriefFailure } from './DailyBriefingFailurePanel'
import { DailyBriefingAttempts } from './DailyBriefingAttempts'
import { DailyBriefingEmptyState } from './DailyBriefingEmptyState'
import { DailyBriefingGeneratingView } from './DailyBriefingGeneratingStates'
import { DailyBriefingEditionActions } from './DailyBriefingPageActions'
import { briefingEditionSelection } from './briefingEditionSelection'
import { DailyBriefingGenerationTimeline } from './DailyBriefingGenerationTimeline'
import { DailyBriefingLanguageFallback } from './DailyBriefingLanguageFallback'
import { posterProps } from './dailyBriefingPoster'
import { briefingChangeArrows, briefingFearGreedBuckets, briefingPaymentDirections, briefingPolicyGaugeWords } from './dailyBriefingPaymentDirections'
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
  mergeEditionSummary,
  summaryFromDocument,
  withDeadline
} from './dailyBriefingPageDerived'

import type { DailyBriefingPageViewState as ViewState } from './dailyBriefingPageViewState'
import { openBriefingEdition } from './openBriefingEdition'
import { DailyBriefingAppendix } from './DailyBriefingAppendix'
import { useBriefingEditionReader } from './useBriefingEditionReader'
import { briefingDocument, briefingRowState, briefingViewStatus, isBriefingLoading, readyKind, readyZone, resolveBriefingMode } from './dailyBriefingMode'
import { DailyBriefingContent } from './DailyBriefingContent'
import { useBriefingRunActions } from './useBriefingRunActions'
import { DailyBriefingNoEditionPanel } from './DailyBriefingNoEditionPanel'
import { briefingPushText } from './dailyBriefingPushText'
import { useBriefingManualRun } from './useBriefingManualRun'
import { briefingManualRunReport } from './briefingManualRunOutcome'
import { briefingPageChrome } from './briefingPageChrome'
import { useBriefingPushToPhone } from './useBriefingPushToPhone'
import type { BriefingEditionDeleteTarget } from './briefingEditionDeleteConfirm'

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
  // One edition, one cache entry: `${date}:${locale}`. Switching language back and forth must hit
  // this instead of re-reading, and a read must never overwrite a language it did not ask for.
  const editionCacheRef = useRef(new Map<string, DailyBriefingDocument>())
  // The issue day the list reported, readable from the reader without waiting for a render: the
  // "today or history" decision must not depend on whether the list answer had landed yet.
  const periodDateRef = useRef<string | null>(null)
  const openEditionRef = useRef<(date: string, locale: 'zh-CN' | 'en-US', row?: DailyBriefingEditionSummary) => void>(() => undefined)
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
  // 天头要画哪些日子：服务侧按「有版次 ∨ 有过运行记录 ∨ 今天是今天」算好一起交下来。
  // 缺了就是旧服务端，rail 退回"天头来自版次"的旧行为——不要在这里自己推一份。
  const [railDates, setRailDates] = useState<readonly string[] | undefined>(undefined)
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
  // Which edition is on screen: language is part of its identity now, chosen by the row badges.
  const [pickedLocale, setPickedLocale] = useState<'zh-CN' | 'en-US' | undefined>(undefined)
  const [pickedPeriodId, setPickedPeriodId] = useState<string | undefined>(undefined)
  // 删除一个入口、一套行为：工具栏第五颗与行右键都走这里；"删哪一版"和"是否正在删"各只有一个答案。
  const { deleteOutcome, deleting, deleteEdition, takeSkipGenerate, retryDelete } = useBriefingEditionDelete({
    client, editions, afterDeleteLocaleRef, onSettled: () => setReloadKey((key) => key + 1)
  })
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
  const readyDocument = briefingDocument(view)
  // 当前这一版的身份，交给删除的确认框点名。时刻取这一版自己的名义截止（读者时区），不是"现在"。
  const deleteTarget = readyDocument === undefined ? undefined : (() => {
    const period = briefingEditionPeriod(readyDocument.edition)
    return { date: readyDocument.edition.date, clock: railClock(period.periodTime, timeZone), language: readyDocument.edition.locale, periodId: period.periodId }
  })()
  const loading = isBriefingLoading(view)
  const busyLocally = loading || regenerating
  // With the switch unavailable the stored choice must not decide anything: rendering and requests use
  // the interface language, while the stored preference itself is left untouched for when it returns.
  const effectiveLocale = pickedLocale ?? locale
  const effectiveLocaleRef = useRef(effectiveLocale)
  effectiveLocaleRef.current = effectiveLocale
  useEffect(() => {
    const ready = briefingDocument(view)
    if (ready) lastReadyRef.current = ready
  }, [view])
  // Always polling: the run that matters may have been started by the schedule, not by this page.
  const progress = useDailyBriefingProgress({ client, running: true, locale, timeZone, intervalMs: 1_500 })
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
    setRailDates(undefined)
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
      if (afterDeleteLocale && afterDeleteLocale !== effectiveLocaleRef.current) setPickedLocale(afterDeleteLocale)
      loadedLocaleRef.current = localeForLoad
      const todayPromise = skipGenerate
        ? Promise.resolve(undefined)
        : withDeadline(client.getToday({ locale: localeForLoad, timeZone: timeZoneRef.current, generate: false }), 15_000).catch(() => undefined)
      const listed = await withDeadline(client.list({ locale: localeForLoad, timeZone: timeZoneRef.current }), 8_000).catch(() => undefined)
      if (!active) return
      // The issue day this load is about: the service's, when the list answered.
      const periodDate = listed?.state === 'available' && typeof listed.result.today === 'string' ? listed.result.today : todayDate
      setCurrentPeriodDate(periodDate)
      periodDateRef.current = periodDate
      let rows: readonly DailyBriefingEditionSummary[] = listed?.state === 'available' ? [...listed.result.editions] : []
      setEditions(rows.slice(0, 14))
      setRailDates(listed?.state === 'available' ? listed.result.dates : undefined)
      // The list has been read: from here an empty rail means "none" — unless the read itself failed.
      setEditionsLoading(false)
      setEditionsFailed(listed?.state !== 'available')
      // The row this load is about. `periodDate` is the list's own answer; using the wall-clock
      // `todayDate` here is what made a delete reload look at a day the list does not contain, find
      // nothing, and report the whole issue as empty.
      const periodRow = rows.find((row) => row.date === periodDate)
      if (skipGenerate) {
        // A delete reload reads the edition that is left, in the language that is left. The language
        // is decided before the read, so the switch and the pane cannot disagree; the deleted entry
        // is dropped from the cache so the read cannot answer with what was just removed.
        const available = periodRow?.availableLocales ?? []
        const wanted = available.includes(localeForLoad) ? localeForLoad : available.find((candidate) => candidate !== localeForLoad)
        if (wanted) {
          if (wanted !== localeForLoad) setPickedLocale(wanted)
          const read = await readEdition(periodDate, wanted, { fresh: true })
          if (!active) return
          if (read.kind === 'available') return
        }
        setView({ status: 'no-edition', date: periodDate, failed: false })
        return
      }
      const today = await todayPromise
      if (!active) return
      if (today?.state === 'available') {
        const date = today.document.edition.date
        setCurrentPeriodDate(date)
        // 只回写**读到的那一行**（日期 + 期号 + 语言）：按日期整片替换会把同一天另一种语言的行
        // 也写成这一版，两行于是同键同语言，React 会把它们当同一行复用，右键与删除落到另一行上。
        rows = mergeEditionSummary(rows, today.document)
        setView({
          status: 'ready',
          document: today.document,
          kind: 'today',
          ...(today.timeZoneSource === 'system' ? { timeZoneSource: 'system' as const } : {})
        })
        setRegenerateFailure(null)
      } else if (today?.state === 'unavailable' && today.failureCode === 'not-generated'
        && rows.some((edition) => edition.date === periodDate && edition.availableLocales.includes(localeForLoad))) {
        // The list says this language exists, so the answer "nothing written" is the read's miss, not
        // the truth. Read that edition by its date and put the answer on screen here — handing it to
        // the row path made the result depend on state that was still settling after a delete.
        const recovered = await readEdition(periodDate, localeForLoad, { fresh: true })
        if (!active) return
        if (recovered.kind === 'available') {
          setRegenerateFailure(null)
          return
        }
        setView({ status: 'locale-missing', locale: localeForLoad, date: periodDate })
      } else if (today?.state === 'unavailable' && today.failureCode === 'not-generated') {
        // Nothing is written in this language. Whether that means "the issue has no content" or
        // "this issue has the other language" is the list's answer, not this branch's guess.
        const row = rows.find((edition) => edition.date === periodDate)
        const other = (row?.availableLocales ?? []).find((candidate) => candidate !== localeForLoad)
        if (other) {
          if (skipGenerate) {
            setPickedLocale(other)
            openEditionRef.current(periodDate, other, row)
          } else {
            setView({ status: 'locale-missing', locale: localeForLoad, date: periodDate })
          }
        } else setView({ status: 'no-edition', date: periodDate, failed: false })
      } else if (false) {
        // Nothing is left for that day — same sentence as any day that never generated.
        setView({ status: 'no-edition', date: pinnedDate ?? periodDate, failed: false })
      } else {
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
      setRailDates(listed?.state === 'available' ? listed.result.dates : undefined)
      setRegenerating(false)
    })()
    return () => { active = false }
  }, [client, reloadKey])

  // 三项事实一次读出来（web search、时区、写不了的语言），外加"该重读了"这个计数：抽屉关了、窗口
  // 重新聚焦、别的窗口改了设置，都只是把计数 +1。
  const { webSearchEnabled, languageFallback, zoneInvalid, settingsReloadKey, reloadSettings } = useBriefingSettingsFacts(client)

  /**
   * The one way an edition is read: a row click and a language switch both land here, with the
   * date the reader is on and the language they asked for. It never generates, and the answer is
   * cached per `${date}:${locale}` so switching back is a render, not another read.
   */
  const { readEdition, openEdition } = useBriefingEditionReader({
    client, editions, todayDate, readyDocument, requestRef,
    cache: editionCacheRef, periodDate: periodDateRef,
    setView, setPinnedDate, setRegenerateFailure
  })
  openEditionRef.current = openEdition
  const { selectEdition, selectLocale } = briefingEditionSelection({
    editions, effectiveLocale: () => effectiveLocaleRef.current, openEdition, setPickedLocale, setPickedPeriodId
  })
  const { regenerate, generateNow } = useBriefingRunActions({
    client, locale, zoneInvalid, timeZone,
    setView, setRegenerating, setRegenerateFailure, setEditions,
    setCurrentPeriodDate, todayDate, onSettled: () => setReloadKey((key) => key + 1)
  })
  const runManual = useBriefingManualRun({
    timeZone,
    regenerate,
    running: generating,
    // A7.10 的查重键：同一 (日期, 截止时刻, 窗口, 语言) 已经有一版时，先问替换——再插一行就是两份
    // 说同一件事的版次。手动期才有这个键，排期期按它自己的期号走。
    findDuplicate: ({ asOf, windowHours, language }) => {
      const existing = editions.find((edition) => edition.periodKind === 'manual'
        && edition.periodTime === asOf
        && edition.windowHours === windowHours
        && edition.locale === language)
      return existing === undefined ? undefined : { periodId: existing.periodId }
    }
  })
  // 说什么（重复时点名哪一版、点下去替换哪一版）与"能不能跑"分开：文案和替换动作在同一个模块里，
  // 页面只把结果交给工具栏。
  const onManualRun = (draft: Parameters<typeof runManual>[0]) =>
    briefingManualRunReport({ result: runManual(draft), text, timeZone, regenerate })

  const { exportState, copyState, exportImage, copy } = useBriefingShareActions({
    document: readyDocument,
    locale, text, ...(eventTitles ? { eventTitles } : {}), shareRef
  })

  const { failure, editorialBlocked } = briefingFailure({ view, regenerateFailure })
  // A stored edition under a failure notice is content, not a blocked state.
  const contentBlocked = editorialBlocked || (regenerateFailure !== null && view.status !== 'ready')
  /**
   * The reader's own publication, of the edition on screen.
   *
   * The issue is the one being read, so its `periodId` comes from that date's row: the platform keys the
   * notice by date, language and issue, and a wrong issue is refused rather than quietly sent as another
   * one. The words are interface chrome, so they follow the interface language, not the edition's.
   */
  const pushToPhone = useBriefingPushToPhone({
    document: contentBlocked ? undefined : readyDocument,
    generating,
    localeMissing: view.status === 'locale-missing',
    periodId: editions.find((row) => row.date === readyDocument?.edition.date)?.periodId ?? DEFAULT_PERIOD_ID,
    text: briefingPushText[locale],
    // The channel is configured somewhere else (that drawer, or the platform's own settings). Re-read
    // when it may have changed, or the button keeps the verdict it formed at mount.
    refreshKey: settingsReloadKey
  })
  // A ready pane always knows its own date; an emptied one falls back to where the reader was,
  // so a delete never makes the rail jump to today.
  const selectedDate = readyDocument ? readyDocument.edition.date : (pinnedDate ?? todayDate)
  const selectedLocale = readyDocument?.edition.locale
  // The right rail audits the edition that was actually generated: a missing source, a hidden
  // change and the conclusion's own gaps are separate facts, not one generic caveat list.
  const issues = readyDocument && !contentBlocked
    ? briefingIssues({
        document: readyDocument,
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
  const generationTrace = readyDocument
    ? readGenerationTrace((readyDocument.provenance as unknown as Readonly<{ generationTrace?: unknown }>).generationTrace)
    : undefined
  // The right-hand archive follows "this issue has an edition", not "the latest attempt succeeded":
  // regenerating today, or failing after an earlier success, must not make the stored archive vanish.
  // The archive belongs to the edition on screen, not to "today": reading a past edition must show
  // its trace and gaps even when today has never been generated.
  // The column is always there, and the language switch lives at its top: the two must not be
  // able to take each other away. Its audit blocks render only when the issue has an edition.
  const hasArchive = !contentBlocked && readyDocument !== undefined
  // The newest edition the list still holds is the last one that actually generated: an unreadable
  // state may quote it, so "unreadable" is not mistaken for "nothing was ever made".
  const { lastGeneratedAt, scheduledTime, todayMissing, hasTodayEdition } = briefingListFacts(editions, todayDate)
  // One answer for the whole page: the row says which issue state this is, the pane says what it
  // holds, and the mode combines them. Branches read this, not the pieces.
  const modeRow = editions.find((edition) => edition.date === todayDate)
  const mode = resolveBriefingMode({
    rowState: briefingRowState(modeRow, generating),
    viewStatus: briefingViewStatus(view),
    hasEdition: hasTodayEdition,
    localeAvailable: modeRow ? modeRow.availableLocales.includes(effectiveLocale) : true
  })
  const { openModelService, bodyClass, poster, editionText, editionLocale } = briefingPageChrome({
    onOpenModelSettings, readyDocument, editions, text, locale
  })

  return <main className="intelligence-page mi-daily-briefing-page" aria-label={text.title}>
    <DailyBriefingPageBar
      text={text}
      resolveText={resolveProductText}
      progress={liveProgress}
      loading={loading}
      generating={generating}
      regenerating={regenerating}
      todayReady={readyDocument !== undefined && readyKind(view) === 'today'}
      targetDate={todayDate}
      zoneInvalid={zoneInvalid !== null}
      systemZone={readyDocument !== undefined && readyZone(view) === 'system'}
      onManualRun={onManualRun}
      onOpenSettings={() => setSettingsSection('generation')}
      onBack={onBack}
    />
    <div className={bodyClass}>
      <DailyBriefingHistoryRail editions={editions} failed={editionsFailed} loading={editionsLoading} onRetry={() => setReloadKey((key) => key + 1)} selectedDate={selectedDate} selectedPeriodId={pickedPeriodId} selectedLocale={effectiveLocale} todayDate={todayDate}
        // 一行 = 一期 = 一种语言：点行要把**这一行**的三样身份交出去；只传日期的话，同一天两期
        // 永远落到第一行，读者看到的是"切换了但内容不切"。
        onSelectLocale={selectLocale}
        {...(railDates === undefined ? {} : { dates: railDates })}
        generatingStage={generating ? (progressUnreadable ? text.generationProgress.unknownStage : ((liveProgress ? runningRowName(liveProgress, text) : undefined) ?? text.generationProgress.railRunning)) : undefined}
        locale={locale} text={text} timeZone={timeZone} resolveText={resolveProductText} onSelect={selectEdition}
        // 行菜单的「重新生成这一期」：期号来自那一行，不是当前选中的那一期。
        onRegeneratePeriod={({ periodId, locale: target }) => { void regenerate({ periodId, locale: target }) }}
        // 行右键与工具栏第五颗共用同一个处理函数：两个入口，一套行为。
        onDeletePeriod={(target) => deleteEdition({ ...target, language: target.locale, ...(target.clock === undefined ? {} : { clock: target.clock }) })} />
      <DailyBriefingContent {...{
        // 版次级五颗：吸在正文滚动区顶部，只作用于当前这一版（重新生成 / 发布 / 导出 / 复制 / 删除）。
        editionBar: <DailyBriefingEditionActions
          text={text}
          resolveText={resolveProductText}
          exportable={readyDocument !== undefined && !contentBlocked}
          exportState={exportState}
          copyState={copyState}
          generating={generating}
          {...(deleteTarget === undefined ? {} : { deleteTarget })}
          deleting={deleting}
          onDelete={() => { if (deleteTarget !== undefined) deleteEdition(deleteTarget) }}
          onExport={() => void exportImage()}
          onCopy={() => void copy()}
          onRegenerate={() => void regenerate()}
          push={pushToPhone}
          pushText={briefingPushText[locale]}
        />,
        text, view, mode, generating, failure, regenerating, liveProgress, progressUnreadable, resolveProductText,
        editions, lastGeneratedAt, timeZone, todayDate, scheduledTime, editionText, editionLocale,
        eventTitles, formatTime, contentBlocked, deleteOutcome, languageFallback, webSearchEnabled,
        settingsOpen: settingsSection !== null, onGenerate: generateNow, onRetry: () => void regenerate(),
        onOpenSettings: () => setSettingsSection('ai'), onConfigureSources,
        onDeleteRetry: retryDelete
      }} />
      <DailyBriefingAppendix {...{
        text, view, contentBlocked, hasArchive, issues, issueCounts, groups, generationTrace, formatTime,
        editionLocale, issuesOpen, setIssuesOpen, openGroup,
        setOpenGroup, listAttempts: client.listAttempts, generating, liveProgress
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
        reloadSettings()
      }} /> : null}
    {readyDocument && !contentBlocked ? <div className="mi-daily-briefing-share-host" aria-hidden="true">
      {/* The exported node only: rows that are just a fallback reading stay on the page above. */}
      <div ref={shareRef}><DailyBriefingShareCard document={readyDocument} text={poster.text} locale={poster.locale} readOnly={readyKind(view) === 'history'} paymentDirectionsCompact={briefingPaymentDirections(poster.locale)} policyWords={briefingPolicyGaugeWords(poster.locale)} changeArrows={briefingChangeArrows(poster.locale)} fearGreedBuckets={briefingFearGreedBuckets(poster.locale)} {...(poster.completenessNote ? { completenessNote: poster.completenessNote } : {})} {...(eventTitles ? { eventTitles } : {})} formatTime={formatTime} /></div>
    </div> : null}
  </main>
}
