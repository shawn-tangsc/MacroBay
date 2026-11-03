import { Button, Checkbox, Select } from 'antd'
import { CircleHelp } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  dailyBriefingGenerationPolicy,
  dailyBriefingGenerationTimes
} from '../../../contracts/dailyBriefing'
import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import type { DailyBriefingText } from './dailyBriefingText'

export type EditionLocale = 'zh-CN' | 'en-US'

/** What the generation section edits: the first period, plus the one global language choice. */
export type GenerationSettingsDraft = Readonly<{
  generationTime: string
  windowHours: number
  additionalLanguages: readonly EditionLocale[]
}>

export type DailyBriefingGenerationSettingsState = Readonly<{
  state: 'loading' | 'ready' | 'load-failed' | 'save-failed'
  saving: boolean
  /** `true` when the save landed; the host prefixes the failure with the section's name. */
  save: () => Promise<boolean>
  reload: () => void
  draft: GenerationSettingsDraft | null
  plan: Readonly<{ used: EditionLocale; requested: string; fallback: boolean }> | null
  /** The zone the stored time means (null when the stored value is not a zone), plus that raw value. */
  zone: string | null
  displayZone: string
  invalidZone: string | null
  periodCount: number
  update: (patch: Partial<GenerationSettingsDraft>) => void
}>

/**
 * Reads and writes the generation block.
 *
 * The block owns no dialog, no footer and no scroll area: a host — the generation modal today, the
 * settings drawer next — renders one 取消/保存 for everything it embeds and calls `save` here.
 */
export function useDailyBriefingGenerationSettings(input: Readonly<{
  client: Pick<DailyBriefingClient, 'getSettings' | 'saveSettings'>
  /** The host defers reading until its surface opens; default is to read immediately. */
  enabled?: boolean
}>): DailyBriefingGenerationSettingsState {
  const [state, setState] = useState<'loading' | 'ready' | 'load-failed' | 'save-failed'>('loading')
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<GenerationSettingsDraft | null>(null)
  const [plan, setPlan] = useState<Readonly<{ used: EditionLocale; requested: string; fallback: boolean }> | null>(null)
  const [zone, setZone] = useState<string | null>(null)
  const [invalidZone, setInvalidZone] = useState<string | null>(null)
  const [periodCount, setPeriodCount] = useState(1)
  const [reloadKey, setReloadKey] = useState(0)
  // The reader's own zone: a period with no stored zone means "the reader's zone", so the label
  // names a real offset (GMT+8) instead of falling back to a bare "GMT" they are not in.
  const displayZone = useShellTimeZone()

  useEffect(() => {
    if (input.enabled === false) return
    // A host that mounted this block before wiring a client must not crash the page.
    const readSettings = input.client?.getSettings
    if (typeof readSettings !== 'function') {
      setState('load-failed')
      return
    }
    let active = true
    setState('loading')
    setDraft(null)
    void readSettings().then((settings) => {
      if (!active) return
      if (settings.state !== 'available') {
        setState('load-failed')
        return
      }
      // The list is the whole view: the period this block edits (a save applies to the first
      // period) is the only place its values live.
      const periods = settings.view.generation.periods
      const period = periods[0]
      if (!period) {
        setState('load-failed')
        return
      }
      setPeriodCount(Math.max(1, periods.length))
      setZone(period.generationTimeZoneInvalid ? null : period.generationTimeZone)
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
      setState('ready')
    }).catch(() => { if (active) setState('load-failed') })
    return () => { active = false }
  }, [input.client, reloadKey, input.enabled])

  return {
    state,
    saving,
    draft,
    plan,
    zone,
    displayZone,
    invalidZone,
    periodCount,
    update(patch) {
      setDraft((current) => current ? { ...current, ...patch } : current)
    },
    reload() {
      setReloadKey((count) => count + 1)
    },
    async save() {
      if (!draft) return false
      setSaving(true)
      try {
        const result = await input.client.saveSettings({
          generation: { generationTime: draft.generationTime, windowHours: draft.windowHours },
          language: { additional: draft.additionalLanguages }
        })
        if (result.state === 'available') {
          setState('ready')
          return true
        }
        setState('save-failed')
        return false
      } catch {
        setState('save-failed')
        return false
      } finally {
        setSaving(false)
      }
    }
  }
}

/**
 * The generation section's content: one edition period and the one global language choice.
 *
 * With one period there is no period number on screen. Adding one is disabled and says why; that
 * sentence is the control's own accessible name, because a disabled control with no reason is a dead
 * end. The section renders its own reading states; the host supplies the cancel/save pair.
 */
export function DailyBriefingGenerationSettingsSection({ text, ...state }: Readonly<{
  text: DailyBriefingText
}> & Omit<DailyBriefingGenerationSettingsState, 'saving' | 'save'>): React.ReactElement {
  const resolveProductText = useProductTextKey()
  const { draft, plan, invalidZone, periodCount, update } = state

  if (state.state === 'load-failed') {
    return <StateView
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: state.reload }}
      reasonCode="unreadable"
      resolveText={resolveProductText}
      state="error"
    />
  }
  if (state.state === 'loading' || !draft) {
    return <LoadingState label={text.generationSettings.loading} minHeight={90} />
  }

  const periodLabels = text.settings.periods
  const languageName = (locale: EditionLocale): string => (text.settings.languageNames as Record<string, string>)[locale] ?? locale
  // The extra list never offers the primary: ticking "also English" in an English interface would
  // write the same edition twice.
  const extraLanguages: readonly EditionLocale[] = plan && plan.used !== 'en-US' ? ['en-US'] : []
  const extraChecked = extraLanguages.some((locale) => draft.additionalLanguages.includes(locale))
  // The number in the cost sentence is the count the generation will use, not a hard-coded 2.
  const writeCount = 1 + (extraChecked ? 1 : 0)
  const costParams = { count: String(writeCount), extra: String(writeCount - 1) }
  // A stored value we cannot read is named in the warning; it must not also produce a chip that
  // looks like a working zone.
  const zone = invalidZone ? null : (state.zone ?? state.displayZone)

  // Every form control in this block belongs to the brief's own settings; the drawer's
  // acceptance gate counts "form controls == controls under a declared scope" and flags the rest.
  return <div data-setting-scope="brief">
    {/* This sentence explains the whole form's save, not one group, so it heads the block: both
        hosts — the generation dialog and the settings drawer — show it from here, once. */}
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
          onChange={(generationTime: string) => update({ generationTime })}
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
        onChange={(windowHours: number) => update({ windowHours })}
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
        panel, not off its right edge. */}
    {extraLanguages.length > 0
      ? <div className="mi-daily-briefing__settings-row">
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
        <Checkbox
          checked={extraChecked}
          onChange={(event) => {
            const checked = event.target.checked
            update({
              additionalLanguages: checked
                ? [...new Set([...draft.additionalLanguages, ...extraLanguages])]
                : draft.additionalLanguages.filter((locale) => !extraLanguages.includes(locale))
            })
          }}
        >{periodLabels.additional}</Checkbox>
      </div>
      : null}
    {state.state === 'save-failed' ? <p className="mi-daily-briefing__settings-error" role="alert">{text.generationSettings.failed}</p> : null}
  </div>
}
