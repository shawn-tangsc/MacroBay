/**
 * 「同一件事变得更严重」要不要再推一次（契约 v2.45 §16.3.4）。
 *
 * 判据只有一条：**新提交的信号严重度严格高于这条记录已经推送过的最高值**。
 * 它是**状态**，不是「一天一次」这类计数器常量——级数本身已经封了顶（三档 ⇒ 最多三次投递），
 * 再存一个数字，就又多一处迟早对不上。
 *
 * 五条边界都在这里挡住，不让调用方各自记得：
 * - 只对 `condition` 粒度（`occurrence` 是一次一条，没有「累积严重度」）；
 * - 只走自动路径（`deliver: false` 是读者/手动动作，不走这里；`redeliverPush` 是另一条入口）；
 * - 这条记录必须本来就批准走手机（`delivery.push` 存在），否则没有「再推一次」可言；
 * - 比较对象是**信号自身的严重度**，不是 `NotificationSeverity`；
 * - 同级与降级一律不推（`medium → high → medium → high` 只多推一次）。
 */
import { SIGNAL_SEVERITY_RANK } from '../contracts/notificationContracts'
import type {
  NotificationRecord,
  NotificationSignalSeverity,
  NotificationSubmitRequest
} from '../contracts/notificationContracts'
import type { NotificationEventCatalogEntry } from '../contracts/notificationEventCatalog'

export type SeverityUpgradeDecision =
  | { kind: 'upgrade'; severity: NotificationSignalSeverity }
  | {
      kind: 'none'
      why:
        | 'not-condition'
        | 'manual-path'
        | 'no-signal-severity'
        | 'never-approved-for-push'
        | 'not-strictly-higher'
    }

export function decideSeverityUpgrade(input: {
  entry: NotificationEventCatalogEntry
  /** 合并前的那条记录：它的 `delivery.push.highestSeverity` 是基准。 */
  duplicate: NotificationRecord
  request: NotificationSubmitRequest
}): SeverityUpgradeDecision {
  if (input.entry.dedupeUnit !== 'condition') return { kind: 'none', why: 'not-condition' }
  if (input.request.deliver === false) return { kind: 'none', why: 'manual-path' }

  const next = input.request.signalSeverity
  if (next === undefined) return { kind: 'none', why: 'no-signal-severity' }

  const push = input.duplicate.delivery.push
  if (push === undefined) return { kind: 'none', why: 'never-approved-for-push' }

  // 还没有成功推送过任何一档：最低档就是基准。第一次能推上去的那次会把状态建起来。
  const baseline: NotificationSignalSeverity = push.highestSeverity ?? 'low'
  return SIGNAL_SEVERITY_RANK[next] > SIGNAL_SEVERITY_RANK[baseline]
    ? { kind: 'upgrade', severity: next }
    : { kind: 'none', why: 'not-strictly-higher' }
}
