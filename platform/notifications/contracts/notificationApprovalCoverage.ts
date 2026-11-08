import type { NotificationEventPolicyEntry } from './notificationEventCatalog'
import type { NotificationEventDeclarationSource } from './notificationEventCatalog'

/**
 * 「0 missing」守卫（契约 §7.1b 第 6 条，Chief 2026-11-08 定）：**每条声明都必须在自己那份来源里
 * 带着批准值**，一处不齐就报数并点名。
 *
 * 为什么要有它：批准值从平台表搬进产品 manifest 的 `approval` 段，搬迁那一刻最容易出的事是
 * 「兜底删了、用例全绿、但有一条没迁」——那时一切看起来都对，直到某个产品事件永远不响。
 * 所以搬迁之前必须先有一份**可复跑的覆盖报告**：`0 missing` 才允许删兜底。
 *
 * 三个判据（都能红）：
 *  1. **缺批准**（`missing`）：声明了、来源里没有批准 → 一个都不许有；
 *  2. **孤儿批准**（`orphaned`）：写了批准、没有对应声明 → 死配置，同样不许有；
 *  3. **申请超出批准**：产品申请 `channel`、批准段只给本机三档 → 也要点名（迁移中最常见的抄错）。
 *
 * 只读：不碰文件、不构造目录、不认识任何产品——产品身份只从 `productId` 前缀读。
 */
export type NotificationApprovalGap =
  | { kind: 'missing'; productId: string; eventId: string }
  | { kind: 'orphaned'; productId: string; eventId: string }
  | { kind: 'requested-not-approved'; productId: string; eventId: string; level: string }

export type NotificationApprovalCoverage = {
  declared: number
  approved: number
  gaps: readonly NotificationApprovalGap[]
}

/**
 * 算覆盖。`approval` 是**唯一**批准来源（批准随声明走，缺一行只可能是写错）；
 * 来源没带 `approval` 时，它下面的每条声明都会被报成 `missing` —— 这正是我们要看到的数字。
 */
export function inspectApprovalCoverage(
  sources: readonly NotificationEventDeclarationSource[]
): NotificationApprovalCoverage {
  const declaredIds = new Set<string>()
  const gaps: NotificationApprovalGap[] = []
  let declared = 0
  let approved = 0

  for (const source of sources) {
    const approval: Readonly<Record<string, NotificationEventPolicyEntry>> = source.approval ?? {}
    for (const declaration of source.events) {
      declared += 1
      declaredIds.add(declaration.id)
      const entry = approval[declaration.id]
      if (entry === undefined) {
        gaps.push({ kind: 'missing', productId: source.productId, eventId: declaration.id })
        continue
      }
      approved += 1
      for (const level of declaration.requestedDisruptionLevels) {
        // `channel` 也不例外：搬进 manifest 之后「没批就不许申请」，不再有「没批按未批准处理」的宽容位。
        if (!entry.approvedDisruptionLevels.includes(level)) {
          gaps.push({ kind: 'requested-not-approved', productId: source.productId, eventId: declaration.id, level })
        }
      }
    }
    for (const eventId of Object.keys(approval)) {
      if (!source.events.some((declaration) => declaration.id === eventId)) {
        gaps.push({ kind: 'orphaned', productId: source.productId, eventId })
      }
    }
  }

  return { declared, approved, gaps }
}

/** 一行能贴进提交说明的结论：`declared=17 approved=17 missing=0 orphaned=0`。 */
/** 结构化计数：用例断结构，不断一整行文本（加一列不该把守卫改弱）。 */
export type NotificationApprovalCounts = Readonly<{
  declared: number
  approved: number
  missing: number
  /**
   * **待批**：声明在、批准条目缺。今天与 `missing` 是同一批 id（还没人签），语义不同——
   * 它是一条**合法状态**（产品还没签），不是写错；等 `pending` 允许存在时，两者才会分开。
   */
  pending: number
  orphaned: number
  requestedNotApproved: number
}>

export function approvalCoverageCounts(coverage: NotificationApprovalCoverage): NotificationApprovalCounts {
  const count = (kind: NotificationApprovalGap['kind']): number =>
    coverage.gaps.filter((gap) => gap.kind === kind).length
  return {
    declared: coverage.declared,
    approved: coverage.approved,
    missing: count('missing'),
    pending: count('missing'),
    orphaned: count('orphaned'),
    requestedNotApproved: count('requested-not-approved')
  }
}

export function formatApprovalCoverage(coverage: NotificationApprovalCoverage): string {
  const counts = approvalCoverageCounts(coverage)
  return [
    `declared=${counts.declared}`,
    `approved=${counts.approved}`,
    `missing=${counts.missing}`,
    `pending=${counts.pending}`,
    `orphaned=${counts.orphaned}`,
    `requested-not-approved=${counts.requestedNotApproved}`
  ].join(' ')
}

/** 逐条点名（给脚本打印用）：`missing <eventTypeId>`。 */
export function formatApprovalGaps(coverage: NotificationApprovalCoverage): string[] {
  return coverage.gaps.map((gap) => gap.kind === 'requested-not-approved'
    ? `${gap.kind} ${gap.eventId} level=${gap.level}`
    : `${gap.kind} ${gap.eventId}`)
}
