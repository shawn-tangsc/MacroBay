import { Button } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'

import { useConfirm } from '@platform/ui/components/confirm'
import { DisabledHint } from '@platform/ui/components/disabled-hint'
import { LoadingSpinner } from '@platform/ui/components/loading'

import type { BriefingGenerationProgress } from '../../../contracts/dailyBriefing'
import { BriefingManualRunDialog, type BriefingManualRunDraft } from './BriefingManualRunDialog'
import { BriefingPushToPhoneButton } from './BriefingPushToPhoneButton'
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
export function DailyBriefingPageActions({ text, resolveText, progress, loading, generating, regenerating, targetDate, todayReady, zoneInvalid, systemZone, onManualRun, onOpenSettings }: Readonly<{
  text: DailyBriefingText
  resolveText: (key: string) => string
  progress: BriefingGenerationProgress | undefined
  loading: boolean
  generating: boolean
  regenerating: boolean
  /** The issue day the action writes: its accessible name says it, so the target is never guessed. */
  targetDate: string
  todayReady: boolean
  zoneInvalid: boolean
  systemZone: boolean
  /** 手动生成一次：三个字段由弹框收集，这里只把结果交出去。 */
  onManualRun: (draft: BriefingManualRunDraft) => void
  onOpenSettings: () => void
}>): React.ReactElement {
  // 弹框的开关住在这里：那颗按钮只开它，三个字段与提交都在弹框里。
  const [manualOpen, setManualOpen] = useState(false)
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
        ? { 'aria-label': text.generationProgress.workingHint, title: text.generationProgress.workingHint }
        : { 'aria-label': text.manualGenerateTarget.replace('{date}', targetDate) })}
      onClick={() => setManualOpen(true)}>
      {regenerating ? text.regenerating : text.manualGenerate}
    </Button>
    <BriefingManualRunDialog
      open={manualOpen}
      text={text}
      running={generating}
      onRun={(draft) => { setManualOpen(false); onManualRun(draft) }}
      onClose={() => setManualOpen(false)}
    />
    {todayReady ? <>
      {zoneInvalid ? <small className="mi-daily-briefing__clock-note" role="status">{text.generationSettings.manualUtcNote}</small> : null}
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

export function DailyBriefingEditionActions({ text, resolveText, exportable, exportState, copyState, deleteTarget, deleting, generating, onExport, onCopy, onDelete, onRegenerate, push, pushText }: Readonly<{
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
  onExport: () => void
  onCopy: () => void
  /** 这一版的删除：与行右键共用 `briefingEditionDeleteCopy` 那一句话与同一个确认框。 */
  onDelete?: (target: BriefingEditionDeleteTarget) => void
  /** 重跑当前这一版（期号 + 语言来自它自己），不是"重跑今天"。 */
  onRegenerate: () => void | Promise<void>
  push: BriefingPushToPhone
  pushText: BriefingPushText
}>): React.ReactElement {
  const confirm = useConfirm()
  // 静止时这条栏零绘制（它就是正文的一部分）；只有滚到它上面去了才浮起来——否则透明的按钮条
  // 会让正文从底下穿过去。判定用哨兵 + IntersectionObserver，不在 `scroll` 里算 offset。
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || typeof IntersectionObserver === 'undefined') return undefined
    const scroller = sentinel.closest('.mi-daily-briefing-page__content')
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry) setStuck(!entry.isIntersecting)
    }, scroller === null ? {} : { root: scroller })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])
  // 没有可读版次时五颗一起禁用。**原因不在这条栏里另写一句**：正文的空态已经说明这一版为什么
  // 没有内容，栏上再写一遍就是同一件事两个出处，还会把吸顶栏撑高。
  const blocked = !exportable
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
  return <>
    {/* 哨兵：紧贴在栏上方、零高度。它离开滚动区顶部，就是栏已经吸住了。 */}
    <div ref={sentinelRef} className="mi-daily-briefing-page__report-sentinel" aria-hidden="true" />
    <div className="mi-daily-briefing-page__report-bar" data-action-group="edition" data-stuck={stuck ? 'true' : undefined}>
      {/* 第一颗是"这一版重跑一次"：它作用于当前打开的期号 + 语言，与页面顶部那颗"今天出不出"不是
          同一件事——两颗都在页面上，但管的是不同的东西。 */}
      <Button className="mi-briefing-tool__btn" data-toolbar-action="regenerate-edition" disabled={blocked || generating}
        loading={generating}
        onClick={() => { void onRegenerate() }}>
        {generating ? text.regenerating : text.regenerate}
      </Button>
      {/* 发布频道与这一组同源：读者刚生成完，下一件事就是发出去。状态在状态机里，这里只摆位置。 */}
      <span className="mi-daily-briefing__push-slot">
        <BriefingPushToPhoneButton state={push.state} text={pushText} onPush={push.onPush} onRetry={push.onRetry} />
        {/* The success sentence is the only thing that appears and leaves on its own. It states what we
            know — handed to the channel — and its timer is its whole lifetime. */}
        {push.sentence === undefined ? null : <span className="mi-daily-briefing__push-toast" role="status">{push.sentence}</span>}
      </span>
      <Button className="mi-briefing-tool__btn" data-toolbar-action="export" disabled={blocked || exportState === 'exporting'} onClick={onExport} aria-live="polite">
        {exportState === 'exporting' ? text.exportingImage : exportState === 'done' ? text.exported : exportState === 'failed' ? text.exportFailed : text.exportImage}
      </Button>
      <Button className="mi-briefing-tool__btn" data-toolbar-action="copy" disabled={blocked} onClick={onCopy} aria-live="polite">
        {copyState === 'copied' ? text.copied : copyState === 'failed' ? text.copyFailed : text.copy}
      </Button>
      {/* 第五颗：**删除这一版**。危险色、不填充，排在最后；没有可读版次时与整组一起禁用，
          原因写在整组下面一句（组件级的 `DisabledHint` 会把它同时挂进 `aria-describedby`）。 */}
      {deleteButton}
    </div>
  </>
}
