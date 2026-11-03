import type { NotificationEventCatalogEntry } from '@platform/notifications/contracts/notificationEventCatalog'
import type { NotificationSubscriptionTable } from '@platform/notifications/contracts/notificationSubscriptions'

/**
 * 订阅清单的**纯模型**：目录 + 订阅表 → 每行每格该长什么样。
 *
 * 为什么独立成文件：这一页最容易画错的地方不是布局，是**每格有几种形态**。
 * 「未批准」画成禁用的勾，会把「这版不会发生」说成「暂时不能」；「固定开启」画成勾，
 * 读者会以为能关。这些判断不写在 JSX 里，才有一条条能断言的形状。
 *
 * 三列三形态，出处是界面规范 §2.2：
 * - 记录列：无条件记录的事件 = 「固定开启」（无控件）；结果类 = 可勾；勾了桌面/通道时
 *   派生显示「已记录」（不可关，`record ∨ desktop ∨ channel`）。
 * - 桌面列：批准表里有这一档 = 可勾；没有 = 灰色「—」，**不是控件**。
 * - 通道列：**只在通道就绪时存在**（`channelReady`），就绪时批准含 `channel` 的才是勾，
 *   其余行灰色「—」。就绪前整列不出现：一串禁用的勾等于承诺「勾上就能推到手机」。
 */
export type SubscriptionCell =
  /** 记录列 + 无条件记录：没有控件，读屏只念一次「固定开启」。 */
  | { kind: 'fixed' }
  /** 记录列 + 勾了桌面：生效值为真，但**不可关**——关它等于「要收但不要记」。 */
  | { kind: 'recorded-via-delivery'; surfaces: readonly ('desktop' | 'channel')[] }
  | { kind: 'checkbox'; level: 'record' | 'desktop' | 'channel'; checked: boolean; disabled: boolean }
  /** 未批准：灰色「—」+ 读屏原因；不进 Tab，不是禁用控件。 */
  | { kind: 'not-approved' }

export type SubscriptionRow = {
  id: string
  titleKey: string
  productId: string
  record: SubscriptionCell
  desktop: SubscriptionCell
  /** `null` = 通道没就绪，整列不渲染（连「—」都不画）。 */
  channel: SubscriptionCell | null
}

export type SubscriptionMatrixInput = {
  entries: readonly NotificationEventCatalogEntry[]
  subscriptions: NotificationSubscriptionTable
  /** 通道就绪（已接入 + 已选 + 目标已绑定）才出现第三列；由 `channelColumnReady` 算。 */
  channelReady?: boolean
}

function deliverySurfaces(
  subscription: Readonly<{ desktop?: boolean; channel?: boolean }>
): readonly ('desktop' | 'channel')[] {
  const surfaces: Array<'desktop' | 'channel'> = []
  if (subscription.desktop === true) surfaces.push('desktop')
  if (subscription.channel === true) surfaces.push('channel')
  return surfaces
}

function approved(entry: NotificationEventCatalogEntry, level: 'desktop' | 'channel'): boolean {
  return entry.approvedDisruptionLevels.includes(level)
}

export function buildSubscriptionRows(input: SubscriptionMatrixInput): SubscriptionRow[] {
  return input.entries.map((entry) => {
    const subscription = input.subscriptions[entry.id] ?? {}
    // 生效的记录值 = record ∨ desktop ∨ channel：通道也算一条投递档。
    const delivered = subscription.desktop === true || subscription.channel === true

    // 记录列：无条件记录的事件永远进中心，读者能改的只有桌面与手机。
    // 「已记录」要带上**是哪个投递档把它顶起来的**：读者听到的必须是原因，不只一个状态。
    const record: SubscriptionCell = entry.notifyOnlyIfSubscribed
      ? delivered && subscription.record !== true
        ? { kind: 'recorded-via-delivery', surfaces: deliverySurfaces(subscription) }
        : { kind: 'checkbox', level: 'record', checked: subscription.record === true, disabled: false }
      : { kind: 'fixed' }

    const desktop: SubscriptionCell = approved(entry, 'desktop')
      ? // 系统没放行时**不禁用**：选择要留住，放行后生效（规范 §2.2）。
        { kind: 'checkbox', level: 'desktop', checked: subscription.desktop === true, disabled: false }
      : { kind: 'not-approved' }

    const channel: SubscriptionCell | null =
      input.channelReady !== true
        ? null
        : approved(entry, 'channel')
          ? { kind: 'checkbox', level: 'channel', checked: subscription.channel === true, disabled: false }
          : { kind: 'not-approved' }

    return { id: entry.id, titleKey: entry.titleKey, productId: entry.productId, record, desktop, channel }
  })
}

/** 一行是否还有读者能操作的地方：全卡死时不需要描边和悬停。 */
export function rowHasControl(row: SubscriptionRow): boolean {
  return [row.record, row.desktop, row.channel].some(
    (cell) => cell !== null && cell.kind === 'checkbox' && !cell.disabled
  )
}

/** 记录列把「已记录（因勾了桌面/通道）」画出来时，读屏要说出**为什么**。 */
export type RecordedViaDeliveryReason = 'desktop' | 'channel' | 'desktop+channel'

export function recordedViaDeliveryReason(
  entry: NotificationEventCatalogEntry,
  subscriptions: NotificationSubscriptionTable
): RecordedViaDeliveryReason | null {
  const subscription = subscriptions[entry.id] ?? {}
  const desktop = subscription.desktop === true
  const channel = subscription.channel === true
  if (desktop && channel) return 'desktop+channel'
  if (desktop) return 'desktop'
  if (channel) return 'channel'
  return null
}
