/**
 * **未映射列表按「一场发布一行」合并的唯一实现**（Chief 2026-11-18：列表、页签计数、导出三处共用）。
 *
 * 源对同一场发布发中英文两条（`locale` 不同），未映射表里也就有两条记录。界面要的是
 * **一件事一行**：名字中英并列、**原因只写一条**。库里不删（那是源的事实），合并只在读。
 *
 * 键：`源内 id + scheduledAt`；`scheduledAt` 为空时退到 `scheduledDate + 标题`（两者的兜底都写在
 * `groupKeyOf` 一处，三个调用方拿到的分组永远一致）。
 */
export type UnmappedGroupable = Readonly<{
  sourceId: string
  scheduledAt?: string
  scheduledDate: string
  title: string
  reason: string
  /** 这一条是否已有标准行：决定合并后写哪个原因（有行 → 缺期次；没行 → 没进标准表）。 */
  hasStandardRow: boolean
}>

export function groupKeyOf(row: UnmappedGroupable): string {
  if (row.scheduledAt !== undefined && row.scheduledAt !== '') return `${row.sourceId}|${row.scheduledAt}`
  return `${row.sourceId}|${row.scheduledDate}|${row.title}`
}

/**
 * 合并后那一行的原因（Chief 2026-11-18 定，按语义分组看，不取「先到那条」）：
 *
 * 1. 组内任意一条是事件 → `unknown-event-type`；
 * 2. 否则**只要有一条在标准表里有行**，这件就已经有行——取**有行那些条里最靠前的阻塞原因**：
 *    `no-code`（缺码要人拍）优先于 `period-unresolved`（缺期次没法修）；
 * 3. 组内**所有条都没有标准行** → `no-standard-row`。
 *
 * 为什么不是「有行就算缺期次」：`no-standard-row` 的定义是「标准表里根本没有这一行」，
 * 中英两条只要落了一条，再报「没进标准表」就是假的；而把 `no-code` 抹成「缺期次」，
 * 会让「要不要建码」那批从筛选项里整批消失（真库 70 条，实测踩过）。
 */
export function mergedReasonOf(group: readonly UnmappedGroupable[]): string {
  if (group.some((row) => row.reason === 'unknown-event-type')) return 'unknown-event-type'
  const withStandardRow = group.filter((row) => row.hasStandardRow)
  if (withStandardRow.length === 0) return 'no-standard-row'
  if (withStandardRow.some((row) => row.reason === 'no-code')) return 'no-code'
  if (withStandardRow.some((row) => row.reason === 'period-unresolved')) return 'period-unresolved'
  return withStandardRow[0]!.reason
}

/**
 * **展示口径统一按「件」**（Chief 2026-11-18）：中英两条是**同一场发布**，不算两件——指标类和事件
 * 都用这一条。真库当前：指标类 **168 件** + 事件 **207 件** = **375 件**；页签计数、列表、导出三处
 * 都取同一个结果，不许一处按行数（事件 236 那种）、一处按件数。
 */
export function groupUnmappedByRelease<T extends UnmappedGroupable>(rows: readonly T[]): readonly (readonly T[])[] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = groupKeyOf(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.values()]
}
