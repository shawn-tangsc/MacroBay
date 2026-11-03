import { Tabs } from '@platform/ui/components/tabs'

import { useProductTextKey } from '../../shared/i18n/productTextKey'

/**
 * The edition language switch, in the page header.
 *
 * It belongs to the page, not to the detail column: the column only exists when the issue on screen
 * has an edition, and a day with nothing to read is exactly when the reader wants the other
 * language. Its visibility follows the setting alone, never the current state.
 */
export function DailyBriefingLanguageSwitch({ value, onChange }: Readonly<{
  value: 'zh-CN' | 'en-US'
  onChange: (value: 'zh-CN' | 'en-US') => void
}>): React.ReactElement {
  const resolveProductText = useProductTextKey()
  return <div className="mi-daily-briefing-page__lang-tabs" data-content-language-tabs="true">
    <Tabs
      ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.languageTabs.label"
      items={[{ value: 'zh-CN', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.languageTabs.zh-CN' }, { value: 'en-US', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.languageTabs.en-US' }]}
      onChange={(next) => onChange(next === 'en-US' ? 'en-US' : 'zh-CN')}
      panels={{ 'zh-CN': null, 'en-US': null }}
      resolveText={resolveProductText}
      value={value}
    />
  </div>
}
