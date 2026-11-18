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

/**
 * 两个显示值是否算「不一样」：`0.7` 与 `0.7%`、`1,234` 与 `1234` 是同一个数，不能因为写法不同就报不一致。
 *
 * **带量纲后缀的值不比**（`0.0K`、`1.2M`、`3亿`）：我们存的是展示串不是数（#57），
 * 那一刻把 `0.0K` 读成 0 就会把「零」判成「不是零」——`isZeroValue` 那个 bug 就是同一个形状。
 * 比不出来就不比：这一项不进冲突列表，而不是猜一个结论。
 */
const SCALED = /[KkMmBb万亿]$/u
/**
 * **这是一道临时闸门，等 #57 落地就拆，不要再往上叠判断**（Chief 2026-11-17）。
 *
 * 现在值只有展示串，带量纲的（`0.0K`、`1.2M`）判不出数值，所以「比不了就不比」。
 * `34-值存数值与单位-技术方案.md` 落地后，行上会有 `numericValue / unit / numericSource`：
 * 那时把这个函数**改成读数值与单位**（同单位才比、`unknown` 不比），而不是在它外面再加一层 if——
 * 两层判断叠着，下一处改口径时必然只改到一层。
 */
const comparable = (value: string): boolean => {
  const trimmed = value.trim()
  // **存成了 JSON 串**（`{"displayValue":"4.7%"}`，`materialize-mapped-v1` 那 605 行）：不参与比较。
  // 这不是「还原成展示值」——还原只允许在读口做一处，渲染层再兜一次就等于把 bug 藏起来；
  // 这里只是**不比**：两个来源一个写 JSON、一个写 `4.7%`，比出来的「不一致」是假的。
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false
  return !SCALED.test(trimmed) && !/,/u.test(value)
}

function sameShown(left: string, right: string): boolean {
  if (!comparable(left) || !comparable(right)) return true
  const strip = (value: string): string => value.replace(/[%$,\s]/gu, '')
  const a = Number(strip(left))
  const b = Number(strip(right))
  if (Number.isFinite(a) && Number.isFinite(b)) return a === b
  return left.trim() === right.trim()
}

/**
 * 一行的「统计期」：`2026-09` 与 `2026-10` 是两个月；`2026-11-16T13:30` 这种写法的前 7 位也是
 * `2026-11`。**只有同一个月才算同一期**——跨月比较出来的「不一致」是假的（消费信贷那组就是
 * narwhal 的 9 月对 0xrouter 的 10 月）。
 */
const monthOf = (periodKey: string): string => periodKey.slice(0, 7)

export type SourceWriteRowWithPeriod = EventSourceWriteRow & Readonly<{ periodKey?: string }>

/**
 * 同一期内「两侧都有值、且不相等」的字段——**只并列，不判对错**（#56/#57 未解决前判不了）。
 *
 * **期次缺一不可**：任何一行没有 `periodKey`，这里就一个冲突都不报。宁可这一版不显示标记，
 * 也不能把「9 月的数」和「10 月的数」并排说成「两家不一致」——那等于凭空造一个事实。
 */
export function fieldConflicts(rows: readonly SourceWriteRowWithPeriod[]): readonly Readonly<{
  field: 'consensus' | 'actual' | 'previous'
  values: readonly Readonly<{ providerId: string; value: string }>[]
}>[] {
  if (rows.some((row) => typeof row.periodKey !== 'string' || row.periodKey.trim() === '')) return []
  const byMonth = new Map<string, SourceWriteRowWithPeriod[]>()
  for (const row of rows) {
    const key = monthOf(row.periodKey!)
    byMonth.set(key, [...(byMonth.get(key) ?? []), row])
  }
  const fields = ['consensus', 'actual', 'previous'] as const
  const out: { field: typeof fields[number]; values: { providerId: string; value: string }[] }[] = []
  for (const sameMonth of byMonth.values()) {
    if (new Set(sameMonth.map((row) => row.providerId)).size < 2) continue
    for (const field of fields) {
      const present = sameMonth.flatMap((row) =>
        (row[field] === null ? [] : [{ providerId: row.providerId, value: row[field]! }]))
      if (present.length < 2) continue
      // 有量纲后缀（或千分位）时这条不判：判不了就不判，别拿猜的结论去标「不一致」。
      if (present.some((entry) => !comparable(entry.value))) continue
      if (present.every((entry) => sameShown(entry.value, present[0]!.value))) continue
      out.push({ field, values: present })
    }
  }
  return out
}

/**
 * 同一发布日、但**期次不同**的来源：不并列、不标冲突，只如实说明「另一家记的是哪一期」
 * （界面设计 2026-11-17 的第二种形态）。两条不同期次的发布，各是各的行。
 */
export function otherPeriodRows(rows: readonly SourceWriteRowWithPeriod[]): readonly Readonly<{
  providerId: string; periodKey: string
}>[] {
  const periods = rows.flatMap((row) => (typeof row.periodKey === 'string' && row.periodKey !== ''
    ? [{ providerId: row.providerId, periodKey: row.periodKey }] : []))
  if (periods.length < 2) return []
  const counts = new Map<string, number>()
  for (const entry of periods) counts.set(entry.periodKey, (counts.get(entry.periodKey) ?? 0) + 1)
  const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return periods.filter((entry) => entry.periodKey !== majority)
}

export function EventSourceWritesBlocks({ rows, text }: Readonly<{
  rows: readonly SourceWriteRowWithPeriod[]
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
  const conflicts = fieldConflicts(rows)
  const otherPeriods = otherPeriodRows(rows)
  const fieldLabel: Readonly<Record<string, string>> = {
    consensus: text.market.consensus, actual: text.market.providerActual, previous: text.market.providerPrevious
  }
  const fieldMark: Readonly<Record<string, string>> = {
    consensus: text.details.sourceWritesConsensusConflict,
    actual: text.details.sourceWritesActualConflict,
    previous: text.details.sourceWritesPreviousConflict
  }
  return <section className="mi-source-writes" data-source-writes>
    <h3>{text.details.sourceWritesTitle}</h3>
    {/* 同一发布日、不同期次：**不并列、不标冲突**，只说清另一家记的是哪一期。 */}
    {otherPeriods.length === 0 ? null : <p className="mi-source-writes__other-period" data-other-period>
      {otherPeriods.map((entry) => `${entry.providerId} ${entry.periodKey}`).join(' · ')}
    </p>}
    {/* 不一致的字段**先摆出来**：两块各自的数要并排看才能对照，散在下面容易只看到一家。 */}
    {conflicts.length === 0 ? null : <div className="mi-source-writes__conflicts" data-source-conflicts>
      {conflicts.map(({ field, values }) => <p key={field} data-conflict-field={field} className="mi-source-writes__conflict">
        <span className="mi-source-writes__conflict-label">{fieldLabel[field]}</span>
        {values.map((entry) => <span key={entry.providerId} className="mi-source-writes__conflict-value">
          {entry.providerId} {entry.value}
        </span>)}
        <mark className="mi-source-writes__mark">{fieldMark[field]}</mark>
      </p>)}
    </div>}
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
