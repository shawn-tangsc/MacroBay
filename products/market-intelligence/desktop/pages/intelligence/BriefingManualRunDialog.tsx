import { Button, Select } from 'antd'
import { useState } from 'react'

import { Modal } from '@platform/ui/components/modal'

import { dailyBriefingGenerationPolicy, dailyBriefingGenerationTimes, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import type { DailyBriefingText } from './dailyBriefingText'

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
export function BriefingManualRunDialog({ open, text, running = false, onRun, onClose }: Readonly<{
  open: boolean
  text: DailyBriefingText
  running?: boolean
  onRun: (draft: BriefingManualRunDraft) => void
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

  return <Modal
    footer={<>
      <Button onClick={onClose}>{copy.cancel}</Button>
      <Button disabled={running} loading={running} onClick={() => onRun(draft)} type="primary">
        {running ? copy.running : copy.run}
      </Button>
    </>}
    onClose={onClose}
    open={open}
    resolveText={resolveProductText}
    titleKey="pages.intelligence.portal.dashboard.dailyBriefing.manualRunDialog.title"
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
      <p className="mi-briefing-period-dialog__note">{copy.repeatable}</p>
    </div>
  </Modal>
}
