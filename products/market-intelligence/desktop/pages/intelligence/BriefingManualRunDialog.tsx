import { Button, Select } from 'antd'
import { useState } from 'react'

import { Modal } from '@platform/ui/components/modal'

import { dailyBriefingGenerationPolicy, dailyBriefingGenerationTimes, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import type { DailyBriefingText } from './dailyBriefingText'
import { briefingGenerationGridHint } from './dailyBriefingText'

/** What the manual run form asks for: a cutoff (`'now'` or a wall-clock hour), a window, a language. */
export type BriefingManualRunDraft = Readonly<{
  /** `'now'` means "the moment the reader presses"; the caller turns it into the click instant. */
  cutoff: 'now' | string
  windowHours: number
  language: DailyBriefingLocale
}>

/**
 * One-off generation: three choices, no uniqueness rule.
 *
 * Unlike "add an issue", the same combination may be used again — the reader pressing twice asked
 * for two runs, not for a duplicate form — so the form never refuses on that ground and says so in
 * its own words (A7.9). No period configuration is written by this dialog.
 */
export type BriefingManualRunProblem =
  | 'cutoff-in-future'
  | 'cutoff-unreadable'
  /** 整期状态，不是字段错：提示放底部、确定键禁用并同屏说明原因。 */
  | 'already-running'

export function BriefingManualRunDialog({ open, text, running = false, problem, duplicate, onRun, onReplace, onClose }: Readonly<{
  open: boolean
  text: DailyBriefingText
  running?: boolean
  /** Why the last press did not start a run; the dialog stays open so the reader can fix it. */
  problem?: BriefingManualRunProblem | undefined
  /** 同一 (日期, 截止, 窗口, 语言) 已经有一版：在**同一个弹框里**问替换，不叠第二层。 */
  duplicate?: Readonly<{ label: string }> | undefined
  onRun: (draft: BriefingManualRunDraft) => void
  onReplace: () => void
  onClose: () => void
}>): React.ReactElement {
  const resolveProductText = useProductTextKey()
  const copy = text.manualRunDialog
  const [draft, setDraft] = useState<BriefingManualRunDraft>({
    cutoff: 'now',
    windowHours: dailyBriefingGenerationPolicy.defaultWindowHours,
    language: 'zh-CN'
  })
  const windowLabel = (hours: number): string => copy.windowValue.replace('{hours}', String(hours))
  // 「正在生成」是整期状态，不是字段错：它放底部、让确定键禁用，并同屏写出原因。
  const blockedReason = problem === 'already-running' ? copy.alreadyRunning : undefined
  // 字段级的拒绝贴在该字段下面，作为它的兄弟节点；同一时刻只出现一处提示。
  const cutoffProblem = problem === 'cutoff-in-future' || problem === 'cutoff-unreadable' ? problem : undefined
  const cutoffProblemText = cutoffProblem === 'cutoff-in-future' ? copy.cutoffInFuture : cutoffProblem === 'cutoff-unreadable' ? copy.cutoffUnreadable : undefined

  return <Modal
    footer={<div className="mi-briefing-period-dialog__actions">
      <Button autoFocus onClick={onClose}>{copy.cancel}</Button>
      {duplicate === undefined
        ? <Button
          aria-describedby={blockedReason === undefined ? undefined : 'manual-run-blocked-reason'}
          disabled={running || blockedReason !== undefined} loading={running}
          onClick={() => onRun(draft)} type="primary">
          {running ? copy.running : copy.run}
        </Button>
        : <Button onClick={onReplace} type="primary">{copy.duplicateReplace}</Button>}
    </div>}
    onClose={onClose}
    open={open}
    resolveText={resolveProductText}
    titleKey={duplicate === undefined
      ? 'pages.intelligence.portal.dashboard.dailyBriefing.manualRunDialog.title'
      : 'pages.intelligence.portal.dashboard.dailyBriefing.manualRunDialog.duplicateTitle'}
    width="standard"
  >
    <div className="mi-briefing-period-dialog" data-manual-run-dialog="true">
      <label className="mi-briefing-period-dialog__field">
        <strong>{copy.cutoff}</strong>
        <Select
          aria-label={copy.cutoff}
          value={draft.cutoff}
          onChange={(cutoff: string) => setDraft((current) => ({ ...current, cutoff }))}
          options={[
            // "Now" is a peer option in the list, not a hidden secondary control.
            { value: 'now', label: copy.now },
            ...dailyBriefingGenerationTimes.map((value) => ({ value, label: value }))
          ]}
          virtual={false}
          style={{ width: 128 }}
        />
      </label>
      {cutoffProblemText === undefined ? null : <p className="mi-briefing-period-dialog__conflict" role="alert"
        data-tone={cutoffProblem === 'cutoff-in-future' ? 'invalid' : undefined} data-manual-problem={cutoffProblem}>
        {cutoffProblemText}
      </p>}
      {/* 指定时刻取自同一张表，所以档位说明也从那张表算——「现在」是第三种选择，不受档位约束。 */}
      <p className="mi-briefing-period-dialog__hint" data-time-grid="true">{briefingGenerationGridHint(text)}</p>
      {draft.cutoff === 'now' ? <p className="mi-briefing-period-dialog__hint">{copy.nowHint}</p> : null}
      <label className="mi-briefing-period-dialog__field">
        <strong>{copy.windowHours}</strong>
        <Select
          aria-label={copy.windowHours}
          value={draft.windowHours}
          onChange={(windowHours: number) => setDraft((current) => ({ ...current, windowHours }))}
          options={dailyBriefingGenerationPolicy.windowHoursOptions.map((hours) => ({ value: hours, label: windowLabel(hours) }))}
          style={{ width: 128 }}
        />
      </label>
      <label className="mi-briefing-period-dialog__field">
        <strong>{copy.language}</strong>
        <Select
          aria-label={copy.language}
          value={draft.language}
          onChange={(language: DailyBriefingLocale) => setDraft((current) => ({ ...current, language }))}
          options={[
            { value: 'zh-CN', label: text.history.languages['zh-CN'] },
            { value: 'en-US', label: text.history.languages['en-US'] }
          ]}
          style={{ width: 128 }}
        />
      </label>
      {/* A7.9: the reader must be told that pressing again with the same choices is a new issue,
          not a mistake — otherwise the behavior looks like a bug and they delete the second one. */}
      {duplicate === undefined ? null : <>
        <p className="mi-briefing-period-dialog__conflict" role="alert" data-manual-duplicate="true">{duplicate.label}</p>
        <p className="mi-briefing-period-dialog__note">{copy.duplicateBody}</p>
      </>}
      {duplicate === undefined ? <p className="mi-briefing-period-dialog__note">{copy.repeatable}</p> : null}
      {blockedReason === undefined ? null : <p className="mi-briefing-period-dialog__conflict" id="manual-run-blocked-reason" role="alert" data-manual-problem={problem}>
        {blockedReason}
      </p>}
    </div>
  </Modal>
}
