import { CircleHelp } from 'lucide-react'
import { useEffect, useState } from 'react'

import { dailyBriefingGenerationPolicy } from '../../../contracts/dailyBriefing'
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import './dailyBriefingSettingsForm.css'
import type { DailyBriefingText } from './dailyBriefingText'
import { BriefingPeriodsPanel } from './BriefingPeriodsPanel'

export type EditionLocale = 'zh-CN' | 'en-US'

/** What the generation section edits: the first period, plus the one global language choice. */
export type GenerationSettingsDraft = Readonly<{
  generationTime: string
  windowHours: number
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
  /** True when the reader has edited something that a save would write. */
  dirty: boolean
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
  // What was read, kept to answer "did the reader change anything". A close with unsaved edits must
  // not throw them away silently, so the drawer asks this before it closes.
  const [loaded, setLoaded] = useState<GenerationSettingsDraft | null>(null)
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
      // The global "also generate English" control is gone; the old value stays in the settings file
      // because a save that omits `language` does not rewrite it.
      const next = {
        generationTime: period.generationTime,
        windowHours: period.windowHours
      } as const
      setLoaded(next)
      setDraft(next)
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
    dirty: Boolean(draft && loaded && JSON.stringify(draft) !== JSON.stringify(loaded)),
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
          generation: { generationTime: draft.generationTime, windowHours: draft.windowHours }
        })
        if (result.state === 'available') {
          // The saved values are the new baseline: without this, a successful save followed by a
          // close would ask "discard your changes?" about edits that are already stored.
          setLoaded(draft)
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

  if (state.state === 'load-failed') {
    return <StateView
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: state.reload }}
      reasonCode="unreadable"
      resolveText={resolveProductText}
      state="error"
    />
  }

  // The four fields that used to live here — generation time, window, edition language and "also
  // English" — are period properties now, edited one period at a time in the list below. Leaving any
  // of them here would be a second place to set the same thing, and the one that is not stored is the
  // one the reader will believe.
  return <div className="mi-briefing-settings-form" data-setting-scope="brief">
    <p className="mi-daily-briefing__settings-link">
      <span className="mi-daily-briefing__field-label">
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
        <span>{text.generationSettings.noteLabel}</span>
      </span>
    </p>
    <BriefingPeriodsPanel text={text} />
  </div>
}
