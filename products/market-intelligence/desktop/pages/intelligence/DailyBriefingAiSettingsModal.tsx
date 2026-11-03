import { Button } from 'antd'

import { Modal } from '@platform/ui/components/modal'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { openModelSettings } from '../../shared/navigation/productShellNavigation'
import { DailyBriefingAiSettingsSection, useDailyBriefingAiSettings } from './DailyBriefingAiSettingsSection'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * The AI editing dialog: a thin shell around the AI section.
 *
 * The content lives in `DailyBriefingAiSettingsSection` so the settings drawer embeds the same block
 * instead of copying it. This file owns only the dialog — title, the platform-settings link and the
 * one 取消/保存 pair.
 */
export function DailyBriefingAiSettingsModal({ open, text, client, onClose }: Readonly<{
  open: boolean
  text: DailyBriefingText
  client: Pick<DailyBriefingClient, 'getSettings' | 'saveSettings'>
  onClose: () => void
}>): React.ReactElement {
  const section = useDailyBriefingAiSettings({ client })
  const resolveProductText = useProductTextKey()

  const save = async (): Promise<void> => {
    if (await section.save()) onClose()
  }

  return <Modal
    footer={<>
      <Button onClick={onClose}>{text.aiSettings.cancel}</Button>
      <Button disabled={!section.draft || section.state === 'load-failed'} loading={section.saving} onClick={() => void save()} type="primary">
        {section.saving ? text.aiSettings.saving : text.aiSettings.save}
      </Button>
    </>}
    layer="over-drawer"
    onClose={onClose}
    open={open}
    resolveText={resolveProductText}
    titleKey="pages.intelligence.portal.dashboard.dailyBriefing.aiSettings.title"
    width="standard"
  >
    <DailyBriefingAiSettingsSection
      candidates={section.candidates}
      clearWebSearchBlocked={section.clearWebSearchBlocked}
      defaultModel={section.defaultModel}
      draft={section.draft}
      providers={section.providers}
      state={section.state}
      text={text}
      update={section.update}
      webSearchBlocked={section.webSearchBlocked}
      webSearchSupported={section.webSearchSupported}
    />
    <p className="mi-daily-briefing__settings-link">
      <button type="button" onClick={() => { openModelSettings(); onClose() }}>{text.aiSettings.openModelSettings}</button>
    </p>
  </Modal>
}
