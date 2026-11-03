import { Button } from 'antd'
import { CircleHelp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Drawer } from '@platform/ui/components/drawer'
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { DailyBriefingAiSettingsSection, useDailyBriefingAiSettings } from './DailyBriefingAiSettingsSection'
import { DailyBriefingGenerationSettingsSection, useDailyBriefingGenerationSettings } from './DailyBriefingGenerationSettingsSection'
import type { DailyBriefingText } from './dailyBriefingText'

import './dailyBriefingSettingsDrawer.css'

/** Which block the drawer opens on; the header entry starts at the top, the banners aim at AI editing. */
export type BriefingSettingsSection = 'generation' | 'ai'

const SECTION_IDS = {
  generation: 'mi-briefing-settings-generation',
  ai: 'mi-briefing-settings-ai',
  platform: 'mi-briefing-settings-platform'
} as const

/**
 * The one settings surface for the brief: a right-hand drawer over the page, with the generation
 * block above the AI-editing block.
 *
 * The blocks are content only and each keeps its own read/write; this drawer owns what they must not
 * duplicate — one title, one cancel/save pair for both, and one line saying where the two platform
 * settings live. A save that fails names the block that failed instead of a bare "save failed": the
 * reader is looking at two forms and would otherwise not know which one to fix.
 */
export function DailyBriefingSettingsDrawer({ open, section, text, client, onClose, onOpenModelSettings, onConfigureWebSearch }: Readonly<{
  open: boolean
  /** The block to scroll to when the drawer opens. */
  section: BriefingSettingsSection
  text: DailyBriefingText
  client: Pick<DailyBriefingClient, 'getSettings' | 'saveSettings'>
  onClose: () => void
  onOpenModelSettings: () => void
  onConfigureWebSearch: () => void
}>): React.ReactElement {
  const resolveProductText = useProductTextKey()
  const generation = useDailyBriefingGenerationSettings({ client, enabled: open })
  const ai = useDailyBriefingAiSettings({ client, enabled: open })
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<readonly BriefingSettingsSection[]>([])
  const aiSection = useRef<HTMLElement>(null)

  useEffect(() => {
    if (open) return
    setSaving(false)
    setFailed([])
  }, [open])

  // The AI-editing blocks are opened from the page's own warnings; landing at the top of a drawer
  // would make the reader scroll to find the thing they just clicked.
  useEffect(() => {
    if (!open || section !== 'ai') return
    const handle = window.setTimeout(() => aiSection.current?.scrollIntoView({ block: 'start' }), 0)
    return () => window.clearTimeout(handle)
  }, [open, section])

  const ready: readonly BriefingSettingsSection[] = [
    ...(generation.state === 'ready' ? (['generation'] as const) : []),
    ...(ai.state === 'ready' ? (['ai'] as const) : [])
  ]
  const canSave = ready.length > 0 && !saving

  const saveAll = async (): Promise<void> => {
    setSaving(true)
    setFailed([])
    // Sequential, not parallel: both blocks write the same settings record, and two concurrent
    // partial writes can clobber each other on a last-write-wins store.
    const rejected: BriefingSettingsSection[] = []
    if (ready.includes('generation') && !await generation.save()) rejected.push('generation')
    if (ready.includes('ai') && !await ai.save()) rejected.push('ai')
    setSaving(false)
    if (rejected.length > 0) {
      setFailed(rejected)
      return
    }
    // A block that failed to read is not a block that failed to save: it never entered this save.
    onClose()
  }

  const failedSentence = failed.length === 0
    ? null
    : text.settingsDrawer.saveFailed.replace('{sections}', failed.map((key) => text.settingsDrawer.sectionFailed[key]).join('、'))

  return <Drawer
    className="mi-briefing-settings"
    destroyOnHidden
    footer={<div className="mi-briefing-settings__footer">
      {failedSentence ? <p className="mi-briefing-settings__footer-failed" data-settings-save-failed="true" role="alert">{failedSentence}</p> : null}
      <div className="mi-briefing-settings__footer-actions">
        <Button onClick={onClose}>{text.generationSettings.cancel}</Button>
        <Button disabled={!canSave} loading={saving} onClick={() => void saveAll()} type="primary" data-settings-save="true">
          {saving ? text.generationSettings.saving : text.generationSettings.save}
        </Button>
      </div>
    </div>}
    mode="modal"
    onClose={onClose}
    open={open}
    resolveText={resolveProductText}
    size="narrow"
    titleKey="pages.intelligence.portal.dashboard.dailyBriefing.settingsDrawer.title">
    <section className="mi-briefing-settings__section" data-settings-section="generation" aria-labelledby={SECTION_IDS.generation}>
      <h3 className="mi-briefing-settings__heading" id={SECTION_IDS.generation}>{text.settingsDrawer.sections.generation}</h3>
      <DailyBriefingGenerationSettingsSection {...generation} text={text} />
    </section>
    <section className="mi-briefing-settings__section" data-settings-section="ai" ref={aiSection} aria-labelledby={SECTION_IDS.ai}>
      <h3 className="mi-briefing-settings__heading" id={SECTION_IDS.ai}>{text.settingsDrawer.sections.ai}</h3>
      <DailyBriefingAiSettingsSection {...ai} text={text} />
    </section>
    {/* The two platform-wide settings stay outside this drawer's editing surface: a second editable
        copy here would let the reader change a value this page does not own. The sentence explaining
        what belongs to the platform is a permanent explanation, so it lives in the question mark;
        the two jumps are actions and stay on the surface. */}
    <section className="mi-briefing-settings__platform" data-settings-platform="true" aria-labelledby={SECTION_IDS.platform}>
      <h3 className="mi-briefing-settings__heading" id={SECTION_IDS.platform}>
        <Popover
          labelKey="pages.intelligence.portal.dashboard.dailyBriefing.settingsDrawer.platformNote"
          resolveText={resolveProductText}
          trigger={(triggerProps) => <IconButton
            {...triggerProps}
            ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.settingsDrawer.platformNote"
            icon={CircleHelp}
            resolveText={resolveProductText}
            size="sm"
            variant="plain"
          />}
        />
        <span>{text.settingsDrawer.platformTitle}</span>
      </h3>
      <span className="mi-briefing-settings__platform-links">
        <Button data-global-link="model-service" onClick={onOpenModelSettings} type="link">{text.settingsDrawer.openModelService}</Button>
        <Button data-global-link="web-search" onClick={onConfigureWebSearch} type="link">{text.settingsDrawer.openWebSearch}</Button>
      </span>
    </section>
  </Drawer>
}
