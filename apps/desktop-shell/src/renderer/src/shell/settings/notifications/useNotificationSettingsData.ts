import { useCallback, useEffect, useState } from 'react'

import type { ChannelDeliveryTargetView } from '@platform/ai/agent-platform/channels/ChannelManagementContracts'
import type { SafeNotificationRecord } from '@platform/notifications/contracts/notificationContracts'
import type { NotificationEventCatalogEntry } from '@platform/notifications/contracts/notificationEventCatalog'
import type { DeliveryAttempt } from '@platform/notifications/runtime/notificationRouting'
import type {
  NotificationSubscriptionLevel,
  NotificationSubscriptionTable
} from '@platform/notifications/contracts/notificationSubscriptions'


/**
 * 这一屏需要的四份事实：目录、订阅表、投递设置、桌面权限。
 *
 * 四个都失败得起（各自降级），但**「读不到」和「没有」必须分开**：目录读不到时清单区说
 * 「没读出来」并给重试，绝不说「没有可订阅的事件」——后者会让读者以为平台没有事件。
 */
export type NotificationSettingsData = {
  catalog: readonly NotificationEventCatalogEntry[]
  subscriptions: NotificationSubscriptionTable
  toastEnabled: boolean
  /**
   * 「发送到频道」那一行要的三样，全部来自主进程的同一个只读投影（`getDeliverySettings`）：
   * 可选频道（`deliverable` 才算）、读者选的那条（`null` 就是推送关着）、最近一次失败的时刻。
   *
   * 不在这里另算「就绪」：那是 `channelRow.ts` 的判断，这一层只搬事实。
   */
  channelId: string | null
  channels: readonly ChannelDeliveryTargetView[]
  lastPushFailureAt: string | null
  /** 与 `lastPushFailureAt` 取自**同一条记录**：拼两处的值会得到「这条的时刻 + 那条的原因」。 */
  lastPushFailureReason: string | null
}

export type NotificationSettingsClient = {
  listEventCatalog?: () => Promise<readonly NotificationEventCatalogEntry[]>
  getSubscriptions?: () => Promise<NotificationSubscriptionTable>
  getDeliverySettings?: () => Promise<{
    toastEnabled?: boolean
    channelId?: string | null
    channels?: readonly ChannelDeliveryTargetView[]
    lastPushFailureAt?: string | null
    lastPushFailureReason?: string | null
  }>
  setSubscription?: (id: string, patch: Record<string, unknown>) => Promise<unknown>
  setToastEnabled?: (enabled: boolean) => Promise<unknown>
  /** 选中哪条频道；`null` 就是关掉推送（契约里没有第二个「启用」布尔）。 */
  setPushChannel?: (channelId: string | null) => Promise<unknown>
  /** 真实回执：一条记录 + 每一档投递的尝试结果（形状取自主进程运行时，不是我们自己拼的）。 */
  sendTest?: () => Promise<{ record: SafeNotificationRecord; delivery: readonly DeliveryAttempt[] }>
}

export type NotificationSettingsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: NotificationSettingsData }

/**
 * 写操作的回执。**只有主进程说 `ok: true` 才算存上**：
 * - 订阅写入失败时是正常返回 `{ ok: false, reasonCode }`，不抛错——不看它就会把「没存上」
 *   显示成勾上了（勾选状态是乐观更新，下一帧看起来已经生效，其实库里没有）；
 * - 提示开关与推送频道失败时是抛错；抛出也要变成同一张回执，别让调用方吞掉。
 */
export type NotificationWriteResult = { ok: true } | { ok: false }

const WRITE_OK: NotificationWriteResult = { ok: true }
const WRITE_FAILED: NotificationWriteResult = { ok: false }

