import { Button } from 'antd'
import { CircleHelp } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Modal } from '@platform/ui/components/modal'
import { Popover } from '@platform/ui/components/popover'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import {
  DailyBriefingGenerationSettingsSection,
  useDailyBriefingGenerationSettings
} from './DailyBriefingGenerationSettingsSection'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * The generation settings dialog: a thin shell around the generation section.
 *
 * The content (its state, its fields, its reading states) lives in
 * `DailyBriefingGenerationSettingsSection`, so the settings drawer embeds the same block instead of
 * copying it. This file owns only the dialog — title, the form-wide note, and the one 取消/保存 pair.
 */
export function DailyBriefingGenerationSettingsModal({ open, text, client, onClose }: Readonly<{
  open: boolean
  text: DailyBriefingText
  client: Pick<DailyBriefingClient, 'getSettings' | 'saveSettings'>
  onClose: () => void
}>): React.ReactElement {
  const section = useDailyBriefingGenerationSettings({ client })
  const resolveProductText = useProductTextKey()

  const save = async (): Promise<void> => {
    if (await section.save()) onClose()
  }

  return <Modal
    footer={<>
      <Button onClick={onClose}>{text.generationSettings.cancel}</Button>
      <Button disabled={!section.draft || section.state === 'load-failed'} loading={section.saving} onClick={() => void save()} type="primary">
        {section.saving ? text.generationSettings.saving : text.generationSettings.save}
      </Button>
    </>}
    layer="over-drawer"
    onClose={onClose}
    open={open}
    resolveText={resolveProductText}
    titleKey="pages.intelligence.portal.dashboard.dailyBriefing.generationSettings.title"
    width="standard"
  >
    {/* The "applies from the next brief" sentence explains the whole form's save, not one group: it
        belongs next to the title, above the fields. */}
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
    <DailyBriefingGenerationSettingsSection
      displayZone={section.displayZone}
      draft={section.draft}
      invalidZone={section.invalidZone}
      periodCount={section.periodCount}
      plan={section.plan}
      reload={section.reload}
      state={section.state}
      text={text}
      update={section.update}
      zone={section.zone}
    />
  </Modal>
}
