import { Button, Checkbox, Select } from 'antd'
import { CircleHelp } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  dailyBriefingGenerationPolicy,
  dailyBriefingGenerationTimes
} from '../../../contracts/dailyBriefing'
import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Modal } from '@platform/ui/components/modal'
import { Popover } from '@platform/ui/components/popover'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import type { DailyBriefingText } from './dailyBriefingText'

type EditionLocale = 'zh-CN' | 'en-US'

type GenerationDraft = Readonly<{
  generationTime: string
  windowHours: number
  additionalLanguages: readonly EditionLocale[]
}>

/**
 * The generation setting: one edition period, and the one language choice that is global to it.
 *
 * The period decides when the edition runs and how far back it looks; language is not a period
 * field (a morning in Chinese and an evening in English is a combination no reader can predict), so
 * it sits beside the period row as one global choice.
 *
 * With one period there is no period number on screen: a reader who never asked for a second edition
 * must not see period controls. Adding one is disabled and says why, and that sentence is the
 * control's own accessible name — a disabled control with no reason is a dead end.
 *
 * A save applies to the next edition; editions that already exist keep the window and cutoff they
 * were generated with.
 */
export function DailyBriefingGenerationSettingsModal({ open, text, client, onClose }: Readonly<{
  open: boolean
  text: DailyBriefingText
  client: Pick<DailyBriefingClient, 'getSettings' | 'saveSettings'>
  onClose: () => void
}>): React.ReactElement {
  const [draft, setDraft] = useState<GenerationDraft | null>(null)
  const [saving, setSaving] = useState(false)
  // The zone the stored time means, and the value that could not be read. Both come from the save
  // that wrote them; the panel never guesses a zone of its own.
  const [zone, setZone] = useState<string | null>(null)
  const [invalidZone, setInvalidZone] = useState<string | null>(null)
  const [plan, setPlan] = useState<Readonly<{ used: EditionLocale; requested: string; fallback: boolean }> | null>(null)
  const [periodCount, setPeriodCount] = useState(1)
  const [failed, setFailed] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const resolveProductText = useProductTextKey()
  // The reader's own zone: a period with no stored zone means "the reader's zone", and the label
  // must name a real offset (GMT+8), not fall back to a bare "GMT" that would be wrong for them.
  const shellTimeZone = useShellTimeZone()

  useEffect(() => {
    if (!open) return
    let active = true
    setDraft(null)
    setFailed(false)
    setLoadFailed(false)
    void client.getSettings().then((settings) => {
      if (!active) return
      if (settings.state !== 'available') {
        setLoadFailed(true)
        return
      }
      // The list is the whole view: the flat copy this dialog once read was removed, and the period
      // it edits (the save below applies to the first period) is the only place its values live.
      const periods = settings.view.generation.periods
      const period = periods[0]
      if (!period) {
        setLoadFailed(true)
        return
      }
      setPeriodCount(Math.max(1, periods.length))
      setZone(period.generationTimeZoneInvalid ? null : (period.generationTimeZone ?? shellTimeZone))
      setInvalidZone(period.generationTimeZoneInvalid)
      setPlan({
        used: settings.view.language.plan.primary.used,
        requested: settings.view.language.plan.primary.requested,
        fallback: settings.view.language.plan.primary.fallbackReason === 'ui-language-unsupported'
      })
      setDraft({
        generationTime: period.generationTime,
        windowHours: period.windowHours,
        additionalLanguages: settings.view.language.settings.additional
      })
    }).catch(() => { if (active) setLoadFailed(true) })
    return () => { active = false }
  }, [open, client, reloadKey, shellTimeZone])

  const periodLabels = text.settings.periods
  const languageName = (locale: EditionLocale): string => (text.settings.languageNames as Record<string, string>)[locale] ?? locale
  // The extra list never offers the primary: ticking "also English" in an English interface would
  // write the same edition twice.
  const extraLanguages: readonly EditionLocale[] = plan && plan.used !== 'en-US' ? ['en-US'] : []
  const extraChecked = Boolean(draft && extraLanguages.some((locale) => draft.additionalLanguages.includes(locale)))
  // The number in the cost sentence is the count the generation will use, not a hard-coded 2.
  const writeCount = 1 + (extraChecked ? 1 : 0)
  const costParams = { count: String(writeCount), extra: String(writeCount - 1) }

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    setFailed(false)
    try {
      const result = await client.saveSettings({
        generation: { generationTime: draft.generationTime, windowHours: draft.windowHours },
        language: { additional: draft.additionalLanguages }
      })
      if (result.state === 'available') onClose()
      else setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return <Modal
    footer={<>
      <Button onClick={onClose}>{text.generationSettings.cancel}</Button>
      <Button disabled={!draft || loadFailed} loading={saving} onClick={() => void save()} type="primary">
        {saving ? text.generationSettings.saving : text.generationSettings.save}
      </Button>
    </>}
    layer="over-drawer"
    onClose={onClose}
    open={open}
    resolveText={resolveProductText}
    titleKey="pages.intelligence.portal.dashboard.dailyBriefing.generationSettings.title"
    width="standard"
  >
    {loadFailed
      ? <StateView
        action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => setReloadKey((count) => count + 1) }}
        reasonCode="unreadable"
        resolveText={resolveProductText}
        state="error"
      />
      : !draft ? <LoadingState label={text.generationSettings.loading} minHeight={90} /> : <>
      {/* The "applies from the next brief" sentence explains the whole form's save, not one group: it belongs beside the title, so it
          sits at the top of the form instead of at the bottom under the language row. */}
      <p className="mi-daily-briefing__settings-link">
        <span>{text.generationSettings.noteLabel}</span>
        <Popover
          labelKey="pages.intelligence.portal.dashboard.dailyBriefing.generationSettings.note"
          resolveText={resolveProductText}
          trigger={(triggerProps) => <IconButton
            ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.generationSettings.noteLabel"
            variant="plain"
            icon={CircleHelp}
            resolveText={resolveProductText}
            size="sm"
            {...triggerProps}
          />}
        />
      </p>
      {periodCount > 1 ? <p className="mi-daily-briefing__settings-zone">{periodLabels.label.replace('{index}', '1')}</p> : null}
      <div className="mi-daily-briefing__settings-row">
        <strong>{text.generationSettings.generationTime}</strong>
        <div className="mi-daily-briefing__settings-time">
          <Select
            aria-label={text.generationSettings.generationTime}
            value={draft.generationTime}
            onChange={(generationTime: string) => setDraft((current) => current ? { ...current, generationTime } : current)}
            options={dailyBriefingGenerationTimes.map((value) => ({ value, label: periodLabels.timeValue.replace('{time}', value) }))}
            style={{ width: 108 }}
          />
          {/* The time is only half of the setting: 07:00 means 07:00 in this zone, and saying which
              zone is what keeps one day from producing two editions. */}
          {zone ? <span className="mi-daily-briefing__settings-zone" data-time-zone={zone}>{formatShellTimeZoneLabel(zone)}</span> : null}
        </div>
      </div>
      {invalidZone ? <p className="mi-daily-briefing__settings-warning" role="status">{text.generationSettings.invalidTimeZone.replace('{zone}', invalidZone)}</p> : null}
      <div className="mi-daily-briefing__settings-row">
        <strong>{text.generationSettings.windowHours}</strong>
        <Select
          aria-label={text.generationSettings.windowHours}
          value={draft.windowHours}
          onChange={(windowHours: number) => setDraft((current) => current ? { ...current, windowHours } : current)}
          options={dailyBriefingGenerationPolicy.windowHoursOptions.map((hours) => ({
            value: hours,
            label: periodLabels.windowValue.replace('{hours}', String(hours))
          }))}
          style={{ width: 128 }}
        />
      </div>
      {/* One edition only in this version: the button says why it cannot be added instead of
          disappearing, and that reason is the control's own accessible name. */}
      <div className="mi-daily-briefing__settings-row">
        <div className="mi-daily-briefing__settings-time">
        <Button disabled aria-label={periodLabels.addReason}>{periodLabels.add}</Button>
        <Popover
          labelKey="pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.addReason"
          resolveText={resolveProductText}
          trigger={(triggerProps) => <IconButton
            ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.addReason"
            variant="plain"
            icon={CircleHelp}
            resolveText={resolveProductText}
            size="sm"
            {...triggerProps}
          />}
        />
        </div>
      </div>

      <div className="mi-daily-briefing__settings-row">
        <div>
          <span className="mi-daily-briefing__field-label">
            {plan?.fallback
              ? <Popover
                labelKey="pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.languageUnsupported"
                labelParams={{ language: plan.requested }}
                resolveText={resolveProductText}
                trigger={(triggerProps) => <IconButton
                  ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.languageUnsupported"
                  ariaLabelParams={{ language: plan.requested }}
                  variant="plain"
                  icon={CircleHelp}
                  resolveText={resolveProductText}
                  size="sm"
                  {...triggerProps}
                />}
              />
              : null}
            <strong>{periodLabels.language}</strong>
          </span>
          <small>{plan?.fallback
            ? periodLabels.languageFallback.replace('{language}', languageName(plan.used))
            : periodLabels.languageFollow.replace('{language}', plan ? languageName(plan.used) : '')}</small>
        </div>
      </div>
      {/* The extra edition sits on its own row, left-aligned: its cost question opens inside the
          dialog, not off its right edge. */}
      {extraLanguages.length > 0
        ? <div className="mi-daily-briefing__settings-row">
          <Checkbox
            checked={extraChecked}
            onChange={(event) => {
              const checked = event.target.checked
              setDraft((current) => current ? {
                ...current,
                additionalLanguages: checked
                  ? [...new Set([...current.additionalLanguages, ...extraLanguages])]
                  : current.additionalLanguages.filter((locale) => !extraLanguages.includes(locale))
              } : current)
            }}
          >{periodLabels.additional}</Checkbox>
          {extraChecked
            ? <Popover
              labelKey="pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.cost"
              labelParams={costParams}
              resolveText={resolveProductText}
              trigger={(triggerProps) => <IconButton
                ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.costLabel"
                variant="plain"
                icon={CircleHelp}
                resolveText={resolveProductText}
                size="sm"
                {...triggerProps}
              />}
            />
            : null}
        </div>
        : null}

      {failed ? <p className="mi-daily-briefing__settings-error" role="alert">{text.generationSettings.failed}</p> : null}
    </>}
  </Modal>
}
