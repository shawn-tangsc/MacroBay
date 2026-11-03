import { Button } from 'antd'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'
import type { DailyBriefingText } from './dailyBriefingText'
import type { BriefingIssue, BriefingIssueGroup } from './dailyBriefingIssues'
import type { GenerationTrace } from './dailyBriefingGenerationTrace'
import { DailyBriefingAttempts } from './DailyBriefingAttempts'
import { DailyBriefingGenerationTimeline } from './DailyBriefingGenerationTimeline'
import { DailyBriefingLanguageSwitch } from './DailyBriefingLanguageSwitch'
import { issueCountsText } from './dailyBriefingPageDerived'

/**
 * The right-hand column: the language switch at its top, then the audit of the edition on screen.
 *
 * The column always exists, so the switch can never be taken away with it; the audit blocks below
 * render only when the issue has an edition. Kept out of the page for size and because it is one
 * surface with one job: tell the reader what this edition is missing.
 */
export function DailyBriefingAppendix({ text, view, contentBlocked, hasArchive, issues, issueCounts, groups, generationTrace, formatTime, editionLocale, englishEditionsEnabled, contentLocale, issuesOpen, setIssuesOpen, openGroup, setOpenGroup, listAttempts, onSwitch }: Readonly<{
  text: DailyBriefingText
  view: DailyBriefingPageViewState
  contentBlocked: boolean
  hasArchive: boolean
  issues: readonly BriefingIssue[]
  issueCounts: Readonly<Record<'blocking' | 'warning' | 'info', number>>
  groups: readonly BriefingIssueGroup[]
  generationTrace: GenerationTrace | undefined
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  editionLocale: 'zh-CN' | 'en-US'
  englishEditionsEnabled: boolean
  contentLocale: 'zh-CN' | 'en-US'
  issuesOpen: boolean
  setIssuesOpen: (open: boolean) => void
  openGroup: Readonly<{ key: string; trigger: HTMLElement | null }> | null
  setOpenGroup: (group: Readonly<{ key: string; trigger: HTMLElement | null }> | null) => void
  listAttempts?: DailyBriefingClient['listAttempts']
  onSwitch: (locale: 'zh-CN' | 'en-US') => void
}>): React.ReactElement {
  return <aside className="mi-daily-briefing-page__appendix" data-briefing-detail="true" aria-label={text.sections.limits} {...(hasArchive && issues.length > 0 ? { 'data-briefing-issues': 'true' } : {})}>
        {englishEditionsEnabled ? <DailyBriefingLanguageSwitch value={contentLocale} onChange={onSwitch} /> : null}
        {hasArchive ? <>
        <section data-briefing-gaps="true">
        {issues.length > 0 ? <details className="mi-briefing-gaps" open={issuesOpen}
          onToggle={(event) => setIssuesOpen((event.currentTarget as HTMLDetailsElement).open)}>
          {/* The counts are the verdict, not the detail: they stay on the summary line even closed. */}
          <summary className="mi-briefing-gaps__head">
            <h2>{text.sections.limits}</h2>
            <span className="mi-briefing-gaps__counts">{issueCountsText(issueCounts, text)}</span>
          </summary>
          <ol className="mi-daily-briefing-page__groups">
            {groups.map((group) => <li key={group.key}>
              {/* Three facts on the row: how bad, which kind, how many. The long titles live in the
                  drawer this opens — keeping them here is what made two of them overlap. */}
              <Button className="mi-daily-briefing-page__group" aria-haspopup="dialog"
                aria-label={text.limits.openGroup.replace('{label}', group.label).replace('{count}', String(group.count))}
                data-group-key={group.key} data-group-severity={group.severity} data-group-category={group.category}
                onClick={(event) => setOpenGroup({ key: group.key, trigger: event.currentTarget })}>
                <span data-issue-severity={group.severity} className="mi-daily-briefing-page__group-severity">{text.limits.severity[group.severity]}</span>
                <span data-issue-label={group.label} className="mi-daily-briefing-page__group-label" title={group.label}>{group.label}</span>
                <span data-issue-count={group.count} className="mi-daily-briefing-page__group-count">{text.limits.groupCount.replace('{count}', String(group.count))}</span>
              </Button>
            </li>)}
          </ol>
        </details> : null}</section>
        <div data-briefing-stages="true"><DailyBriefingGenerationTimeline trace={generationTrace} text={text} formatTime={formatTime} /></div>
        {view.status === 'ready' ? <DailyBriefingAttempts date={view.document.edition.date} periodId="default" locale={editionLocale} text={text} loadAttempts={listAttempts ? (date, periodId, language) => listAttempts({ date, locale: language, periodId }) : undefined} /> : null}
        </> : null}
      </aside>

}
