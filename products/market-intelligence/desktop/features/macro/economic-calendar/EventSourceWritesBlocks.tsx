import type { EventSourceWriteRow } from '../../../../service/intelligence/macro-calendar/rendering/marketCalendarEventSourceWritesRead'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import type { EconomicCalendarText } from './economicCalendarText'
import './eventSourceWrites.css'

/**
 * 详情里的「各来源记录」：**一个来源一块，不许拼成一条**（用户 2026-11-17，#47）。
 *
 * 为什么必须分开：同一期里 narwhal 与 0xrouter 各写过自己的数（帝国大厦那期：narwhal 预期 10、
 * 状态待补值；0xrouter 预期 18、实际 7.8、已发布）。拼成一条就得挑一个显示，另一个消失——
 * 读者会以为只有一家在报，或者以为两家说的是一回事。
 *
 * 三条边界：
 * - 每块顶部写清 **来源 · 状态 · 这是写入记录还是当前观测**：市场来源只有「当前观测」，
 *   没有历史；把观测写成「某时写入过」就是给不存在的历史作证；
 * - 没有值的格子写「源未给出」——**不写「没有」**：那是「这家没给」，不是「这件事没有值」；
 * - 状态词取文案表，表里没有的形状退回源原话（原话是数据，不是我们编的句子）。
 */
const STATUS_ALIAS: Readonly<Record<string, string>> = {
  published: 'data-received',
  scheduled: 'upcoming',
  backfilling: 'backfilling',
  missing: 'missing',
  cancelled: 'cancelled'
}

export function EventSourceWritesBlocks({ rows, text }: Readonly<{
  rows: readonly EventSourceWriteRow[]
  text: EconomicCalendarText
}>): React.ReactElement | null {
  const formatTime = useShellTimeFormat()
  if (rows.length === 0) return null
  const providers = [...new Set(rows.map((row) => row.providerId))]
  const statusText = (status: string): string => {
    const key = STATUS_ALIAS[status] ?? status
    return (text.eventStatus as unknown as Readonly<Record<string, string>>)[key] ?? status
  }
  const value = (shown: string | null): string => shown ?? text.details.valueNotProvided
  return <section className="mi-source-writes" data-source-writes>
    <h3>{text.details.sourceWritesTitle}</h3>
    {providers.map((providerId) => {
      const block = rows.filter((row) => row.providerId === providerId)
      const kind = block.some((row) => row.source === 'revision')
        ? text.details.sourceWritesRevision
        : text.details.sourceWritesObservation
      return <div key={providerId} className="mi-source-writes__block" data-source-block={providerId}>
        <p className="mi-source-writes__head">
          <strong>{providerId}</strong>
          <span className="mi-source-writes__meta">{statusText(block[0]!.status)} · {kind}</span>
        </p>
        <ul className="mi-source-writes__rows">
          {block.map((row) => <li key={`${row.providerId}:${row.source}:${row.observedAt}`} data-source-write>
            <span className="mi-source-writes__time">{formatTime(row.observedAt, 'second')}</span>
            <span data-write-consensus>{text.market.consensus} {value(row.consensus)}</span>
            <span data-write-actual>{text.market.providerActual} {value(row.actual)}</span>
            <span data-write-previous>{text.market.providerPrevious} {value(row.previous)}</span>
          </li>)}
        </ul>
      </div>
    })}
  </section>
}
