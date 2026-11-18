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
 * 合并后那一行的原因：**有标准行 → `period-unresolved`（码认出来了、缺统计期）；
 * 没有标准行 → `no-standard-row`**。同一事件的两条不许各说一套——所以不取「先到的那条」的原因，
 * 而是按事实重新定。
 */
export function mergedReasonOf(group: readonly UnmappedGroupable[]): string {
  return group.some((row) => row.hasStandardRow) ? 'period-unresolved' : 'no-standard-row'
}

export function groupUnmappedByRelease<T extends UnmappedGroupable>(rows: readonly T[]): readonly (readonly T[])[] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = groupKeyOf(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.values()]
}
