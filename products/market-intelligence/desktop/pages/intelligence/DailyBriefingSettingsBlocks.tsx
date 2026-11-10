import { Button } from 'antd'
import { CircleHelp } from 'lucide-react'
import { useState, type RefObject } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { productText } from '../../shared/i18n/productText'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { DailyBriefingAiSettingsSection, useDailyBriefingAiSettings } from './DailyBriefingAiSettingsSection'
import { DailyBriefingGenerationSettingsSection } from './DailyBriefingGenerationSettingsSection'
import type { DailyBriefingText } from './dailyBriefingText'

import './dailyBriefingSettingsDrawer.css'

/** Which block a save reported as failed. */
export type BriefingSettingsSection = 'generation' | 'ai'

const SECTION_IDS = {
  generation: 'mi-briefing-settings-generation',
  ai: 'mi-briefing-settings-ai',
  platform: 'mi-briefing-settings-platform'
} as const

/**
 * 简报设置那两个块的**读写**：生成块自己读，AI 块由这里的草稿与保存接住。
 *
 * 为什么单独一个 hook：同一块内容有两个外壳——简报页右侧那个抽屉（页脚一对「取消 / 保存」），
 * 和产品内「配置」抽屉里那一屏（自己带一颗保存）。把编排留一份，两个外壳就不可能一套能存、
 * 另一套存了不生效。
 */
export function useDailyBriefingSettingsBlocks({
  client,
  open
}: Readonly<{ client: Pick<DailyBriefingClient, 'getSettings' | 'saveSettings'>; open: boolean }>): Readonly<{
  ai: ReturnType<typeof useDailyBriefingAiSettings>
  saving: boolean
  failed: readonly BriefingSettingsSection[]
  canSave: boolean
  dirty: boolean
  failedSentence: string | null
  saveAll: (onSaved: () => void) => Promise<void>
}> {
  const language = useShellLanguage()
  const text = productTextFor(language)
  const ai = useDailyBriefingAiSettings({ client, enabled: open })
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<readonly BriefingSettingsSection[]>([])

  // A close with unsaved edits is the one path that can destroy work silently. Not gated on `ready`:
  // a section whose save just failed still holds the reader's edits, and that is exactly the moment
  // a close must ask. A `load-failed` section has no draft, so its `dirty` is false on its own.
  const dirty = ai.dirty
  const ready: readonly BriefingSettingsSection[] = ai.state === 'ready' ? ['ai'] : []
  const canSave = ready.length > 0 && !saving
  const failedSentence = failed.length === 0
    ? null
    : text.settingsDrawer.saveFailed.replace('{sections}', failed.map((key) => text.settingsDrawer.sectionFailed[key]).join('、'))

  /** 两块写同一条设置记录，所以顺序写：并发两次半写会在最后写赢的存储上互相覆盖。 */
  const saveAll = async (onSaved: () => void): Promise<void> => {
    setSaving(true)
    setFailed([])
    const rejected: BriefingSettingsSection[] = []
    if (ready.includes('ai') && !await ai.save()) rejected.push('ai')
    setSaving(false)
    if (rejected.length > 0) {
      setFailed(rejected)
      return
    }
    // A block that failed to read is not a block that failed to save: it never entered this save.
    onSaved()
  }

  return { ai, saving, failed, canSave, dirty, failedSentence, saveAll }
}

/** 文案表按语言取一次；两个外壳不各拼一份。 */
function productTextFor(language: 'zh-CN' | 'en-US'): DailyBriefingText {
  return productText[language].pages.intelligence.portal.dashboard.dailyBriefing
}

/**
 * 两个块 + 平台那行的**内容**：没有标题栏、没有页脚、没有外边距——外壳给什么它画什么。
 *
 * 内容与设置页「通知」「来源」那两屏同一路：搬的是同一块实现，不是照着画一遍。
 */
export function DailyBriefingSettingsBlocks({
  ai,
  text,
  onOpenModelSettings,
  onConfigureWebSearch,
  aiSection
}: Readonly<{
  ai: ReturnType<typeof useDailyBriefingAiSettings>
  text: DailyBriefingText
  onOpenModelSettings: () => void
  onConfigureWebSearch: () => void
  aiSection?: RefObject<HTMLElement | null>
}>): React.ReactElement {
  const resolveProductText = useProductTextKey()
  return <>
    <section className="mi-briefing-settings__section" data-settings-section="generation" aria-labelledby={SECTION_IDS.generation}>
      {/* The block owns the fields; adding a period is a group-level action, so it sits on this
          group's heading row, right-aligned with the value column. */}
      <div className="mi-briefing-settings__group-head">
        <h3 className="mi-briefing-settings__heading" id={SECTION_IDS.generation}>{text.settingsDrawer.sections.generation}</h3>
      </div>
      <DailyBriefingGenerationSettingsSection text={text} />
    </section>
    <section className="mi-briefing-settings__section" data-settings-section="ai" ref={aiSection} aria-labelledby={SECTION_IDS.ai}>
      <h3 className="mi-briefing-settings__heading" id={SECTION_IDS.ai}>{text.settingsDrawer.sections.ai}</h3>
      <DailyBriefingAiSettingsSection {...ai} text={text} />
    </section>
    {/* The two platform-wide settings stay outside this editing surface: a second editable copy here
        would let the reader change a value this page does not own. The sentence explaining what
        belongs to the platform is a permanent explanation, so it lives in the question mark;
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
  </>
}

/** 两个外壳共用的「保存」用语（同一句话，不在两处各写一份）。 */
export function useBriefingSettingsSaveLabel(): Readonly<{ save: string; saving: string; cancel: string }> {
  const text = productTextFor(useShellLanguage())
  return { save: text.generationSettings.save, saving: text.generationSettings.saving, cancel: text.generationSettings.cancel }
}
