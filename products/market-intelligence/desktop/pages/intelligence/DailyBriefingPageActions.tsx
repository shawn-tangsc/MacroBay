import { Button } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'

import { useConfirm } from '@platform/ui/components/confirm'
import { useToast } from '@platform/ui/components/toast'
import { LoadingSpinner } from '@platform/ui/components/loading'

import type { BriefingGenerationProgress } from '../../../contracts/dailyBriefing'
import { BriefingManualRunDialog, type BriefingManualRunDraft, type BriefingManualRunProblem } from './BriefingManualRunDialog'
import type { BriefingManualRunOutcome } from './useBriefingManualRun'
import { BriefingPushToPhoneButton } from './BriefingPushToPhoneButton'
import { openBriefingSessionWithShell } from './openBriefingSession'
import type { BriefingPushText } from './dailyBriefingPushText'
import type { BriefingPushToPhone } from './useBriefingPushToPhone'
import { DailyBriefingGeneratingStatus } from './DailyBriefingGeneratingStates'
import type { DailyBriefingText } from './dailyBriefingText'
import type { BriefingCopyState, BriefingExportState } from './useBriefingShareActions'
import { briefingEditionDeleteCopy, type BriefingEditionDeleteTarget } from './briefingEditionDeleteConfirm'

/**
 * 两排按钮，两组语义（用户 2026-11-05 定，`02` v2.44 之前的三分区）：
 *
 * - **页面级**（`DailyBriefingPageActions`，留在页面顶部）：今天出不出。手动生成、日报设置。
 * - **版次级**（`DailyBriefingEditionActions`，正文区顶部、吸在正文滚动容器上）：这一版怎么处置。
 *   重新生成、发布频道、导出图片、复制日报、删除这一版。
 *
 * 分开放的后果不是"按钮多了"——读者会把"重新生成今天"当成"重新生成这一版"来点。两组各有自己的
 * 禁用条件，也各有自己的理由，混在一行就说不清是哪一组的。
 */
export function DailyBriefingPageActions({ text, resolveText, progress, loading, generating, regenerating, runningLabel, targetDate, timeZone, defaultDate, latestDate, todayReady, systemZone, onManualRun, onOpenSettings }: Readonly<{
  text: DailyBriefingText
  resolveText: (key: string) => string
  progress: BriefingGenerationProgress | undefined
  loading: boolean
  generating: boolean
  regenerating: boolean
  /** 手动那一期在写时的按钮文案（含时刻与语言）；缺省时沿用「正在重新生成…」。 */
  runningLabel?: string
  /** The issue day the action writes: its accessible name says it, so the target is never guessed. */
  targetDate: string
  /** 读者时区：弹框里的日期与时刻按它落成绝对时刻，确认区也按它写时区名。 */
  timeZone: string
  /** 弹框的默认日期：读者当前在的那一天（首次进入即日历今天，`02` v2.131）。 */
  defaultDate: string
  /** 弹框可选的最晚日期：日历今天，未来不许选（`02` v2.129 G1）。 */
  latestDate: string
  todayReady: boolean
  systemZone: boolean
  /** 手动生成一次：三个字段由弹框收集，这里只把结果交出去。 */
  /** 一次按下的结果；撞上已有那一版时带一句话和"替换"这个动作，由弹框就地发问。 */
  onManualRun: (draft: BriefingManualRunDraft) => Readonly<{
    outcome: BriefingManualRunOutcome
    duplicate?: Readonly<{ label: string; replace: () => void }>
  }>
  onOpenSettings: () => void
}>): React.ReactElement {
  // 弹框的开关住在这里：那颗按钮只开它，三个字段与提交都在弹框里。
  const [manualOpen, setManualOpen] = useState(false)
  // 被拒的那次不关弹框：读者要能看见为什么没跑，并就地改那个时刻或窗口。
  const [manualProblem, setManualProblem] = useState<BriefingManualRunProblem | undefined>(undefined)
  // 撞上已有那一版：在同一个弹框里问替换，不叠第二层。
  const [manualDuplicate, setManualDuplicate] = useState<Readonly<{ label: string; replace: () => void }> | undefined>(undefined)
  return <div className="mi-daily-briefing-page__actions" data-action-group="page">
    {loading ? <DailyBriefingGeneratingStatus progress={progress} resolveText={resolveText} text={text} /> : null}
    {/* The one rule: only a run in flight disables this. Every other state — empty, failed, ready,
        showing a past day, no detail column — keeps it clickable, and its name always says whose
        day it acts on. A disabled control with no reason the reader can see is not allowed. */}
    {/* 期模型之后，这颗按钮只说一件事：现在就按某一期跑一次。旧的「生成或重新生成今天的日报」是
        "整天一条"时代的说法——那时一天只有一份，现在一天可以有多期，重生成要指定是哪一期。 */}
    <Button className="mi-briefing-tool__btn mi-briefing-tool__btn--primary" data-toolbar-action="regenerate" disabled={generating}
      /* A run in flight is a wait, so the control shows it is working instead of looking broken. */
      loading={generating}
      {...(generating
        ? { 'aria-label': runningLabel ?? text.generationProgress.workingHint, title: runningLabel ?? text.generationProgress.workingHint }
        : { 'aria-label': text.manualGenerateTarget.replace('{date}', targetDate) })}
      onClick={() => { setManualProblem(undefined); setManualOpen(true) }}>
      {/* 手动那一期在写时说"哪一期、哪种语言"；「重新生成」这个词只留给重跑当前版。 */}
      {regenerating ? (runningLabel ?? text.regenerating) : text.manualGenerate}
    </Button>
    <BriefingManualRunDialog
      open={manualOpen}
      text={text}
      timeZone={timeZone}
      defaultDate={defaultDate}
      latestDate={latestDate}
      running={generating}
      onRun={(draft) => {
        const result = onManualRun(draft)
        if (result.outcome === 'duplicate') {
          setManualProblem(undefined)
          setManualDuplicate(result.duplicate)
          return
        }
        setManualProblem(result.outcome === 'started' ? undefined : result.outcome)
        if (result.outcome === 'started') setManualOpen(false)
      }}
      onReplace={() => { manualDuplicate?.replace(); setManualOpen(false); setManualDuplicate(undefined) }}
      /* 撞上已有那一版时，弹框要就地改成"替换"这一问。状态立在这里、却忘了传下去，于是
         "问要不要替换"这一步从来没真的出现过：读者按了生成，什么也没发生（2026-11-06 查出的死路径）。 */
      {...(manualDuplicate === undefined ? {} : { duplicate: manualDuplicate })}
      {...(manualProblem === undefined ? {} : { problem: manualProblem })}
      onClose={() => { setManualOpen(false); setManualProblem(undefined); setManualDuplicate(undefined) }}
    />
    {todayReady ? <>
      {/* The settings zone was unusable, so the window was computed in the machine's zone. The
          reader configured a time and is getting another day boundary; saying nothing would let
          them read the edition against the wrong one. */}
      {systemZone ? <small className="mi-daily-briefing__clock-note" role="status">{text.timeZoneFromSystem}</small> : null}
    </> : null}
    {/* One entry for every brief setting. The icon-only AI-settings trigger that used to sit
        beside it opened a second dialog for half of the same form. */}
    <Button className="mi-briefing-tool__btn mi-daily-briefing__settings-entry" data-toolbar-action="settings" data-briefing-settings-open="true" onClick={onOpenSettings}>
      <Settings2 aria-hidden="true" size={14} />{text.settingsDrawer.open}
    </Button>
  </div>
}

