import { Modal, Select } from 'antd'
import { useEffect, useState } from 'react'

import {
  dailyBriefingGenerationPolicy,
  dailyBriefingGenerationTimes
} from '../../../contracts/dailyBriefing'
import { LoadingState } from '@platform/ui/components/loading'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
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
  const [failed, setFailed] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

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
    open={open}
    title={text.generationSettings.title}
    onCancel={onClose}
    onOk={() => void save()}
    okText={saving ? text.generationSettings.saving : text.generationSettings.save}
    cancelText={text.generationSettings.cancel}
    okButtonProps={{ loading: saving, disabled: !draft || loadFailed }}
    zIndex={1500}
  >
    {!draft ? <LoadingState label={text.generationSettings.loading} minHeight={90} /> : <>
      <div className="mi-daily-briefing__settings-row">
        <div>
          <strong>{text.generationSettings.generationTime}</strong>
          <small>{text.generationSettings.generationTimeHint}</small>
        </div>
        <Select
          aria-label={text.generationSettings.generationTime}
          value={draft.generationTime}
          onChange={(generationTime: string) => setDraft((current) => current ? { ...current, generationTime } : current)}
          options={dailyBriefingGenerationTimes.map((value) => ({ value, label: value }))}
          style={{ width: 108 }}
        />
      </div>
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
