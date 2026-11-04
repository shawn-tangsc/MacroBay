import { Button, Select } from 'antd'
import { useState } from 'react'

import { Modal } from '@platform/ui/components/modal'

import { useProductTextKey } from '../../shared/i18n/productTextKey'

import { dailyBriefingGenerationPolicy, dailyBriefingGenerationTimes, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import {
  briefingPeriodConflict,
  briefingPeriodDraftIssue,
  type BriefingPeriod,
  type BriefingPeriodDraft
} from '../../../contracts/dailyBriefingPeriod'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * Adding (or editing) one scheduled period: the hour it runs, the window it reads, the language it
 * writes. Validation is the same rule the store enforces — imported, not re-written — so the form
 * cannot enable a Save the store would refuse, and the conflicting row is named instead of leaving
 * the reader to guess which of their periods is in the way.
 */
export function BriefingPeriodDialog({ open, text, periods, editing, saving = false, onSave, onClose }: Readonly<{
  open: boolean
  text: DailyBriefingText
  /** Every saved period, for the uniqueness verdict. */
  periods: readonly BriefingPeriod[]
  /** Present when the dialog edits an existing row; the id stays, only the values change. */
  editing?: BriefingPeriod
  saving?: boolean
  onSave: (draft: BriefingPeriodDraft) => void
  onClose: () => void
}>): React.ReactElement {
  const [draft, setDraft] = useState<BriefingPeriodDraft>(() => ({
    generationTime: editing?.generationTime ?? dailyBriefingGenerationPolicy.defaultGenerationTime,
    windowHours: editing?.windowHours ?? dailyBriefingGenerationPolicy.defaultWindowHours,
    language: editing?.language ?? 'zh-CN' as DailyBriefingLocale
  }))
  const resolveProductText = useProductTextKey()
  const copy = text.periodDialog
  const issue = briefingPeriodDraftIssue(draft)
  const conflict = issue ? undefined : briefingPeriodConflict(periods, draft, editing?.id)
  const canSave = issue === undefined && conflict === undefined && !saving

  const label = (windowHours: number): string => copy.windowValue.replace('{hours}', String(windowHours))

  return <Modal
    footer={<>
      <Button onClick={onClose}>{copy.cancel}</Button>
      <Button disabled={!canSave} loading={saving} onClick={() => onSave(draft)} type="primary">
        {saving ? copy.saving : copy.save}
      </Button>
    </>}
    onClose={onClose}
    open={open}
    resolveText={resolveProductText}
    titleKey="pages.intelligence.portal.dashboard.dailyBriefing.periodDialog.title"
    width="standard"
  >
    <div className="mi-briefing-period-dialog" data-period-dialog="true">
      <p className="mi-briefing-period-dialog__hint">{copy.hint}</p>
      <label className="mi-briefing-period-dialog__field">
        <strong>{copy.generationTime}</strong>
        <Select
          aria-label={copy.generationTime}
          value={draft.generationTime}
          onChange={(generationTime: string) => setDraft((current) => ({ ...current, generationTime }))}
          options={dailyBriefingGenerationTimes.map((value) => ({ value, label: value }))}
          // 48 fixed slots: render them all, so the list is the same for readers and tests alike.
          virtual={false}
          style={{ width: 108 }}
        />
      </label>
      <label className="mi-briefing-period-dialog__field">
        <strong>{copy.windowHours}</strong>
        <Select
          aria-label={copy.windowHours}
          value={draft.windowHours}
          onChange={(windowHours: number) => setDraft((current) => ({ ...current, windowHours }))}
          options={dailyBriefingGenerationPolicy.windowHoursOptions.map((hours) => ({ value: hours, label: label(hours) }))}
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
      {/* A4.3: the conflict is shown before the reader presses Save, and the button is disabled —
          not an error that only appears after clicking. */}
      {conflict ? <p className="mi-briefing-period-dialog__conflict" role="alert" data-period-conflict={conflict.id}>
        {copy.conflict
          .replace('{time}', conflict.generationTime)
          .replace('{window}', label(conflict.windowHours))
          .replace('{language}', text.history.languages[conflict.language])}
      </p> : null}
      {issue ? <p className="mi-briefing-period-dialog__conflict" role="alert" data-period-issue={issue}>{copy.invalid}</p> : null}
    </div>
  </Modal>
}
