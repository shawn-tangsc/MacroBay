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

import { DEFAULT_PERIOD_ID, briefingEditionPeriod, isDailyBriefingWindowHours, type DailyBriefingDocument, type DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { dailyBriefingToMarkdown } from '../../../contracts/dailyBriefingMarkdown'
import { dailyBriefingClient, type DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { DAILY_BRIEFING_DOCUMENT_INVALID } from '../../shared/ipc/dailyBriefingFailureCodes'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { openModelSettings, openWebSearchSettings } from '../../shared/navigation/productShellNavigation'
import { briefingTextForLocale, resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'
import { briefingEventTitles } from './briefingEventTitles'
import { DailyBriefingHistoryRail, railClock } from './DailyBriefingHistoryRail'
import { DailyBriefingDeleteOutcomeNote } from './DailyBriefingDeleteOutcomeNote'
import { useBriefingShareActions } from './useBriefingShareActions'
import { runBriefingRegenerate } from './runBriefingRegenerate'
import { useBriefingEditionDelete } from './useBriefingEditionDelete'
import { DailyBriefingSettingsDrawer, type BriefingSettingsSection } from './DailyBriefingSettingsDrawer'
import { withWindowHours } from './dailyBriefingWindowText'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'
import { briefingDocumentInvalidIssue } from './briefingDocumentInvalidIssue'
import { briefingIssueCounts, briefingIssues, groupBriefingIssues } from './dailyBriefingIssues'
import { briefingExportFileName, posterExportBackground } from './dailyBriefingExport'
import { DailyBriefingIssueDrawer } from './DailyBriefingIssueDrawer'
import { DailyBriefingPageBar } from './DailyBriefingPageBar'
import { DailyBriefingLiveSteps, runningElapsedMsFor, runningRowName } from './DailyBriefingLiveSteps'
import { useDailyBriefingProgress } from './useDailyBriefingProgress'
import { useBriefingSettingsFacts } from './useBriefingSettingsFacts'
import { useBriefingReload } from './useBriefingReload'
import { readGenerationTrace, type GenerationTrace } from './dailyBriefingGenerationTrace'
import { DailyBriefingFailurePanel, type BriefFailure } from './DailyBriefingFailurePanel'
import { DailyBriefingAttempts } from './DailyBriefingAttempts'
import { DailyBriefingEmptyState } from './DailyBriefingEmptyState'
import { DailyBriefingGeneratingView } from './DailyBriefingGeneratingStates'
import { DailyBriefingEditionActions } from './DailyBriefingPageActions'
import { briefingEditionSelection, nextEditionAfterDelete } from './briefingEditionSelection'
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
import { DailyBriefingAppendix } from './DailyBriefingAppendix'
import { useBriefingEditionReader } from './useBriefingEditionReader'
import { briefingDocument, briefingRowState, briefingViewStatus, isBriefingLoading, readyKind, readyZone, resolveBriefingMode } from './dailyBriefingMode'
import { DailyBriefingContent } from './DailyBriefingContent'
import { useBriefingBackgroundRunReload } from './useBriefingBackgroundRunReload'
import { isManualGenerationDateAllowed } from '../../../contracts/dailyBriefingGenerationWindow'
import { useBriefingRunActions, type BriefingRunIntent } from './useBriefingRunActions'
import { DailyBriefingNoEditionPanel } from './DailyBriefingNoEditionPanel'
import { briefingPushText } from './dailyBriefingPushText'
import { useBriefingManualRun } from './useBriefingManualRun'
import { briefingManualRunReport, briefingManualRunningLabel } from './briefingManualRunOutcome'
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
  // 被删掉那一版的身份。删完之后"下一版是谁"按它取邻居——只按日期取当天第一行，会把读者送到
  // 不是邻居的那一期（11-03 这种一天两期的地方当场看得出来）。
  const afterDeleteRef = useRef<Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US' }> | null>(null)
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
  const pickedPeriodIdRef = useRef(pickedPeriodId); pickedPeriodIdRef.current = pickedPeriodId
  // 删除一个入口、一套行为：工具栏第五颗与行右键都走这里；"删哪一版"和"是否正在删"各只有一个答案。
  const { deleteOutcome, deleting, deleteEdition, takeSkipGenerate, retryDelete } = useBriefingEditionDelete({
    client, editions, afterDeleteLocaleRef, afterDeleteRef, onSettled: () => setReloadKey((key) => key + 1)
  })
  const [regenerating, setRegenerating] = useState(false)
  // 这一次在做什么：手动的一期，还是重跑当前那一版。工具栏与正文都读它，不各判一遍。
  const [runIntent, setRunIntent] = useState<BriefingRunIntent | null>(null)
  const [regenerateFailure, setRegenerateFailure] = useState<Readonly<{ code?: string; generationTrace?: GenerationTrace }> | null>(null)
  // Open by default: the reader asked to see the groups without a click; the counts stay on the
  // summary line either way.
  const [issuesOpen, setIssuesOpen] = useState(true)
  const [openGroup, setOpenGroup] = useState<Readonly<{ key: string; trigger: HTMLElement | null }> | null>(null)
  const shareRef = useRef<HTMLDivElement>(null)
  // **日期只有一个来源：读者本地日历的今天**（过 00:00 就换天，用户 2026-11-06 拍板）。
  // 以前这里还有一层"按排期时刻倒推当前属于哪一期"，于是凌晨 01:25 还把 11/05 当今天。
  const todayDate = useMemo(() => localDate(timeZone), [timeZone])
  // A run this page started, or one it is loading for. The service's own answer joins below.
  const readyDocument = briefingDocument(view)
  /**
   * **唯一一道身份闸门**：文档属于某一版，只有它的身份与选中项一致，它才算"屏幕上这一版"。
   * 正文、右列留痕、删除目标、推送、导出、复制、分享卡全部只读 `screenDocument`——以前它们各读
   * 裸的 `readyDocument`，于是停在 A 上手动生成时，右列还挂着 A 的留痕、导出导出的是 A。
   *
   * **语言不参与比对**：界面要英文而这一期只有中文（语言回退）仍然是同一版，照常显示。
   */
  const selected = Object.freeze({ date: pinnedDate ?? todayDate, periodId: pickedPeriodId, locale: pickedLocale ?? locale })
  const selectedPeriodIdOnScreen = readyDocument === undefined ? undefined : briefingEditionPeriod(readyDocument.edition).periodId
  const documentMatchesSelection = readyDocument !== undefined
    && readyDocument.edition.date === selected.date
    && (selected.periodId === undefined || selectedPeriodIdOnScreen === selected.periodId)
  const screenDocument = documentMatchesSelection ? readyDocument : undefined
  // 当前这一版的身份，交给删除的确认框点名。时刻取这一版自己的名义截止（读者时区），不是"现在"。
  const deleteTarget = screenDocument === undefined ? undefined : (() => {
    const period = briefingEditionPeriod(screenDocument.edition)
    return { date: screenDocument.edition.date, clock: railClock(period.periodTime, timeZone), language: screenDocument.edition.locale, periodId: period.periodId }
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
  // 进度按**选中那一版**的身份查（日期窗口 + 期号 + 语言），不是"本页最后一次发起的那一次"：
  // 后者会让"切到另一期"之后正文显示的仍是上一跑的步骤（用户报的"切过去还在跑别人的步骤"）。
  // 选中项没有期号时用默认期——服务按 `date:periodId:locale` 精确取，不再回退到同日同语言的另一跑。
  const progress = useDailyBriefingProgress({
    client, running: true, locale: effectiveLocale, timeZone,
    periodId: pickedPeriodId ?? DEFAULT_PERIOD_ID, intervalMs: 1_500
  })
  // One question, every source: what this page started, what it is loading for, and what the service
  // says is running right now (a scheduled run, or one started in another window).
  const generating = busyLocally || progress?.state === 'running'
  const liveProgress = progress?.state === 'running' ? progress.progress : undefined
  const { markLocalSettled } = useBriefingBackgroundRunReload(progress?.state === 'running', () => setReloadKey((key) => key + 1))
  // "Could not read the progress" is its own case: it must not fall back to "not generated", and it
  // must not pretend the run stopped either — the pipeline is still spending model calls.
  const progressUnreadable = generating && progress?.state === 'unavailable'
  // The stage a run is actually in, when it can be told. The rail shows `stage · elapsed` only for a
  // real stage: "生成中" and "进度未知" are the two fallback words, and pairing either of them with a
  // duration would turn a guess into a measurement.
  const runningStage = generating && !progressUnreadable && liveProgress ? runningRowName(liveProgress, text) : undefined
  const runningElapsedMs = runningStage === undefined || liveProgress === undefined ? undefined : runningElapsedMsFor(liveProgress)


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

  // 一次读取的全部分支（列表、今天、删完落到哪一行、读失败时旧正文留不留）都在这里；重读由
  // `reloadKey` 触发。页面上只看得见这一次调用，看不见 145 行分支。
  useBriefingReload({
    client, reloadKey, todayDate, pinnedDate, readEdition, takeSkipGenerate,
    setView, setEditions, setRailDates, setEditionsLoading, setEditionsFailed, setRegenerateFailure, setRegenerating, setShowingStale,
    setPickedLocale, setPickedPeriodId, setPinnedDate,
    afterDeleteLocaleRef, afterDeleteRef, effectiveLocaleRef, loadedLocaleRef, lastReadyRef, openEditionRef, periodDateRef, timeZoneRef, pickedPeriodIdRef
  })
  const { selectEdition, selectLocale } = briefingEditionSelection({
    editions, effectiveLocale: () => effectiveLocaleRef.current, openEdition, setPickedLocale, setPickedPeriodId
  })
  /** 选中的那一版是否正好是正在跑的那一期：只有它才把正文位让给进度。 */
  const runningIssues: readonly BriefingRunIntent[] = runIntent === null ? [] : [runIntent]
  const viewingRunningIssue = runningIssues.some((intent) =>
    pickedPeriodId === intent.periodId && effectiveLocale === intent.locale)
  /** 屏幕上这一版的身份：正文里写着的那一期，取不到才退回当前选中/默认期。 */
  const onScreenPeriodId = screenDocument?.edition.periodId ?? pickedPeriodId ?? DEFAULT_PERIOD_ID
  /**
   * 重跑屏幕上这一版时，截止与窗口取它**自己**的（用户 2026-11-06）。
   *
   * 少了这两样，服务端只能回落到期配置列表第一项（初始化那第 1 期的 07:00），于是"点重新生成，
   * 又变成 7 点"，还会在同一个截止上多插一版。没有正文可读时不给（那是"生成这一期"，不是重跑）。
   */
  /**
   * 「重新生成」作用在哪一天：有正文就是这一版那一天；**失败/缺版**的那一天没有正文，
   * 日期在视图里（`view.date`），不许因为它没正文就没得判断。
   */
  const regenerateDay = screenDocument?.edition.date
    ?? (view.status === 'no-edition' ? view.date : undefined)
  const screenWindowHours = screenDocument?.edition.windowHours
  const screenRerun = screenDocument === undefined ? undefined : {
    periodTime: screenDocument.edition.windowEnd,
    ...(isDailyBriefingWindowHours(screenWindowHours) ? { windowHours: screenWindowHours } : {})
  }
  const { runBriefing } = useBriefingRunActions({
    client, locale, zoneInvalid, timeZone,
    setView, setRegenerating, setRegenerateFailure, setEditions, todayDate,
    // 跑完停在**刚生成的那一版**：选中项按它的身份设全（`02` v2.129 G4）。
    onDocument: (document) => {
      setPinnedDate(document.edition.date)
      setPickedPeriodId(briefingEditionPeriod(document.edition).periodId)
      setPickedLocale(document.edition.locale)
    },
    // 发起即跳转 = 把选中项一次设全（日期 + 期号 + 语言）；正文是否跟着换由身份闸门决定。
    // 「我在读哪一版」只由读者的动作改。运行只交给 `running`：
    // 手动是**新建一期**，那一版本来没有正文，所以选中项跟着切过去（= 发起即跳转）；
    // 重跑当前版/历史版是**替换已有那一版**，选中项不动，旧正文继续可读。
    onRunIntent: (intent) => {
      setRunIntent(intent)
      if (intent === null || intent.kind !== 'manual') return
      setPinnedDate(intent.date === '' ? todayDate : intent.date)
      setPickedPeriodId(intent.periodId)
      setPickedLocale(intent.locale)
    },
    // 跑完不整页重读（`getToday` 会把刚跑出来的正文顶掉）：列表那一行由 runBriefing 合入新文档，
    // 这里只记一笔"本页这次已落定"，让背景重读的收尾那一次不再重复刷新（v2.167）。
    onSettled: markLocalSettled
  })
  const runManual = useBriefingManualRun({
    timeZone,
    // 手动那一版走**唯一入口**：意图是 `manual`，期号/语言/截止由这一份 draft 给出。
    regenerate: (input) => runBriefing({ ...input, trigger: 'manual', date: input.date }),
    running: generating,
    // A7.10 的查重键（用户 2026-11-06 定，统一口径、不分手动与排期）：**(日期, 截止时刻, 语言)**。
    // 窗口不进这个键——同一时刻同一语言只允许一版，窗口不同也算重复；再插一行就是两份说同一件事。
    // 期号也不进键：期号是那一版的属性，不是它的身份，以前按 (期号, 窗口) 比，于是同一刻插出两条。
    findDuplicate: ({ asOf, language }) => {
      const existing = editions.find((edition) =>
        (edition.periodTime ?? edition.windowEnd) === asOf && edition.locale === language)
      return existing === undefined ? undefined : { periodId: existing.periodId }
    }
  })
  // 说什么（重复时点名哪一版、点下去替换哪一版）与"能不能跑"分开：文案和替换动作在同一个模块里，
  // 页面只把结果交给工具栏。
  // 手动那次跑起来时的按钮文案：日期、时刻、语言都来自这一次的输入（见 `briefingManualRunOutcome`）。
  const manualRunningLabel = briefingManualRunningLabel({ intent: runIntent, text, formatTime })
  const onManualRun = (draft: Parameters<typeof runManual>[0]) =>
    briefingManualRunReport({
      result: runManual(draft),
      text,
      timeZone,
      // 撞期「替换」与第一次「生成」走**同一个入口**：意图是 manual，参数是当前 draft 的那三样。
      regenerate: (input) => runBriefing({ ...input, trigger: 'manual' })
    })

  // 事件名表跟着**这一版的语言**走（`02` `A0.9`）：界面中文 + 英文版次时，界面那张中文名表
  // 会把「核心 CPI」印进英文正文。版次语言与页面语言不同就换表，不回落（回落就是把中文塞进去）。
  const editionEventTitles = briefingEventTitles({
    pageLocale: locale,
    editionLocale: screenDocument?.edition.locale ?? effectiveLocale,
    pageTitles: eventTitles
  })

  const { exportState, copyState, exportImage, copy } = useBriefingShareActions({
    document: screenDocument,
    locale, text, eventTitles: editionEventTitles, shareRef
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
    document: contentBlocked ? undefined : screenDocument,
    generating,
    localeMissing: view.status === 'locale-missing',
    // 与正文同一口径：发的是**选中那一版**。按日期取首行会在一日多期时发错版（审计 #74 家族）。
    periodId: pickedPeriodId ?? screenDocument?.edition.periodId ?? DEFAULT_PERIOD_ID,
    text: briefingPushText[locale],
    // The channel is configured somewhere else (that drawer, or the platform's own settings). Re-read
    // when it may have changed, or the button keeps the verdict it formed at mount.
    refreshKey: settingsReloadKey
  })
  // A ready pane always knows its own date; an emptied one falls back to where the reader was,
  // so a delete never makes the rail jump to today.
  // 选中的是哪一版，由**选中项**决定（状态直取，见页面开头那道闸门）。
  // 文档到了、但本机读不懂它（版本/结构不符）：这是**校验失败**，不是"这次没读到"（`02` v2.129 G5）。
  // 它与失败面板、与"读不到"空态都不同：正文写原因，右列留一条带原因的缺口。
  const documentRejected = view.status === 'unavailable' && view.failureCode === DAILY_BRIEFING_DOCUMENT_INVALID
  // The right rail audits the edition that was actually generated: a missing source, a hidden
  // change and the conclusion's own gaps are separate facts, not one generic caveat list.
  const issues = screenDocument && !contentBlocked
    ? briefingIssues({
        document: screenDocument,
        text,
        formatTime,
        ...(eventTitles ? { eventTitles } : {}),
        webSearchEnabled
      })
    : documentRejected && !contentBlocked ? [briefingDocumentInvalidIssue(text)] : []
  const issueCounts = briefingIssueCounts(issues)
  const groups = groupBriefingIssues(issues, text)
  const activeGroup = openGroup ? groups.find((group) => group.key === openGroup.key) : undefined
  // A successful edition keeps its stage trace for auditing; a failed attempt carries the same
  // shape in the result, so the timeline survives a refresh once the service returns it.
  // 没有正文的那一版也能有步骤：失败的那一次尝试把 trace 交回来了。它**只**来自这一次读到的结果，
  // 不落回任何已存版次的 trace（同一天另一期的步骤不是这一版的步骤）。
  const failureTrace = view.status === 'no-edition' || view.status === 'unavailable' ? view.generationTrace : undefined
  const generationTrace = screenDocument
    ? readGenerationTrace((screenDocument.provenance as unknown as Readonly<{ generationTrace?: unknown }>).generationTrace)
    : failureTrace
  // The right-hand archive follows "this issue has an edition", not "the latest attempt succeeded":
  // regenerating today, or failing after an earlier success, must not make the stored archive vanish.
  // The archive belongs to the edition on screen, not to "today": reading a past edition must show
  // its trace and gaps even when today has never been generated.
  // The column is always there, and the language switch lives at its top: the two must not be
  // able to take each other away. Its audit blocks render only when the issue has an edition.
  const hasArchive = !contentBlocked && screenDocument !== undefined
  // The newest edition the list still holds is the last one that actually generated: an unreadable
  // state may quote it, so "unreadable" is not mistaken for "nothing was ever made".
  const { lastGeneratedAt, scheduledTime, todayMissing, hasTodayEdition } = briefingListFacts(editions, todayDate)
  // One answer for the whole page: the row says which issue state this is, the pane says what it
  // holds, and the mode combines them. Branches read this, not the pieces.
  // 选中那一行：按 (日期, 期号, 语言) 精确取，不用"今天首行"。
  const selectedRow = editions.find((edition) => edition.date === selected.date
    && (selected.periodId === undefined || edition.periodId === selected.periodId)
    && edition.locale === selected.locale)
  const viewStatus = screenDocument !== undefined
    ? briefingViewStatus(view)
    : (view.status === 'ready' ? 'no-edition' as const : briefingViewStatus(view))
  const mode = resolveBriefingMode({
    rowState: briefingRowState(selectedRow, effectiveLocale),
    viewStatus,
    hasEdition: selectedRow !== undefined && selectedRow.availableLocales.length > 0,
    localeAvailable: selectedRow ? selectedRow.availableLocales.includes(effectiveLocale) : true
  })
  const { openModelService, bodyClass, poster, editionText, editionLocale } = briefingPageChrome({
    onOpenModelSettings, readyDocument: screenDocument, editions, text, locale
  })

  return <main className="intelligence-page mi-daily-briefing-page" aria-label={text.title}>
    <DailyBriefingPageBar
      text={text}
      resolveText={resolveProductText}
      progress={liveProgress}
      loading={loading}
      generating={generating}
      regenerating={regenerating}
      todayReady={screenDocument !== undefined && readyKind(view) === 'today'}
      targetDate={todayDate}
      timeZone={timeZone}
      defaultDate={selected.date}
      latestDate={todayDate}
      zoneInvalid={zoneInvalid !== null}
      systemZone={screenDocument !== undefined && readyZone(view) === 'system'}
      onManualRun={onManualRun}
      {...(manualRunningLabel === undefined ? {} : { runningLabel: manualRunningLabel })}
      onOpenSettings={() => setSettingsSection('generation')}
      onBack={onBack}
    />
    <div className={bodyClass}>
      <DailyBriefingHistoryRail editions={editions} failed={editionsFailed} loading={editionsLoading} onRetry={() => setReloadKey((key) => key + 1)} selectedDate={selected.date}
        // 这一次在跑的身份：列表据此只让那一行转圈（日期 + 期号 + 语言，与行同一套三元组）。
        {...(runIntent === null ? {} : { runningIdentity: { date: runIntent.date === '' ? todayDate : runIntent.date, periodId: runIntent.periodId, locale: runIntent.locale } })} selectedPeriodId={pickedPeriodId} selectedLocale={effectiveLocale} todayDate={todayDate}
        // 一行 = 一期 = 一种语言：点行要把**这一行**的三样身份交出去；只传日期的话，同一天两期
        // 永远落到第一行，读者看到的是"切换了但内容不切"。
        onSelectLocale={selectLocale}
        {...(railDates === undefined ? {} : { dates: railDates })}
        generatingStage={generating ? (progressUnreadable ? text.generationProgress.unknownStage : (runningStage ?? text.generationProgress.railRunning)) : undefined}
        generatingElapsedMs={runningElapsedMs}
        locale={locale} text={text} timeZone={timeZone} resolveText={resolveProductText} onSelect={selectEdition}
        // 行右键与工具栏第五颗共用同一个处理函数：两个入口，一套行为。
        onDeletePeriod={(target) => deleteEdition({ ...target, language: target.locale, entry: 'row-menu', ...(target.clock === undefined ? {} : { clock: target.clock }) })} />
      <DailyBriefingContent {...{
        // 版次级五颗：吸在正文滚动区顶部，只作用于当前这一版（重新生成 / 发布 / 导出 / 复制 / 删除）。
        editionBar: <DailyBriefingEditionActions
          text={text}
          resolveText={resolveProductText}
          exportable={screenDocument !== undefined && !contentBlocked}
          exportState={exportState}
          copyState={copyState}
          generating={generating}
          {...(manualRunningLabel === undefined ? {} : { runningLabel: manualRunningLabel })}
          {...(deleteTarget === undefined ? {} : { deleteTarget })}
          deleting={deleting}
          onDelete={() => { if (deleteTarget !== undefined) deleteEdition({ ...deleteTarget, entry: 'toolbar' }) }}
          onExport={() => void exportImage()}
          onCopy={() => void copy()}
          // 重跑的是**屏幕上这一版**：期号与语言取自它，不是服务端的默认期。
          // 以前这里不带期号，历史日点「重新生成」写的是今天那版（审计 #10/#23）。
          // 重跑这一期只有这一个入口（用户 2026-11-07）：与"有没有正文"无关，只看是否在可生成窗口内。
          // 超窗时禁用并给可见理由——那是唯一需要拦的情况，跑进行中由 `generating` 自己表达。
          {...(regenerateDay === undefined || isManualGenerationDateAllowed(regenerateDay, todayDate)
            ? {}
            : { regenerateBlockedReason: text.history.generationWindowOnly })}
          onRegenerate={() => void runBriefing({ periodId: onScreenPeriodId, locale: screenDocument?.edition.locale ?? effectiveLocale, trigger: 'regenerate', ...(screenRerun === undefined ? {} : { rerun: screenRerun }) })}
          push={pushToPhone}
          pushText={briefingPushText[locale]}
        />,
        text, view, mode, failure, regenerating, liveProgress, progressUnreadable, resolveProductText,
        editions, lastGeneratedAt, timeZone, todayDate, scheduledTime, editionText, editionLocale,
        eventTitles: editionEventTitles, formatTime, contentBlocked, documentRejected, deleteOutcome, languageFallback, webSearchEnabled,
        settingsOpen: settingsSection !== null,
        // 正文失败面板的「重新生成」：跑的是屏幕上这一版，所以期号与语言取自它，不是全局默认期。
        onRetry: () => void runBriefing({ periodId: onScreenPeriodId, locale: screenDocument?.edition.locale ?? effectiveLocale, trigger: 'regenerate', ...(screenRerun === undefined ? {} : { rerun: screenRerun }) }),
        // 读不到时的「重试」只重读：把读取重跑一遍，不起 run、不写版、不调模型。
        onReread: () => setReloadKey((key) => key + 1),
        // 手动那一期在写的时候，右边切到"这一期正在生成"，不继续挂着旧正文：旧正文 + 一句
        // 「正在重新生成」=读者认定在重跑当前版。重跑当前版仍保留旧正文可读。
        onOpenSettings: () => setSettingsSection('ai'), onConfigureSources,
        onDeleteRetry: retryDelete
      }} />
      <DailyBriefingAppendix {...{
        text, view, contentBlocked, hasArchive, issues, issueCounts, groups, generationTrace, formatTime,
        editionLocale, issuesOpen, setIssuesOpen, openGroup,
        setOpenGroup, listAttempts: client.listAttempts, generating, liveProgress,
        // 右列「读不到」那一条的重试：只重新读取这一版，不触发生成（`02` v2.124）。
        onRetryRead: () => setReloadKey((key) => key + 1)
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
    {screenDocument && !contentBlocked ? <div className="mi-daily-briefing-share-host" aria-hidden="true">
      {/* The exported node only: rows that are just a fallback reading stay on the page above. */}
      <div ref={shareRef}><DailyBriefingShareCard document={screenDocument} text={poster.text} locale={poster.locale} readOnly={readyKind(view) === 'history'} paymentDirectionsCompact={briefingPaymentDirections(poster.locale)} policyWords={briefingPolicyGaugeWords(poster.locale)} changeArrows={briefingChangeArrows(poster.locale)} fearGreedBuckets={briefingFearGreedBuckets(poster.locale)} {...(poster.completenessNote ? { completenessNote: poster.completenessNote } : {})} {...(eventTitles ? { eventTitles } : {})} formatTime={formatTime} timeZone={timeZone} /></div>
    </div> : null}
  </main>
}