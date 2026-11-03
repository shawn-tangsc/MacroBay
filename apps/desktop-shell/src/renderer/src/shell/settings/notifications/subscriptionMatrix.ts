import type { NotificationEventCatalogEntry } from '@platform/notifications/contracts/notificationEventCatalog'
import type { NotificationSubscriptionTable } from '@platform/notifications/contracts/notificationSubscriptions'

/**
 * 订阅清单的**纯模型**：目录 + 订阅表 → 每行每格该长什么样。
 *
 * 为什么独立成文件：这一页最容易画错的地方不是布局，是**每格有几种形态**。
 * 「未批准」画成禁用的勾，会把「这版不会发生」说成「暂时不能」；「固定开启」画成勾，
 * 读者会以为能关。这些判断不写在 JSX 里，才有一条条能断言的形状。
 *
 * 两列三形态，出处是界面规范 §2.2（通道那一列随「发到手机」一起摘掉了）：
 * - 记录列：无条件记录的事件 = 「固定开启」（无控件）；结果类 = 可勾；勾了桌面/通道时
 *   派生显示「已记录」（不可关，`record ∨ desktop ∨ channel`）。
 * - 桌面列：批准表里有这一档 = 可勾；没有 = 灰色「—」，**不是控件**。
 */
export type SubscriptionCell =
  /** 记录列 + 无条件记录：没有控件，读屏只念一次「固定开启」。 */
  | { kind: 'fixed' }
  /** 记录列 + 勾了桌面：生效值为真，但**不可关**——关它等于「要收但不要记」。 */
  | { kind: 'recorded-via-delivery' }
  | { kind: 'checkbox'; level: 'record' | 'desktop'; checked: boolean; disabled: boolean }
  /** 未批准：灰色「—」+ 读屏原因；不进 Tab，不是禁用控件。 */
  | { kind: 'not-approved' }

export type SubscriptionRow = {
  id: string
  titleKey: string
  productId: string
  record: SubscriptionCell
  desktop: SubscriptionCell
}

export type SubscriptionMatrixInput = {
  entries: readonly NotificationEventCatalogEntry[]
  subscriptions: NotificationSubscriptionTable
}

function approved(entry: NotificationEventCatalogEntry, level: 'desktop'): boolean {
  return entry.approvedDisruptionLevels.includes(level)
}

export function buildSubscriptionRows(input: SubscriptionMatrixInput): SubscriptionRow[] {
  return input.entries.map((entry) => {
    const subscription = input.subscriptions[entry.id] ?? {}
    const delivered = subscription.desktop === true

    // 记录列：无条件记录的事件永远进中心，读者能改的只有桌面与手机。
    const record: SubscriptionCell = entry.notifyOnlyIfSubscribed
      ? delivered && subscription.record !== true
        ? { kind: 'recorded-via-delivery' }
        : { kind: 'checkbox', level: 'record', checked: subscription.record === true, disabled: false }
      : { kind: 'fixed' }

    const desktop: SubscriptionCell = approved(entry, 'desktop')
      ? // 系统没放行时**不禁用**：选择要留住，放行后生效（规范 §2.2）。
        { kind: 'checkbox', level: 'desktop', checked: subscription.desktop === true, disabled: false }
      : { kind: 'not-approved' }

    return { id: entry.id, titleKey: entry.titleKey, productId: entry.productId, record, desktop }
  })
}

/** 一行是否还有读者能操作的地方：全卡死时不需要描边和悬停。 */
export function rowHasControl(row: SubscriptionRow): boolean {
  return [row.record, row.desktop].some(
    (cell) => cell.kind === 'checkbox' && !cell.disabled
  )
}

/** 记录列把「已记录（因勾了桌面）」画出来时，读屏要说出**为什么**。 */
export type RecordedViaDeliveryReason = 'desktop'

export function recordedViaDeliveryReason(
  entry: NotificationEventCatalogEntry,
  subscriptions: NotificationSubscriptionTable
): RecordedViaDeliveryReason | null {
  const subscription = subscriptions[entry.id] ?? {}
  return subscription.desktop === true ? 'desktop' : null
}
