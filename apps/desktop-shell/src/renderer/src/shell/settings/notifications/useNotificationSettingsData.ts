import { useCallback, useEffect, useState } from 'react'

import type { NotificationEventCatalogEntry } from '@platform/notifications/contracts/notificationEventCatalog'
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
}

export type NotificationSettingsClient = {
  listEventCatalog?: () => Promise<readonly NotificationEventCatalogEntry[]>
  getSubscriptions?: () => Promise<NotificationSubscriptionTable>
  getDeliverySettings?: () => Promise<{ toastEnabled?: boolean }>
  setSubscription?: (id: string, patch: Record<string, unknown>) => Promise<unknown>
  setToastEnabled?: (enabled: boolean) => Promise<unknown>
  sendTest?: () => Promise<unknown>
}

export type NotificationSettingsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: NotificationSettingsData }

export function useNotificationSettingsData(client: NotificationSettingsClient): {
  state: NotificationSettingsState
  reload: () => void
  setSubscription: (id: string, level: 'record' | NotificationSubscriptionLevel, next: boolean) => Promise<void>
  setToast: (next: boolean) => Promise<void>
} {
  const [state, setState] = useState<NotificationSettingsState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    const read = (): void => {
      // 四份事实一起读；**任何一份失败都整屏算「没读出来」**——半屏数据会让人把「没读到」
      // 当成「本来就没有」，而这个屏幕上「没有」是一个必须被相信的结论。
      type DeliveryShape = { toastEnabled?: boolean }
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
              toastEnabled: delivery.toastEnabled === true
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
    async (id: string, level: 'record' | NotificationSubscriptionLevel, next: boolean) => {
      await client.setSubscription?.(id, { [level]: next })
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
    },
    [client]
  )

  const setToast = useCallback(
    async (next: boolean) => {
      await client.setToastEnabled?.(next)
      setState((current) =>
        current.status === 'ready' ? { status: 'ready', data: { ...current.data, toastEnabled: next } } : current
      )
    },
    [client]
  )

  return { state, reload, setSubscription, setToast }
}
