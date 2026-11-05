import { Button } from 'antd'

import type { BriefingDeleteOutcome } from './useDailyBriefingIssueDeletion'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * The one-time line a delete leaves behind.
 *
 * A finished delete says which edition went; a half-finished one says how many rows remain ("占 N
 * 条") or that nobody can tell — never a zero nobody measured. The empty pane this note sits above
 * is the ordinary "nothing generated" state, so it stays free of history.
 */
export function DailyBriefingDeleteOutcomeNote({ outcome, text, onRetry }: Readonly<{
  outcome: BriefingDeleteOutcome
  text: DailyBriefingText
  onRetry: (outcome: BriefingDeleteOutcome) => void
}>): React.ReactElement {
  if (outcome.kind === 'nothing') {
    // The reply removed nothing. Reporting the delete anyway is the one thing this line must not do.
    const language = text.history.editionLanguages[outcome.target.locale === 'en-US' ? 'en' : 'zh']
    return <p className="mi-daily-briefing-page__loading-hint" role="alert" data-delete-outcome="nothing">
      {text.history.deleteNothing.replace('{language}', language)}
    </p>
  }
  if (outcome.kind === 'done') {
    // 成功那一句必须点名删的是哪一版：日期 · 时刻 · 语言。只说"已删除"读者不知道自己删掉了什么，
    // 说错一行更糟——他会以为删的是另一版。
    const language = text.history.editionLanguages[outcome.target.locale === 'en-US' ? 'en' : 'zh']
    const named = [outcome.target.date, outcome.target.clock, language]
      .filter((part): part is string => part !== undefined && part !== '').join(' · ')
    return <p className="mi-daily-briefing-page__loading-hint" role="status" data-delete-outcome="done">
      {text.history.deleteDone.replace('{target}', named)}
    </p>
  }
  return <p className="mi-daily-briefing-page__loading-hint" role="alert" data-delete-outcome="partial">
    {outcome.remaining === null
      ? text.history.deleteUnknownRemaining
      : text.history.deletePartial.replace('{count}', String(outcome.remaining))}{' '}
    <Button onClick={() => onRetry(outcome)} type="link">{text.history.deleteRetry}</Button>
  </p>
}
