import { Button } from 'antd'

import type { DailyBriefingText } from './dailyBriefingText'

/**
 * The edition language the reader asked to look at has not been written today.
 *
 * Switching language is a read, so this state exists instead of a run: it says which edition is
 * missing and offers the one control that would produce it. Nothing starts on its own.
 */
export function DailyBriefingLocaleMissing({ locale, currentPeriod = false, historical = false, text, onGenerate }: Readonly<{
  locale: 'zh-CN' | 'en-US'
  /** The issue the reader is living in: the action writes it, so it stays clickable. */
  currentPeriod?: boolean
  /** A past day: the missing edition cannot be written by this version, so no action is offered. */
  historical?: boolean
  text: DailyBriefingText
  onGenerate: () => void
}>): React.ReactElement {
  const languageName = text.languageTabs[locale]
  return <div className="mi-daily-briefing-page__locale-missing" data-briefing-locale-missing={locale}
    {...(historical ? { 'data-locale-missing-historical': 'true' } : {})} role="status">
    <p>{(historical
      ? text.languageTabs.missingHistorical
      : currentPeriod ? text.languageTabs.missingCurrentPeriod : text.languageTabs.missing).replace('{language}', languageName)}</p>
    {historical
      ? <Button className="mi-daily-briefing__generate-missing" disabled
        aria-label={text.history.backfillBlocked} title={text.history.backfillBlocked}>
        {text.history.backfillAction}
      </Button>
      : <Button className="mi-daily-briefing__generate-missing" data-generate-missing-locale={locale} onClick={onGenerate}>
        {text.languageTabs.generateMissing.replace('{language}', languageName)}
      </Button>}
  </div>
}
