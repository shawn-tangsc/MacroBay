import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import type {
  SyncRunAggregateResult,
  SyncRunAggregateUnavailableReason
} from '../../../contracts/syncRunRecords'
import type { SyncRunText } from './SyncRunSection'

/** 超过 30 天的明细已经折叠，这里只画每日汇总：多少条、失败几条。 */
const SYNC_RUN_AGGREGATE_ROWS = 60

/**
 * 运行记录的「每日汇总」块。
 *
 * 从 `SyncRunSection` 抽出来的唯一理由是把那个文件压到体积门禁以下（500 行），行为一字未改：
 * 三种读不到的原因各画一个面（内存存储没有汇总 / 读失败 / 还没有折叠过），有行就按日期倒序画表。
 */
export function SyncRunAggregates(props: Readonly<{
  aggregates: SyncRunAggregateResult | undefined
  /** 加载态那句读屏名来自外层文案（汇总块自己的文案里没有它）。 */
  loading: string
  onRetry: () => void
  text: SyncRunText['aggregates']
}>): React.ReactElement {
  const { aggregates, text } = props
  return <section className="mi-sync-run__aggregates" aria-label={text.title}>
    <h3>{text.title}</h3>
    <p className="mi-sync-run__aggregate-note">{text.note}</p>
    {!aggregates ? <LoadingState label={props.loading} minHeight={80} /> : null}
    {aggregates?.state === 'unavailable'
      ? (aggregates.reason === 'memory-store-has-no-aggregates'
        ? <StateView reasonCode="capability-not-wired" size="md" state="disabled" />
        : <StateView
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: props.onRetry }}
          reasonCode="unreadable"
          size="md"
          state="error"
        />)
      : null}
    {/* Detail is kept 30 days; a younger install has nothing folded yet, and there is nothing to
        do about that, so no action. */}
    {aggregates?.state === 'available' && aggregates.rows.length === 0
      ? <StateView reasonCode="not-yet" size="md" state="empty" />
      : null}
    {aggregates?.state === 'available' && aggregates.rows.length > 0
      ? <div className="mi-sync-run__aggregate-table" role="table" aria-label={text.title}>
        <div className="mi-sync-run__grid mi-sync-run__grid--aggregate" role="row">
          <span role="columnheader">{text.columns.day}</span>
          <span role="columnheader">{text.columns.task}</span>
          <span role="columnheader">{text.columns.runs}</span>
          <span role="columnheader">{text.columns.failures}</span>
        </div>
        {[...aggregates.rows]
          .sort((left, right) => right.day.localeCompare(left.day) || left.taskLabel.localeCompare(right.taskLabel))
          .slice(0, SYNC_RUN_AGGREGATE_ROWS)
          .map((row) => <div className="mi-sync-run__grid mi-sync-run__grid--aggregate" key={`${row.day}:${row.handlerId}`}>
            <span role="cell">{row.day}</span>
            <span role="cell">{row.taskLabel}</span>
            <span role="cell">{String(row.runs)}</span>
            <span role="cell" data-has-failures={row.failures > 0 ? 'true' : undefined}>{String(row.failures)}</span>
          </div>)}
      </div>
      : null}
  </section>
}

export type { SyncRunAggregateUnavailableReason }
