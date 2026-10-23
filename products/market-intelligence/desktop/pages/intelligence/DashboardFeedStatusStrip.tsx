import { TriangleAlert } from 'lucide-react'

import { dashboardFeedRowText, type DashboardFeedRow, type DashboardFeedText, type DashboardFeedTags } from './dashboardFeedStatusModel'
import { projectDashboardFeedHealth } from './dashboardFeedStatusHealth'

/**
 * 来源状态, 异常优先.
 *
 * Healthy feeds share one ✓ line — the count and their names — with a single 管理来源 link, so a
 * board that is working costs one line instead of one per feed. Every feed that needs a look keeps a
 * line of its own, in the panel's own wording, and each of those carries one 管理 link. The strip
 * therefore shows at most one link per anomaly plus the summary's link.
 */
export function FeedStatusStrip({ rows, text, tags, nowMs, onManageSource }: {
  rows: readonly DashboardFeedRow[]
  text: DashboardFeedText
  tags: DashboardFeedTags
  nowMs: number
  onManageSource: () => void
}): React.ReactElement {
  const health = projectDashboardFeedHealth(rows, text)
  // The strip is one band of its own — the summary line above, the anomalies below — not four cells of
  // the region's three-column grid: a fallback squeezed into a third of the width either drops its
  // reason or wraps into a column beside it, which is the noise the compact strip exists to remove.
  return <div className="mi-crypto-dashboard__feed-strip" data-feed-strip>
    {health.hasSummary && <div className="mi-crypto-dashboard__source-row" data-feed-summary data-state="ok" data-feed-health="healthy">
      <strong className="mi-crypto-dashboard__source-summary-label" data-feed-status="summary">{format(text.summary, { count: String(health.healthyCount), names: health.healthyNames })}</strong>
      <div><button onClick={() => onManageSource()} type="button">{text.manageSources}</button></div>
    </div>}
    {health.attentionRows.map(row => {
      const line = dashboardFeedRowText(row, text, tags, nowMs)
      return <div className="mi-crypto-dashboard__source-row" data-source-id={row.sourceId} data-feed-row={row.id} data-state={row.state} data-feed-health="needs-attention" key={row.id}>
        <strong aria-hidden="true" className="mi-crypto-dashboard__source-anomaly-mark" data-feed-anomaly={row.id}><TriangleAlert size={12} /></strong>
        <span>{line.name}</span>
        <small data-feed-status={row.id}>{line.status}</small>
        <div><button onClick={() => onManageSource()} type="button">{text.manage}</button></div>
      </div>
    })}
  </div>
}

function format(template: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), template)
}
