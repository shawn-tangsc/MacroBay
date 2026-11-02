import { Drawer } from '@platform/ui/components/drawer'

import { useProductTextKey } from '../../shared/i18n/productTextKey'
import type { BriefingIssueGroup } from './dailyBriefingIssues'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * The details behind one grouped summary row.
 *
 * The rail stays a short list of group summaries; this drawer is the only place the individual
 * facts are listed. The mask, Escape, the focus trap and returning focus to the row that opened it
 * are the shared drawer's, not this file's: it used to hand-roll all four.
 */
export function DailyBriefingIssueDrawer({ group, text, formatTime, onClose }: Readonly<{
  group: BriefingIssueGroup
  text: DailyBriefingText
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  onClose: () => void
}>): React.ReactElement {
  const resolveProductText = useProductTextKey()
  return <Drawer
    className="mi-issue-drawer"
    // The hand-rolled drawer unmounted on close; keeping that means a closed drawer leaves no list
    // behind for anything to read.
    destroyOnHidden
    mode="modal"
    onClose={onClose}
    open
    resolveText={resolveProductText}
    size="narrow"
    titleExtra={<span className="mi-issue-drawer__tags">
      <span data-severity={group.severity}>{text.limits.severity[group.severity]}</span>
      <span data-category={group.category}>{text.limits.categories[group.category]}</span>
    </span>}
    titleKey="pages.intelligence.portal.dashboard.dailyBriefing.limits.drawerTitle"
    titleParams={{ label: group.label, count: String(group.count) }}>
    <ol className="mi-issue-drawer__list" data-issue-drawer="true">
      {group.issues.map((issue) => <li className="mi-issue-drawer__item" key={issue.id} data-issue-detail="true">
        <p className="mi-issue-drawer__title">{issue.title}</p>
        <p className="mi-issue-drawer__meta">
          {text.limits.roles.source}{text.labelSeparator}{issue.source} · {text.limits.roles.time}{text.labelSeparator}{formatTime(issue.at, 'minute')}
        </p>
        <p className="mi-issue-drawer__advice">{text.limits.roles.advice}{text.labelSeparator}{issue.advice}</p>
      </li>)}
    </ol>
  </Drawer>
}
