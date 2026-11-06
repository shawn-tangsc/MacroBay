import { Button, DatePicker, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { CircleHelp } from 'lucide-react'
import { useEffect, useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Modal } from '@platform/ui/components/modal'
import { Popover } from '@platform/ui/components/popover'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'

import { dailyBriefingGenerationPolicy, dailyBriefingGenerationTimes, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { isManualGenerationDateAllowed } from '../../../contracts/dailyBriefingGenerationWindow'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import type { DailyBriefingText } from './dailyBriefingText'
import { briefingGenerationGridHint } from './dailyBriefingText'

/**
 * 手动生成要的四样：**哪一天**、截止（`'now'` 或某个小时）、窗口、语言。
 *
 * `date` 是读者本地日历上的那一天（`YYYY-MM-DD`）。少了它，"00:00"只能由实现猜是哪天的 00:00，
 * 于是凌晨手动生成会落到第二天（`02` v2.129 G1）。
 */
export type BriefingManualRunDraft = Readonly<{
  /** 读者本地日历上的那一天，`YYYY-MM-DD`。 */
  date: string
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

export function BriefingManualRunDialog({ open, text, timeZone, defaultDate, latestDate, running = false, problem, duplicate, onRun, onReplace, onClose }: Readonly<{
  open: boolean
  text: DailyBriefingText
  /** 读者时区：日期与时刻都按它落成绝对时刻，确认区也按它写时区名。 */
  timeZone: string
  /** 打开时的默认日期：读者当前在的那一天（首次进入即日历今天）。 */
  defaultDate: string
  /** 可选的最晚日期：日历今天。未来一天等于凭空造一期，这里就挡住。 */
  latestDate: string
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
    date: defaultDate,
    cutoff: 'now',
    windowHours: dailyBriefingGenerationPolicy.defaultWindowHours,
    language: 'zh-CN'
  })
  // 每次打开都把**日期**拉回读者当前那一天：上次留下的日期会让人误以为默认值又变了。
  // 其余三样保持读者上一次的选择（同一组合重复生成是允许的，见 A7.9）。
  useEffect(() => {
    if (!open) return
    setDraft((current) => ({ ...current, date: defaultDate }))
  }, [open, defaultDate])
  const windowLabel = (hours: number): string => copy.windowValue.replace('{hours}', String(hours))
  // 两句话合成一个问号：「可选时刻有档位」和「截止 = 按下那一刻」。正文里不再铺说明。
  const cutoffHelp = `${briefingGenerationGridHint(text)} ${copy.nowHint}`
  // 每个字段都有自己的问号：说明放在它专属的浮层里，鼠标 hover 与键盘聚焦都能展开。
  // `ariaLabelKey` 必须是**键的形状**（点分、无空白、无中文），句子由这里注入的解析器给出。
  const helpTrigger = (labelKey: string, label: string, sentence: string): React.ReactElement =>
    <Popover
      labelKey={labelKey}
      resolveText={(key) => (key === labelKey ? sentence : '')}
      trigger={(triggerProps) => <IconButton
        ariaLabelKey={labelKey}
        icon={CircleHelp}
        resolveText={(key) => (key === labelKey ? label : '')}
        size="sm"
        variant="plain"
        {...triggerProps}
      />}
    />
  // 「正在生成」是整期状态，不是字段错：它放底部、让确定键禁用，并同屏写出原因。
  const blockedReason = problem === 'already-running' ? copy.alreadyRunning : undefined
  // 字段级的拒绝贴在该字段下面，作为它的兄弟节点；同一时刻只出现一处提示。
  const cutoffProblem = problem === 'cutoff-in-future' || problem === 'cutoff-unreadable' ? problem : undefined
  const cutoffProblemText = cutoffProblem === 'cutoff-in-future' ? copy.cutoffInFuture : cutoffProblem === 'cutoff-unreadable' ? copy.cutoffUnreadable : undefined
  const keys = {
    date: 'pages.intelligence.portal.dashboard.dailyBriefing.manualRunDialog.dateHintLabel',
    cutoff: 'pages.intelligence.portal.dashboard.dailyBriefing.manualRunDialog.cutoffHintLabel',
    window: 'pages.intelligence.portal.dashboard.dailyBriefing.manualRunDialog.windowHintLabel',
    language: 'pages.intelligence.portal.dashboard.dailyBriefing.manualRunDialog.languageHintLabel',
    repeat: 'pages.intelligence.portal.dashboard.dailyBriefing.manualRunDialog.repeatHintLabel'
  }
  // 提交前把落点写出来（`02` v2.129 G1）：读者要能看见它写到哪一天，而不是按完才发现归档在别处。
  const zoneLabel = formatShellTimeZoneLabel(timeZone)
  const targetSentence = draft.cutoff === 'now'
    ? copy.generateTargetNow.replace('{date}', draft.date).replace('{zone}', zoneLabel)
    : copy.generateTarget.replace('{date}', draft.date).replace('{time}', draft.cutoff).replace('{zone}', zoneLabel)

  return <Modal
    footer={<div className="mi-briefing-period-dialog__actions">
      {/* 「同一组合可以重复生成」属于**整个动作**的说明：挂在按钮行左侧，不挤进标题。它回答的是
          "点两次会不会出事"，所以位置就在"点"旁边。 */}
      <span className="mi-briefing-period-dialog__actions-help">
        {helpTrigger(keys.repeat, copy.repeatHintLabel, copy.repeatable)}
      </span>
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
      {/* 三个字段都是同一种结构，别只改一处：**`<label>` 只包标题文字并 `htmlFor` 指到控件**。
          问号排在同一行的最左，但**不在 label 里**——浏览器点 label 会把焦点交给其中第一个可聚焦元素，
          以前那个元素就是问号，于是点时间那一行会被当成"点了问号"，浮层弹出来压住下拉。 */}
      {/* 日期是**第一项**：它决定"00:00 是哪一天的 00:00"（`02` v2.129 G1）。
          默认＝读者当前在的那一天；不许选未来——未来那一天等于凭空造一期。 */}
      <div className="mi-briefing-period-dialog__field">
        <span className="mi-daily-briefing__field-label">
          {helpTrigger(keys.date, copy.dateHintLabel, copy.dateHint)}
          <label htmlFor="mi-briefing-manual-date"><strong>{copy.date}</strong></label>
        </span>
        <DatePicker
          allowClear={false}
          aria-label={copy.date}
          format="YYYY-MM-DD"
          // 只允许**最近 3 天**（含今天）：超窗不给选，弹框下方写明原因（用户 2026-11-06）。
          disabledDate={(value: Dayjs) => !isManualGenerationDateAllowed(value.format('YYYY-MM-DD'), latestDate ?? value.format('YYYY-MM-DD'))}
          id="mi-briefing-manual-date"
          onChange={(value: Dayjs | null) => {
            if (value === null) return
            setDraft((current) => ({ ...current, date: value.format('YYYY-MM-DD') }))
          }}
          value={dayjs(draft.date)}
          style={{ width: 160 }}
        />
        {/* 只能选最近 3 天：写出来，读者不用试才知道（用户 2026-11-06）。 */}
        <small className="mi-briefing-period-dialog__note" data-manual-window-hint="true">{copy.windowDaysHint}</small>
      </div>

      <div className="mi-briefing-period-dialog__field">
        {/* 说明不铺在正文里：三句描述收进问号，hover 与键盘聚焦都能展开（平台 `Popover`）。
            标题在前、问号在**标题前面**，`sm` 档随组件走，不写死像素。 */}
        <span className="mi-daily-briefing__field-label">
          {helpTrigger(keys.cutoff, copy.cutoffHintLabel, cutoffHelp)}
          <label htmlFor="mi-briefing-manual-cutoff"><strong>{copy.cutoff}</strong></label>
        </span>
        <Select
          id="mi-briefing-manual-cutoff"
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
      </div>
      {cutoffProblemText === undefined ? null : <p className="mi-briefing-period-dialog__conflict" role="alert"
        data-tone={cutoffProblem === 'cutoff-in-future' ? 'invalid' : undefined} data-manual-problem={cutoffProblem}>
        {cutoffProblemText}
      </p>}

      <div className="mi-briefing-period-dialog__field">
        <span className="mi-daily-briefing__field-label">
          {helpTrigger(keys.window, copy.windowHintLabel, copy.windowHint)}
          <label htmlFor="mi-briefing-manual-window"><strong>{copy.windowHours}</strong></label>
        </span>
        <Select
          id="mi-briefing-manual-window"
          aria-label={copy.windowHours}
          value={draft.windowHours}
          onChange={(windowHours: number) => setDraft((current) => ({ ...current, windowHours }))}
          options={dailyBriefingGenerationPolicy.windowHoursOptions.map((hours) => ({ value: hours, label: windowLabel(hours) }))}
          style={{ width: 128 }}
        />
      </div>
      <div className="mi-briefing-period-dialog__field">
        <span className="mi-daily-briefing__field-label">
          {helpTrigger(keys.language, copy.languageHintLabel, copy.languageHint)}
          <label htmlFor="mi-briefing-manual-language"><strong>{copy.language}</strong></label>
        </span>
        <Select
          id="mi-briefing-manual-language"
          aria-label={copy.language}
          value={draft.language}
          onChange={(language: DailyBriefingLocale) => setDraft((current) => ({ ...current, language }))}
          options={[
            { value: 'zh-CN', label: text.history.languages['zh-CN'] },
            { value: 'en-US', label: text.history.languages['en-US'] }
          ]}
          style={{ width: 128 }}
        />
      </div>
      {/* 落点写在按之前：读者要能看见它写到哪一天、哪个时刻、哪个时区。 */}
      <p className="mi-briefing-period-dialog__note" data-manual-target="true">{targetSentence}</p>
      {/* A7.9: the reader must be told that pressing again with the same choices is a new issue,
          not a mistake — otherwise the behavior looks like a bug and they delete the second one. */}
      {duplicate === undefined ? null : <>
        <p className="mi-briefing-period-dialog__conflict" role="alert" data-manual-duplicate="true">{duplicate.label}</p>
        <p className="mi-briefing-period-dialog__note">{copy.duplicateBody}</p>
      </>}
      {blockedReason === undefined ? null : <p className="mi-briefing-period-dialog__conflict" id="manual-run-blocked-reason" role="alert" data-manual-problem={problem}>
        {blockedReason}
      </p>}
    </div>
  </Modal>
}
