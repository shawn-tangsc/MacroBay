import { CircleHelp } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import { useProductTextKey } from '../../shared/i18n/productTextKey'
import './dailyBriefingSettingsForm.css'
import type { DailyBriefingText } from './dailyBriefingText'
import { BriefingPeriodsPanel } from './BriefingPeriodsPanel'

/**
 * The generation section's content: the reader's period list.
 *
 * The four fields that used to live here — generation time, window, edition language and "also
 * English" — are period properties now, edited one period at a time in the list below. Leaving any
 * of them here would be a second place to set the same thing, and the one that is not stored is the
 * one the reader will believe. The list owns its own reading states and its own writes.
 */
export function DailyBriefingGenerationSettingsSection({ text }: Readonly<{
  text: DailyBriefingText
}>): React.ReactElement {
  const resolveProductText = useProductTextKey()

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