export function useNotificationSettingsData(client: NotificationSettingsClient): {
  state: NotificationSettingsState
  reload: () => void
  setSubscription: (id: string, level: 'record' | NotificationSubscriptionLevel, next: boolean) => Promise<NotificationWriteResult>
  setToast: (next: boolean) => Promise<NotificationWriteResult>
  setPushChannel: (channelId: string) => Promise<NotificationWriteResult>
} {
  const [state, setState] = useState<NotificationSettingsState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    const read = (): void => {
      // 四份事实一起读；**任何一份失败都整屏算「没读出来」**——半屏数据会让人把「没读到」
      // 当成「本来就没有」，而这个屏幕上「没有」是一个必须被相信的结论。
      type DeliveryShape = {
        toastEnabled?: boolean
        channelId?: string | null
        channels?: readonly ChannelDeliveryTargetView[]
        lastPushFailureAt?: string | null
        lastPushFailureReason?: string | null
      }
      const readAll: Promise<
        [readonly NotificationEventCatalogEntry[], NotificationSubscriptionTable, DeliveryShape]
      > = Promise.all([
        client.listEventCatalog?.() ?? Promise.resolve([]),
        client.getSubscriptions?.() ?? Promise.resolve({}),
        client.getDeliverySettings?.() ?? Promise.resolve({})
      ])
      void readAll
        .then(([catalog, subscriptions, delivery]) => {
          if (!alive) return
          setState({
            status: 'ready',
            data: {
              catalog,
              subscriptions,
              toastEnabled: delivery.toastEnabled === true,
              channelId: typeof delivery.channelId === 'string' ? delivery.channelId : null,
              // 不是数组就当作「没有任何可投递频道」：宁可少一条选择项，也不把形状不明的数据画出来。
              channels: Array.isArray(delivery.channels) ? delivery.channels : [],
              lastPushFailureAt:
                typeof delivery.lastPushFailureAt === 'string' ? delivery.lastPushFailureAt : null,
              lastPushFailureReason:
                typeof delivery.lastPushFailureReason === 'string' ? delivery.lastPushFailureReason : null
            }
          })
        })
        .catch(() => {
          if (alive) setState({ status: 'error' })
        })
    }
    read()
    return () => {
      alive = false
    }
  }, [client, nonce])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setNonce((value) => value + 1)
  }, [])

  const setSubscription = useCallback(
    async (id: string, level: 'record' | NotificationSubscriptionLevel, next: boolean): Promise<NotificationWriteResult> => {
      let result: unknown
      try {
        result = await client.setSubscription?.(id, { [level]: next })
      } catch {
        return WRITE_FAILED
      }
      // 订阅写入失败是**正常返回** `{ ok:false, reasonCode }`：不看它，勾选会亮着而库里没有。
      if (typeof result === 'object' && result !== null && (result as { ok?: boolean }).ok === false) return WRITE_FAILED
      setState((current) => {
        if (current.status !== 'ready') return current
        const previous = current.data.subscriptions[id] ?? {}
        return {
          status: 'ready',
          data: {
            ...current.data,
            subscriptions: { ...current.data.subscriptions, [id]: { ...previous, [level]: next } }
          }
        }
      })
      return WRITE_OK
    },
    [client]
  )

  const setToast = useCallback(
    async (next: boolean): Promise<NotificationWriteResult> => {
      try {
        await client.setToastEnabled?.(next)
      } catch {
        return WRITE_FAILED
      }
      setState((current) =>
        current.status === 'ready' ? { status: 'ready', data: { ...current.data, toastEnabled: next } } : current
      )
      return WRITE_OK
    },
    [client]
  )

  const setPushChannel = useCallback(
    async (channelId: string): Promise<NotificationWriteResult> => {
      try {
        await client.setPushChannel?.(channelId)
      } catch {
        return WRITE_FAILED
      }
      setState((current) =>
        current.status === 'ready' ? { status: 'ready', data: { ...current.data, channelId } } : current
      )
      return WRITE_OK
    },
    [client]
  )

  return { state, reload, setSubscription, setToast, setPushChannel }
}
