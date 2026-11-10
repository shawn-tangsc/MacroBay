import { Button } from 'antd'
import { useEffect, useRef } from 'react'

import { useConfirm } from '@platform/ui/components/confirm'
import { Drawer } from '@platform/ui/components/drawer'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { DailyBriefingSettingsBlocks, useDailyBriefingSettingsBlocks, type BriefingSettingsSection } from './DailyBriefingSettingsBlocks'
import type { DailyBriefingText } from './dailyBriefingText'

/** Which block the drawer opens on; the header entry starts at the top, the banners aim at AI editing. */
export type { BriefingSettingsSection }

/**
 * The one settings surface for the brief: a right-hand drawer over the page, with the generation
 * block above the AI-editing block.
 *
 * 内容（两个块 + 平台那行）与读写都在 `DailyBriefingSettingsBlocks`：产品内「配置」抽屉显示的是
 * 同一块实现（用户 2026-11-10：现成的挪进去）。这个文件只管抽屉外壳——一个标题、一对
 * 「取消 / 保存」、以及「有未保存的草稿时关窗要先问一句」。
 *
 * A save that fails names the block that failed instead of a bare "save failed": the reader is
 * looking at two forms and would otherwise not know which one to fix.
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
  const blocks = useDailyBriefingSettingsBlocks({ client, open })
  const aiSection = useRef<HTMLElement | null>(null)
  const confirm = useConfirm()

  // The AI-editing blocks are opened from the page's own warnings; landing at the top of a drawer
  // would make the reader scroll to find the thing they just clicked.
  useEffect(() => {
    if (!open || section !== 'ai') return
    const handle = window.setTimeout(() => aiSection.current?.scrollIntoView({ block: 'start' }), 0)
    return () => window.clearTimeout(handle)
  }, [open, section])

  const requestClose = (): void => {
    if (!blocks.dirty) {
      onClose()
      return
    }
    confirm({
      title: text.settingsDrawer.discardTitle,
      description: text.settingsDrawer.discardBody,
      confirmLabel: text.settingsDrawer.discardConfirm,
      cancelLabel: text.settingsDrawer.discardCancel,
      tone: 'danger',
      onConfirm: onClose
    })
  }

  return <Drawer
    className="mi-briefing-settings"
    destroyOnHidden
    footer={<div className="mi-briefing-settings__footer">
      {blocks.failedSentence ? <p className="mi-briefing-settings__footer-failed" data-settings-save-failed="true" role="alert">{blocks.failedSentence}</p> : null}
      <div className="mi-briefing-settings__footer-actions">
        <Button onClick={requestClose}>{text.generationSettings.cancel}</Button>
        <Button disabled={!blocks.canSave} loading={blocks.saving} onClick={() => void blocks.saveAll(onClose)} type="primary" data-settings-save="true">
          {blocks.saving ? text.generationSettings.saving : text.generationSettings.save}
        </Button>
      </div>
    </div>}
    mode="modal"
    onClose={requestClose}
    open={open}
    resolveText={resolveProductText}
    size="narrow"
    titleKey="pages.intelligence.portal.dashboard.dailyBriefing.settingsDrawer.title">
    <DailyBriefingSettingsBlocks
      ai={blocks.ai}
      aiSection={aiSection}
      onConfigureWebSearch={onConfigureWebSearch}
      onOpenModelSettings={onOpenModelSettings}
      text={text}
    />
  </Drawer>
}
