import { Button } from 'antd'
import { useEffect, useRef, useState } from 'react'

import { StateView } from '@platform/ui/components/state'

import type { BriefingGenerationProgress } from '../../../contracts/dailyBriefing'
import type { DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import type { BriefingDeleteOutcome } from './useDailyBriefingIssueDeletion'
import type { DailyBriefingMode } from './dailyBriefingMode'
import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'
import type { DailyBriefingText } from './dailyBriefingText'
import { DailyBriefingDeleteOutcomeNote } from './DailyBriefingDeleteOutcomeNote'
import { DailyBriefingEmptyState } from './DailyBriefingEmptyState'
import { DailyBriefingFailurePanel, type BriefFailure } from './DailyBriefingFailurePanel'
import { DailyBriefingGeneratingView } from './DailyBriefingGeneratingStates'
import { BriefingReplacingNotice } from './BriefingReplacingNotice'
import { DailyBriefingLanguageFallback } from './DailyBriefingLanguageFallback'
import { DailyBriefingNoEditionPanel } from './DailyBriefingNoEditionPanel'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'
import { briefingChangeArrows, briefingFearGreedBuckets, briefingPaymentDirections, briefingPolicyGaugeWords } from './dailyBriefingPaymentDirections'
import { DailyBriefingStorageNotice } from './DailyBriefingStorageNotice'
import { BRIEFING_PAPER_WIDTH } from './dailyBriefingExport'
import { briefFailureCodeLabel } from './dailyBriefingFailureDetail'
import { editorialFailureText } from './dailyBriefingPageDerived'
import { resolveBriefingStateReason } from './dailyBriefingText'

/**
 * The sheet on screen is the sheet that is exported, scaled — never re-flowed.
 *
 * The poster is a printed page with absolute sizes (card row 114, dial 88, plot column 100, the number
 * 30px). Stretching it to the column width re-lays it out and the cards collapse; scaling it keeps one
 * layout and changes only how large it is drawn. `shareRef` in the page still points at the poster in
 * its own 1080 box, so the export is untouched by this transform.
 */
/**
 * Everything the reading pane can show, in one place.
 *
 * Kept out of the page for size, and because the pane's states belong together: a run in flight,
 * nothing generated, a missing language, a failure, an edition. The page decides which state it is
 * in; this file decides how each one looks.
 */
export function DailyBriefingContent({ text, view, mode, failure, regenerating, liveProgress, progressUnreadable, resolveProductText, editions, lastGeneratedAt, timeZone, todayDate, scheduledTime, editionText, editionLocale, eventTitles, formatTime, contentBlocked, documentRejected, deleteOutcome, languageFallback, webSearchEnabled, settingsOpen, editionBar, onReread, onRetry, onOpenSettings, onConfigureSources, onDeleteRetry }: Readonly<{
  text: DailyBriefingText
  view: DailyBriefingPageViewState
  /** The page's one answer; the generating pane reads it, and it must include service-side runs. */
  mode: DailyBriefingMode
  failure: BriefFailure | null
  regenerating: boolean
  liveProgress: BriefingGenerationProgress | undefined
  progressUnreadable: boolean
  resolveProductText: (key: string) => string
  editions: readonly DailyBriefingEditionSummary[]
  lastGeneratedAt?: string
  timeZone: string
  todayDate: string
  scheduledTime?: string
  editionText: DailyBriefingText
  editionLocale: 'zh-CN' | 'en-US'
  eventTitles?: Record<string, string>
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  contentBlocked: boolean
  /** 文档到了、但本机读不懂它：正文只写原因，不写"读不到"（`02` v2.129 G5）。 */
  documentRejected?: boolean
  deleteOutcome: BriefingDeleteOutcome | null
  languageFallback: string | null
  webSearchEnabled: boolean | null
  settingsOpen: boolean
  /** 版次级工具栏：吸在正文滚动区顶部，只作用于当前这一版（三分区的中段）。 */
  editionBar?: React.ReactNode
  /** 重新读一次这一版（不是重新生成）：读不到时那颗「重试」走这里。 */
  onReread: () => void
  onRetry: () => void
  onOpenSettings: () => void
  onConfigureSources: () => void
  onDeleteRetry: (target: BriefingDeleteOutcome['target']) => void
}>): React.ReactElement {
  const paperHostRef = useRef<HTMLDivElement>(null)
  const paperSheetRef = useRef<HTMLDivElement>(null)
  const [paperScale, setPaperScale] = useState(1)
  const [paperHostHeight, setPaperHostHeight] = useState<number | undefined>(undefined)
  const [paperOffsetX, setPaperOffsetX] = useState(0)
  useEffect(() => {
    const host = paperHostRef.current
    const sheet = paperSheetRef.current
    if (!host || !sheet || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const width = host.clientWidth
      // Never enlarge: the sheet's own size is the design's, and upscaling only makes the text soft.
      const scale = width > 0 ? Math.min(1, width / BRIEFING_PAPER_WIDTH) : 1
      setPaperScale(scale)
      setPaperHostHeight(sheet.offsetHeight > 0 ? sheet.offsetHeight * scale : undefined)
      setPaperOffsetX(Math.max(0, (width - BRIEFING_PAPER_WIDTH) / 2))
    }
    // The container's width decides the scale; the sheet's own height decides the room. Neither
    // observer watches the wrapper itself — a scaled element reports its scaled size, and observing it
    // would feed its own output back into the measurement.
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    observer.observe(sheet)
    measure()
    return () => observer.disconnect()
  }, [view])
  // What the body is showing: one edition the reader can read, in this or an earlier version.
  // 纸只在"这一版确实有正文"时出现：`mode` 已经按选中身份推过，它是唯一判据；
  // 只看 `view.status` 会让旧文档冒充选中版（用户报的"切过去还是旧正文"）。
  const showingEdition = view.status === 'ready' && !contentBlocked && mode !== 'generating'
  /**
   * 正文这一刻报的是**哪一件事**——一个值，不是四个各自成立的判断。
   *
   * 以前这四块是四个独立的 `&&`：`no-edition + failed` 会同时画出"这一期没有简报"和"日报生成失败"，
   * 同一次失败在正文里说了两遍（用户报的"一屏两个状态"）。现在按固定优先级取一个：
   * 有正文就报正文；没有正文时先报"正在跑"（此刻发生的事），再报"这次失败"（要读者动手的事），
   * 再报"读不到"，最后才是"没有这一期"。
   */
  const bodyState: 'paper' | 'generating' | 'failure' | 'unavailable' | 'no-edition'
    = showingEdition ? 'paper'
      : mode === 'generating' ? 'generating'
        : failure ? 'failure'
          : view.status === 'unavailable' ? 'unavailable'
            : 'no-edition'
  // 两个"没有正文"的档（整期没有 / 缺这一种语言）落**同一个面板**：读者不需要分辨两者，
  // 面板也不该有两种身份。缺语言那一档只把 `view` 折成面板认的形状。
  const noEditionView = view.status === 'no-edition'
    ? view
    : view.status === 'locale-missing'
      ? { status: 'no-edition' as const, date: view.date ?? todayDate, failed: false }
      : undefined
  // 唯一有意叠加的一档：正文留着、失败提示挂在它下面（重跑失败不吞掉读者正在读的那一版）。
  const failureUnderPaper = bodyState === 'paper' && failure !== null
  return <section className="mi-daily-briefing-page__content" data-body-state={bodyState}>
    {/* 外层卡：工具栏属于这张卡，纸属于它自己。按钮进不了纸的圆角边框，导出图里就不会带
        「删除这一版」这类界面动作——看的边界与导出的边界是两条线。 */}
    <div className="mi-daily-briefing-page__report-card">
      {/* 工具栏固定在卡顶，不进滚动区——所以它不会被滚动条压住，也不会跟着纸一起走。 */}
      {editionBar}
      {/* 卡内唯一的滚动层：只包纸（没有纸时包空态/生成中/失败）。滚动条只出现在这一层右侧。 */}
      <div className="mi-daily-briefing-page__report-scroll">
      {deleteOutcome ? <DailyBriefingDeleteOutcomeNote outcome={deleteOutcome} text={text} onRetry={(outcome) => onDeleteRetry(outcome.target)} /> : null}
      <DailyBriefingLanguageFallback requested={languageFallback} text={text} />
      <DailyBriefingStorageNotice text={text.migration} />
      {webSearchEnabled === false && !settingsOpen ? <div className="mi-daily-briefing-page__websearch-warning" role="alert">
        <div><strong>{text.aiSettings.webSearchOff}</strong><small>{text.aiSettings.webSearchOffHint}</small></div>
        <Button data-open-settings-section="ai" onClick={onOpenSettings}>{text.aiSettings.goEnable}</Button>
      </div> : null}
      {/* With nothing to read, the body is where the run reports itself. When this issue already has
          an edition, that edition stays readable and the run reports in the right column instead. */}
      {bodyState === 'generating'
        ? <DailyBriefingGeneratingView formatTime={formatTime} progress={liveProgress} progressUnreadable={progressUnreadable} resolveText={resolveProductText} text={text} />
        : null}
      {bodyState === 'unavailable'
        // 空态零按钮（还没有内容）；只有"读不到"那一档给一颗「重试」，它重新**读**，不重新生成。
        // 文档读不懂这一档也走这里，但**写原因**（版本/结构不符），不写成"读不到"。
        ? <DailyBriefingEmptyState editions={editions} formatTime={formatTime} lastGeneratedAt={lastGeneratedAt} onRetry={onReread} text={text} timeZone={timeZone} todayDate={todayDate} documentRejected={documentRejected === true} />
        : null}
      {/* Shown during a run too: the reader asked to read this language, and "this issue has no such
          version" is the answer to that, not a reason to replace the pane with the run's own screen. */}
      {/* 缺当前语言也走同一个空态（`02` v2.94）：读者不需要分辨"整期没有"和"缺这个语言"。 */}
      {/* 两个"没有正文"的档（整期没有 / 缺这一种语言）落**同一个面板**：读者不需要分辨两者，
          面板也不该有两种身份。缺语言那一档只把 `view` 折成面板认的形状。 */}
      {bodyState === 'no-edition' && noEditionView !== undefined ? <DailyBriefingNoEditionPanel
        view={noEditionView}
        text={text} timeZone={timeZone} scheduledTime={scheduledTime} todayDate={todayDate} formatTime={formatTime} onOpenSettings={onOpenSettings} /> : null}
      {/* 失败面板只有这一个出口。面板里**不再放「重新生成」**（用户 2026-11-07）：重跑这一期
          只有一个入口——正文顶部工具栏那颗；面板只讲原因、步骤与去设置看一眼。 */}
      {failure !== null && bodyState === 'failure' ? <DailyBriefingFailurePanel failure={failure} text={text} formatTime={formatTime} onOpenSettings={onOpenSettings} /> : null}
      {/* Any editorial failure, not just "AI is off": when the editor could not produce its half, the
          edition still ships and says so here. A reader must never be told "no brief today" instead. */}
      {view.status === 'ready' && view.document.provenance.editorialFailure ? <p className="mi-daily-briefing-page__ai-failure" role="status">{text.aiSettings.notApplied} · {editorialFailureText(view.document.provenance.editorialFailure, text)}</p> : null}
      {showingEdition && view.document.status.readingsAvailable === 0 ? <StateView
        state="empty"
        reasonCode="nothing-enabled"
        productReason={{
          key: 'mi.dailyBriefing.nothingEnabled',
          resolve: (key, params) => resolveBriefingStateReason(text, key, params)
        }}
        action={{ labelKey: 'ui.state.action.open-settings', onSelect: onConfigureSources }}
      /> : null}
      {/* 重跑失败但旧正文还在：正文留着，失败只说成**一条标记**——「重新生成失败 · 原因」开头，
          末尾写明"下面是上一次生成的版本"。正文侧**不放重试**：重跑走工具栏，两个入口改同一件事
          只会让读者不知道该按哪个。以前这里挂的是整块失败面板 + 一颗重试。 */}
      {failureUnderPaper && failure !== null ? <p className="mi-daily-briefing-page__ai-failure" role="status" data-rerun-failed="true">
        <strong>{text.regenerateFailed}</strong>
        {failure.code ? <> · {briefFailureCodeLabel(failure.code, { failure: text.aiSettings.failure, failurePanel: text.failurePanel })}</> : null}
        {' '}{text.staleUnderFailure}
      </p> : null}
      {/* A run replaces this edition only when it succeeds: until then the reader keeps the one that
          is already there, and the run reports in the right column. */}
      {/* The paper is a fixed sheet, never a fluid column: the poster keeps its 1080 px and the page
          scales the whole sheet down. Stretching it to the column width is what re-flowed the three cards
          and wrapped the rate card's number across its dial. */}
      {/* `showingEdition` 同时是类型收窄：纸里的 `view.document` 只有它成立时存在。 */}
      {/* 重跑期间正文照常可读（不抢屏），但**必须自己说是上一版**（`02` v2.167）；跑完这一档
          消失，说明随之消失。组件自己处理"不显示时不留空壳"。 */}
      <BriefingReplacingNotice visible={mode === 'ready-replacing'} label={text.previousUnderRegenerate} />
      {showingEdition && bodyState === 'paper' ? <div className="mi-daily-briefing-page__paper" ref={paperHostRef} style={paperHostHeight ? { height: paperHostHeight } : undefined}>
        <div className="mi-daily-briefing-page__paper-scale" style={{ left: paperOffsetX, transform: `scale(${paperScale})` }}>
          <div ref={paperSheetRef} style={{ width: BRIEFING_PAPER_WIDTH }}>
            <DailyBriefingShareCard document={view.document} text={editionText} locale={editionLocale} readOnly={view.kind === 'history'} paymentDirectionsCompact={briefingPaymentDirections(editionLocale)} policyWords={briefingPolicyGaugeWords(editionLocale)} changeArrows={briefingChangeArrows(editionLocale)} fearGreedBuckets={briefingFearGreedBuckets(editionLocale)} {...(eventTitles ? { eventTitles } : {})} formatTime={formatTime} timeZone={timeZone} />
          </div>
          </div>
        </div> : null}
      </div>
    </div>
  </section>
}
