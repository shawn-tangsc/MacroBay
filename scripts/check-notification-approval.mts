/**
 * 「0 missing」守卫（契约 §7.1b 第 6 条）：批准值搬家之前，先给出一份**可复跑**的覆盖率。
 *
 * 用途：`pnpm -s check:notification-approval`
 *   - 打印一行结论：`declared=… approved=… missing=… orphaned=… requested-not-approved=…`
 *   - 有缺口时逐条点名（`missing <eventId>`），并以非 0 退出。
 *
 * 为什么它是搬迁的前置证据：兜底删了、用例全绿，都不能证明「删之前一条不缺」——只有这份输出能。
 * 读法（b3-2）：三条来源各读**自己那份**批准——平台读 `PLATFORM_NOTIFICATION_APPROVALS`，
 * 产品读自己 manifest 里的 `notificationApproval`；三个数都从这一份 `sources` 算，没有第二个口径。
 * 没有兜底：来源没带 `approval` 就是 `missing`，不再从别处派生（b3-5 已删兜底与派生视图）。
 */
import { execSync } from 'node:child_process'

import { inspectApprovalCoverage, formatApprovalCoverage, formatApprovalGaps } from '../platform/notifications/contracts/notificationApprovalCoverage'
import type { NotificationApprovalGap } from '../platform/notifications/contracts/notificationApprovalCoverage'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '../platform/notifications/contracts/platformNotificationEvents'
import type { NotificationEventDeclarationSource } from '../platform/notifications/contracts/notificationEventCatalog'
import { productManifests } from '../products/generated/productManifests'

const sources: NotificationEventDeclarationSource[] = [
  // 平台自己的事件，批准值读平台自己声明的那份（b3-2）。以前这里读的是那张共享表——
  // 表里同时抄着 10 条产品批准，于是每个产品事件在「平台来源」下都成了孤儿批准（10 条）。
  { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS },
  ...productManifests
    .filter((manifest) => (manifest.notificationEvents?.length ?? 0) > 0)
    .map((manifest): NotificationEventDeclarationSource => ({
      productId: manifest.id,
      events: manifest.notificationEvents ?? [],
      // 批准值随声明走（契约 §7.1b）：产品自己声明，检查脚本也按同一处读。
      ...(manifest.notificationApproval === undefined ? {} : { approval: manifest.notificationApproval })
    }))
]

/**
 * **数从哪来**要写在数旁边（Chief 2026-11-08）：工作区跑出的 `missing=0` 与已提交树上跑出的
 * `missing=0` 是两件事——前者可能只是别人还没提交的好意。所以先打 `head` 与 `dirty`，
 * 与 `verify:preflight` 同一个形状：**只有 `dirty=0` 的那一行才可以当作搬迁证据。**
 */
function provenance(): string {
  try {
    const head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length
    return `head=${head} dirty=${dirty}`
  } catch {
    return 'head=unknown dirty=unknown'
  }
}

const coverage = inspectApprovalCoverage(sources)
// 三类缺口都拦：缺一行、多一行、申请超出批准，都是同一批写错。
const blocking: readonly NotificationApprovalGap[] = coverage.gaps

console.log(provenance())
console.log(formatApprovalCoverage(coverage))
for (const line of formatApprovalGaps(coverage)) console.log(`  ${line}`)

if (blocking.length > 0) {
  console.error(`\n[check:notification-approval] ${blocking.length} 处缺口：批准值没搬齐之前不许删平台兜底。`)
  process.exit(1)
}
console.log('\n[check:notification-approval] 0 missing：可以进入搬迁的下一步（改必填 → 删兜底 → 加载断言）。')
