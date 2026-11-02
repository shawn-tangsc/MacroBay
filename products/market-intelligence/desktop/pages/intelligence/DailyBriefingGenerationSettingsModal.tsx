import { Button, Select } from 'antd'
import { useEffect, useState } from 'react'

import {
  dailyBriefingGenerationPolicy,
  dailyBriefingGenerationTimes
} from '../../../contracts/dailyBriefing'
import { LoadingState } from '@platform/ui/components/loading'
import { Modal } from '@platform/ui/components/modal'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import type { DailyBriefingText } from './dailyBriefingText'

type GenerationDraft = Readonly<{ generationTime: string; windowHours: number }>

/**
 * The generation setting, kept out of the AI settings modal: when the brief runs and how much time it
 * covers are data rules, not a model preference. A save applies to the next edition; editions that
 * already exist keep the window and cutoff they were generated with.
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
  const [failed, setFailed] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const resolveProductText = useProductTextKey()

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
      setZone(settings.view.generation.generationTimeZone ?? null)
      setInvalidZone(settings.view.generation.generationTimeZoneInvalid ?? null)
      setDraft({
        generationTime: settings.view.generation.generationTime,
        windowHours: settings.view.generation.windowHours
      })
    }).catch(() => { if (active) setLoadFailed(true) })
    return () => { active = false }
  }, [open, client])

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    setFailed(false)
    try {
      const result = await client.saveSettings({ generation: draft })
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
    {!draft ? <LoadingState label={text.generationSettings.loading} minHeight={90} /> : <>
      <div className="mi-daily-briefing__settings-row">
        <div>
          <strong>{text.generationSettings.generationTime}</strong>
          <small>{text.generationSettings.generationTimeHint}</small>
        </div>
        <div className="mi-daily-briefing__settings-time">
          <Select
            aria-label={text.generationSettings.generationTime}
            value={draft.generationTime}
            onChange={(generationTime: string) => setDraft((current) => current ? { ...current, generationTime } : current)}
            options={dailyBriefingGenerationTimes.map((value) => ({ value, label: value }))}
            style={{ width: 108 }}
          />
          {/* The time is only half of the setting: 08:05 means 08:05 in this zone, and saying which
              zone is what keeps one day from producing two editions. */}
          {zone ? <span className="mi-daily-briefing__settings-zone" data-time-zone={zone}>{formatShellTimeZoneLabel(zone)}</span> : null}
        </div>
      </div>
      {invalidZone ? <p className="mi-daily-briefing__settings-warning" role="status">{text.generationSettings.invalidTimeZone.replace('{zone}', invalidZone)}</p> : null}
      <div className="mi-daily-briefing__settings-row">
        <div>
          <strong>{text.generationSettings.windowHours}</strong>
          <small>{text.generationSettings.windowHoursHint}</small>
        </div>
        <Select
          aria-label={text.generationSettings.windowHours}
          value={draft.windowHours}
          onChange={(windowHours: number) => setDraft((current) => current ? { ...current, windowHours } : current)}
          options={dailyBriefingGenerationPolicy.windowHoursOptions.map((hours) => ({
            value: hours,
            label: text.generationSettings.windowHoursOption.replace('{hours}', String(hours))
          }))}
          style={{ width: 128 }}
        />
      </div>
      <p className="mi-daily-briefing__settings-note">{text.generationSettings.note}</p>
      {failed || loadFailed ? <p className="mi-daily-briefing__settings-error" role="alert">{text.generationSettings.failed}</p> : null}
    </>}
  </Modal>
}