export function DailyBriefingEditionActions({ text, resolveText, exportable, exportState, copyState, deleteTarget, deleting, generating, runningLabel, regenerateBlockedReason, onExport, onCopy, onDelete, onRegenerate, push, pushText, openSession }: Readonly<{
  text: DailyBriefingText
  resolveText: (key: string) => string
  /** 有可读版次：五颗一起亮；没有就一起禁用，原因写在整组下面一句。 */
  exportable: boolean
  exportState: BriefingExportState
  copyState: BriefingCopyState
  /** 当前这一版的身份，交给确认框点名：日期 · 时刻 · 语言。 */
  deleteTarget?: BriefingEditionDeleteTarget
  deleting?: boolean
  generating: boolean
  /** 手动那一期在写时的按钮文案（含日期、时刻与语言）；缺省沿用「正在重新生成…」。 */
  runningLabel?: string
  onExport: () => void
  onCopy: () => void
  /** 这一版的删除：与行右键共用 `briefingEditionDeleteCopy` 那一句话与同一个确认框。 */
  onDelete?: (target: BriefingEditionDeleteTarget) => void
  /** 重跑当前这一版（期号 + 语言来自它自己），不是"重跑今天"。 */
  onRegenerate: () => void | Promise<void>
  /** 这一天为什么不能重新生成（超出最近 3 天）。跑进行中时用 `runningLabel`，不走这里。 */
  regenerateBlockedReason?: string
  push: BriefingPushToPhone
  pushText: BriefingPushText
  /**
   * 当前显示那一版的会话（E9）。按 `(date, periodId, locale)` 精确命中才给——没有就不传，
   * 顶上那颗**整颗不渲染**（不画禁用占位：那等于承诺"本来该有"）。
   */
  openSession?: Readonly<{ sessionId: string; label: string }>
}>): React.ReactElement {
  const confirm = useConfirm()
  // 「这次没打开」只对当前这一版说一句；再点是**真的再读一次**（与行尾当时同一条规矩）。
  const [sessionNotOpened, setSessionNotOpened] = useState(false)
  // 发布回执与失败都走平台 toast（用户 2026-11-05：那行字丑、还常驻，别挂在工具栏里）。
  // 每发生一次只提示一次：状态对象本身是"这一次"的身份，重渲染不重发。
  const toast = useToast()
  const toasted = useRef<typeof push.state | undefined>(undefined)
  useEffect(() => {
    const state = push.state
    if (state.kind !== 'sent' && state.kind !== 'failed') return
    if (toasted.current === state) return
    toasted.current = state
    if (state.kind === 'sent') {
      const sentence = push.sentence ?? pushText.sentAccepted
      toast.success({ titleKey: 'briefing.push.sent', resolveText: () => sentence })
      return
    }
    const failure = `${pushText.failedTitle}：${pushText.failed[state.reason]}`
    toast.danger({
      titleKey: 'briefing.push.failed',
      // 同一个解析器也解动作标签，所以按 key 分流：否则动作按钮上会印一遍整句失败话。
      resolveText: (key) => (key === 'briefing.push.retry' ? pushText.retry : failure),
      action: { labelKey: 'briefing.push.retry', onSelect: push.onRetry }
    })
  })
  // 没有可读版次时五颗一起禁用。**原因不在这条栏里另写一句**：正文的空态已经说明这一版为什么
  // 没有内容，栏上再写一遍就是同一件事两个出处，还会把吸顶栏撑高。
  const blocked = !exportable
  // 「重新生成」与"有没有正文"**无关**：失败行正是它该用的时候（用户 2026-11-07）。
  // 它只看两件事：这一期正在跑、或者这一天超出可生成窗口——后者要给看得见的理由。
  const regenerateDisabledReason = generating ? (runningLabel ?? text.regenerating) : regenerateBlockedReason
  const deleteButton = <Button danger className="mi-briefing-tool__btn mi-briefing-tool__btn--danger" data-toolbar-action="delete-edition"
    disabled={blocked || deleteTarget === undefined || onDelete === undefined || deleting === true}
    icon={deleting === true ? <LoadingSpinner size="sm" /> : undefined}
    onClick={() => {
      if (deleteTarget === undefined || onDelete === undefined) return
      const copy = briefingEditionDeleteCopy(text, deleteTarget)
      confirm({
        title: copy.title,
        description: copy.description,
        confirmLabel: copy.confirmLabel,
        cancelLabel: copy.cancelLabel,
        tone: 'danger',
        onConfirm: () => onDelete(deleteTarget)
      })
    }}>
    {text.history.deleteEditionConfirm}
  </Button>
  // 工具栏**不参与滚动**：它是卡的第一行，滚动的是卡里只包纸的那一层。既然它不动，就不需要
  // `sticky`、不需要判定"是否吸住"，也不需要滚动时换一套外观——静止与滚动时它看起来一样。
  return <div className="mi-daily-briefing-page__report-bar" data-action-group="edition">
      {/* 「打开会话」在「重新生成」左边：读者刚看完这一版，下一件事是回它的编辑会话。
          与其余动作同一个 `Button` + 同一个类，不另造样式；没有会话时整颗不出现。 */}
      {openSession === undefined ? null : <Button className="mi-briefing-tool__btn" data-toolbar-action="open-session"
        aria-label={openSession.label}
        onClick={() => {
          setSessionNotOpened(false)
          void openBriefingSessionWithShell(openSession.sessionId)
            .then((opened) => { if (!opened) setSessionNotOpened(true) })
            .catch(() => setSessionNotOpened(true))
        }}>
        {text.history.openSession}
      </Button>}
      {sessionNotOpened ? <span className="mi-daily-briefing__session-not-opened" data-session-not-opened="true" role="status">
        {text.history.sessionNotOpened}
      </span> : null}
      {/* 第一颗是"这一版重跑一次"：它作用于当前打开的期号 + 语言，与页面顶部那颗"今天出不出"不是
          同一件事——两颗都在页面上，但管的是不同的东西。 */}
      <Button className="mi-briefing-tool__btn" data-toolbar-action="regenerate-edition"
        disabled={generating || regenerateBlockedReason !== undefined}
        loading={generating}
        {...(regenerateDisabledReason === undefined ? {} : { 'aria-label': regenerateDisabledReason, title: regenerateDisabledReason })}
        onClick={() => { void onRegenerate() }}>
        {/* 手动那一路不许退回「正在重新生成…」：写的是新的一期，不是读者眼前这一版（G4）。 */}
        {generating ? (runningLabel ?? text.regenerating) : text.regenerate}
      </Button>
      {/* 发布频道与这一组同源：读者刚生成完，下一件事就是发出去。状态在状态机里，这里只摆位置。 */}
      <span className="mi-daily-briefing__push-slot">
        <BriefingPushToPhoneButton state={push.state} text={pushText} onPush={push.onPush} />
      </span>
      <Button className="mi-briefing-tool__btn" data-toolbar-action="export" disabled={blocked || exportState === 'exporting'} onClick={onExport} aria-live="polite">
        {exportState === 'exporting' ? text.exportingImage : exportState === 'done' ? text.exported : exportState === 'failed' ? text.exportFailed : text.exportImage}
      </Button>
      <Button className="mi-briefing-tool__btn" data-toolbar-action="copy" disabled={blocked} onClick={onCopy} aria-live="polite">
        {copyState === 'copied' ? text.copied : copyState === 'failed' ? text.copyFailed : text.copy}
      </Button>
      {/* 第五颗：**删除这一版**。危险色、不填充，排在最后；没有可读版次时与整组一起禁用——
          动作行不解释自己（界面规范 §5.1），原因由正文的空态说明。 */}
      {deleteButton}
  </div>
}
