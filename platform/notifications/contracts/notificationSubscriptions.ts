/**
 * 订阅表（契约 §5.1）：**一张表、一个真相**。
 *
 * 订阅是「读者要不要这条的桌面 / 通道」，key 是事件 id；提示（toast）**不是订阅列**，
 * 它是全站一个开关（`NotificationRuntimeSettings.toastEnabled`）。
 *
 * 三条硬约束：
 *  - **空表 = 一条都不勾**（裁定 D）：不预置、不从批准表继承。
 *  - **`record` 只存显式勾选，生效值派生**：`record ∨ desktop ∨ channel`。勾了投递档就是
 *    「这条要」，所以界面上的记录格显示「已记录（因勾了桌面 / 通道）」且不可关；全取消后
 *    回到空、可勾，**不留隐藏 true**。
 *  - **本文件不碰文件**：订阅与记录在同一份 JSON 里，runtime 在内存里缓存整份 state 并整份
 *    重写，所以唯一写入口是 runtime 实例上的 `setSubscription`。两个写入方各自整份重写，
 *    最后一个会静默覆盖另一个。
 */
import type { NotificationApprovedLevel } from './notificationEventCatalog'

export type NotificationSubscription = {
  /** 「中心要不要记这条」：只对完成 / 结果类（`notifyOnlyIfSubscribed`）有意义，可勾、默认 false。 */
  record?: boolean
  /** 读者勾了才写；缺字段 = 不勾。 */
  desktop?: boolean
  channel?: boolean
}

export type NotificationSubscriptionTable = Readonly<Record<string, NotificationSubscription>>

/** 订阅的可写表面：桌面与通道。`center` 不是读者能选的列（它由事件类型决定）。 */
export type NotificationSubscriptionLevel = 'desktop' | 'channel'

export type NotificationSubscriptionPatch = {
  record?: boolean
  desktop?: boolean
  channel?: boolean
}

export function emptySubscriptionTable(): NotificationSubscriptionTable {
  return Object.freeze({})
}

/** 生效记录值（派生，不是存储位）：任一投递档被勾时视为 `record = true`。 */
export function deriveRecord(subscription: NotificationSubscription | undefined): boolean {
  if (!subscription) return false
  return subscription.record === true || subscription.desktop === true || subscription.channel === true
}

/**
 * 订阅是否生效 = **批准 ∩ 订阅**（契约 §4）。
 *
 * - `center`：无条件记录的事件恒 true（不查表）；完成 / 结果类看派生的 `record`。
 * - `desktop` / `channel`：该事件没批准这个表面 → 恒 false（批准表是产品签过的上限，不是禁用态）；
 *   批准了也要读者勾了才算。
 *
 * 手机还差第三步「通道已接入且目标唯一」——那一层在投递侧，不在订阅表里（这里不复制通道状态）。
 */
export function isSubscribed(
  entry: { id: string; notifyOnlyIfSubscribed: boolean; approvedDisruptionLevels: readonly NotificationApprovedLevel[] },
  level: 'center' | NotificationSubscriptionLevel,
  table: NotificationSubscriptionTable
): boolean {
  const subscription = table[entry.id]
  if (level === 'center') {
    return entry.notifyOnlyIfSubscribed ? deriveRecord(subscription) : true
  }
  if (!entry.approvedDisruptionLevels.includes(level)) return false
  return subscription?.[level] === true
}

/**
 * 归一化一整张表：只收布尔值、丢掉空行、未知形状一律不猜。
 *
 * 不按目录裁剪——目录是注入的，而这个函数只做形状归一；未登记 id 的写入在
 * `applySubscriptionPatch` 那一层拒绝（契约 §6「未登记即拒」）。
 */
export function normalizeSubscriptionTable(value: unknown): NotificationSubscriptionTable {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptySubscriptionTable()
  const table: Record<string, NotificationSubscription> = {}
  for (const [eventTypeId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (eventTypeId.trim().length === 0 || eventTypeId.length > 200) continue
    const row = normalizeSubscription(raw)
    if (row !== null) table[eventTypeId] = row
  }
  return Object.keys(table).length === 0 ? emptySubscriptionTable() : Object.freeze(table)
}

function normalizeSubscription(value: unknown): NotificationSubscription | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<Record<keyof NotificationSubscription, unknown>>
  const row: NotificationSubscription = {}
  if (typeof candidate.record === 'boolean') row.record = candidate.record
  if (typeof candidate.desktop === 'boolean') row.desktop = candidate.desktop
  if (typeof candidate.channel === 'boolean') row.channel = candidate.channel
  return Object.keys(row).length === 0 ? null : row
}

export type SubscriptionPatchResult =
  | { ok: true; subscription: NotificationSubscription | null }
  | { ok: false; reasonCode: 'unknown-event-type' | 'invalid-patch' }

/**
 * 把一次读者操作落成一行订阅（**纯函数**，不写文件）。
 *
 * 三条判定：
 *  - 未登记 id → `unknown-event-type`（不静默丢弃，也不自动登记）。
 *  - `record` 只对完成 / 结果类有意义；无条件记录的事件传 `record` 一律按「这个表没有这一位」
 *    处理（忽略而不是拒绝——界面本来就不给这个控件，硬拒会把一次无关的界面 bug 变成写失败）。
 *  - 行被全部关掉时**返回 `null`**：退订 = 把该行置空，不是留一个全 false 的行（否则「有没有
 *    订阅过」与「订阅了但都关着」会变成两种形状，下一个人就得判两次）。
 */
export function applySubscriptionPatch(
  entry: { id: string; notifyOnlyIfSubscribed: boolean },
  patch: NotificationSubscriptionPatch,
  current: NotificationSubscription | undefined
): SubscriptionPatchResult {
  if (typeof patch !== 'object' || patch === null) return { ok: false, reasonCode: 'invalid-patch' }
  const next: NotificationSubscription = {}
  const record = entry.notifyOnlyIfSubscribed ? patch.record : undefined
  const desktop = patch.desktop
  const channel = patch.channel
  if (record !== undefined && typeof record !== 'boolean') return { ok: false, reasonCode: 'invalid-patch' }
  if (desktop !== undefined && typeof desktop !== 'boolean') return { ok: false, reasonCode: 'invalid-patch' }
  if (channel !== undefined && typeof channel !== 'boolean') return { ok: false, reasonCode: 'invalid-patch' }

  const merged = { ...(current ?? {}) }
  if (record !== undefined) {
    if (record) merged.record = true
    else delete merged.record
  }
  if (desktop !== undefined) {
    if (desktop) merged.desktop = true
    else delete merged.desktop
  }
  if (channel !== undefined) {
    if (channel) merged.channel = true
    else delete merged.channel
  }
  return { ok: true, subscription: Object.keys(merged).length === 0 ? null : merged }
}
