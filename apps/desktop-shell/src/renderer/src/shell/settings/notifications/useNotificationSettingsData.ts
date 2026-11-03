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
  desktopPermission: 'granted' | 'denied' | 'unknown'
}

export type NotificationSettingsClient = {
  listEventCatalog?: () => Promise<readonly NotificationEventCatalogEntry[]>
  getSubscriptions?: () => Promise<NotificationSubscriptionTable>
  getDeliverySettings?: () => Promise<{ toastEnabled?: boolean }>
  setSubscription?: (id: string, patch: Record<string, unknown>) => Promise<unknown>
  setToastEnabled?: (enabled: boolean) => Promise<unknown>
  readDesktopPermission?: () => Promise<'granted' | 'denied' | 'unknown'>
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
  permission: 'granted' | 'denied' | 'unknown'
} {
  const [state, setState] = useState<NotificationSettingsState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)
  const [permission, setPermission] = useState<'granted' | 'denied' | 'unknown'>('unknown')

  useEffect(() => {
    let alive = true
    const read = (): void => {
      // 四份事实一起读；**任何一份失败都整屏算「没读出来」**——半屏数据会让人把「没读到」
      // 当成「本来就没有」，而这个屏幕上「没有」是一个必须被相信的结论。
      type DeliveryShape = { toastEnabled?: boolean }
      const readAll: Promise<
        [
          readonly NotificationEventCatalogEntry[],
          NotificationSubscriptionTable,
          DeliveryShape,
          'granted' | 'denied' | 'unknown'
        ]
      > = Promise.all([
        client.listEventCatalog?.() ?? Promise.resolve([]),
        client.getSubscriptions?.() ?? Promise.resolve({}),
        client.getDeliverySettings?.() ?? Promise.resolve({}),
        client.readDesktopPermission?.() ?? Promise.resolve('unknown' as const)
      ])
      void readAll
        .then(([catalog, subscriptions, delivery, desktopPermission]) => {
          if (!alive) return
          setPermission(desktopPermission)
          setState({
            status: 'ready',
            data: {
              catalog,
              subscriptions,
              toastEnabled: delivery.toastEnabled === true,
              desktopPermission
            }
          })
        })
        .catch(() => {
          if (alive) setState({ status: 'error' })
        })
    }
    read()
    // 读者去系统设置放行再切回来，那行必须跟着变，否则他会以为设置没生效、回去再改一遍。
    const onFocus = (): void => {
      void Promise.resolve(client.readDesktopPermission?.() ?? Promise.resolve('unknown' as const))
        .then((next) => {
          if (alive) setPermission(next)
        })
        .catch(() => undefined)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
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

  return { state, reload, setSubscription, setToast, permission }
}
