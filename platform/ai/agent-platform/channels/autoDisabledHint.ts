/**
 * 「这条通道曾被『只允许一条』规则自动停用」的**只读判据**（原型 2026-11-13）。
 *
 * 两个条件**都**成立才显示：
 * 1. 审计里有这条通道被规则自动停用的记录（`autoDisabledAt` 非空）；
 * 2. 那条审计**之后**它没有再被启用过（`lastEnabledAt` 为空，或早于那次自动停用）。
 *
 * 这是提示、不是自愈：纯函数只回答「该不该显示」，不读库、不改状态、不写审计。
 * 没证据就整行什么都不渲染——「不知道」不许编成「没有」。
 */
export type AutoDisabledEvidence = {
  /** 被规则自动停用的时刻（ISO）；没有就是没有。 */
  autoDisabledAt: string | null
  /** 最近一次**成功**启用的时刻（ISO）：失败过的不算「重新启用过」。 */
  lastEnabledAt: string | null
}

export function shouldShowAutoDisabledHint(evidence: AutoDisabledEvidence | undefined): boolean {
  if (evidence === undefined || evidence.autoDisabledAt === null) return false
  if (evidence.lastEnabledAt === null) return true
  // 之后重新启用过 → 不提示（那是读者自己已经处理过的事）。
  // 同一时刻视为「之后」：宁可少提示，也不在读者刚启用完时又催他一次。
  return evidence.lastEnabledAt < evidence.autoDisabledAt
}
