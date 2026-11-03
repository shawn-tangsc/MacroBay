import { Button } from 'antd'

import type { DailyBriefingText } from './dailyBriefingText'

/**
 * The edition language the reader asked to look at has not been written today.
 *
 * Switching language is a read, so this state exists instead of a run: it says which edition is
 * missing and offers the one control that would produce it. Nothing starts on its own.
 */
export function DailyBriefingLocaleMissing({ locale, text, onGenerate }: Readonly<{
  locale: 'zh-CN' | 'en-US'
  text: DailyBriefingText
  onGenerate: () => void
}>): React.ReactElement {
  const languageName = text.languageTabs[locale]
  return <div className="mi-daily-briefing-page__locale-missing" data-briefing-locale-missing={locale} role="status">
    <p>{text.languageTabs.missing.replace('{language}', languageName)}</p>
    <Button className="mi-daily-briefing__generate-missing" data-generate-missing-locale={locale} onClick={onGenerate}>
      {text.languageTabs.generateMissing.replace('{language}', languageName)}
    </Button>
  </div>
}
