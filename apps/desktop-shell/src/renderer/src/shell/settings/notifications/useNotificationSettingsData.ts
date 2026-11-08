import { useCallback, useEffect, useState } from 'react'

import type {
  LinkSelfTestKind,
  TestNoticeReceipt
} from '@platform/notifications/contracts/notificationSelfTest'

/**
 * 这一屏要的两份事实：应用内提示开关、桌面提醒开关（`getDeliverySettings` 一次读回）。
 * 读不到就是 `error`——**不许把「读不到」画成「两个都关着」**，那是拿默认值冒充现状。
 */
export type NotificationSettingsData = {
  toastEnabled: boolean
  desktopEnabled: boolean
}

export type NotificationSettingsClient = {
  getDeliverySettings?: () => Promise<{ toastEnabled?: boolean; desktopEnabled?: boolean }>
  setToastEnabled?: (enabled: boolean) => Promise<unknown>
  setDesktopEnabled?: (enabled: boolean) => Promise<unknown>
  /**
   * 真实回执：三档（`sent` / `no-data` / `unavailable`）+ 闭集码。**形状取自主进程契约**，
   * 这里只引用、不重写——旧的 `{ record, delivery }` 已随 preload 换成 `TestNoticeReceipt`。
   */
  sendTest?: (input: { kind: LinkSelfTestKind }) => Promise<TestNoticeReceipt>
}

export type NotificationSettingsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: NotificationSettingsData }

/**
 * 写操作的回执。
 *
 * **只有主进程没抛错才算存上**：开关是乐观更新的话，失败时它会自己亮起来、库里却没变，
 * 读者下一次打开又弹回去。所以调用方必须等这个回执、失败时把开关留在原位并说明没存上。
 * 方法缺失（旧构建 / preload 没接）同样按失败算，不许静默当成成功。
 */
export type NotificationWriteResult = { ok: true } | { ok: false }

const WRITE_OK: NotificationWriteResult = { ok: true }
const WRITE_FAILED: NotificationWriteResult = { ok: false }

export function useNotificationSettingsData(client: NotificationSettingsClient): {
  state: NotificationSettingsState
  reload: () => void
  setToast: (next: boolean) => Promise<NotificationWriteResult>
  setDesktop: (next: boolean) => Promise<NotificationWriteResult>
} {
  const [state, setState] = useState<NotificationSettingsState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    const read = async (): Promise<void> => {
      try {
        const settings = await client.getDeliverySettings?.()
        if (!alive) return
        if (settings === undefined) {
          // 桥缺失与「读到了、都是关的」是两件事：当作 error，交给 StateView 说「读不到」。
          setState({ status: 'error' })
          return
        }
        setState({
          status: 'ready',
          data: {
            toastEnabled: settings.toastEnabled === true,
            desktopEnabled: settings.desktopEnabled === true
          }
        })
      } catch {
        if (alive) setState({ status: 'error' })
      }
    }
    void read()
    return () => {
      alive = false
    }
  }, [client, nonce])

  const reload = useCallback((): void => {
    setNonce((value) => value + 1)
  }, [])

  /** 存上才改本地状态；没存上返回失败，开关留在原位。 */
  const write = useCallback(
    async (
      call: ((next: boolean) => Promise<unknown>) | undefined,
      apply: (data: NotificationSettingsData) => NotificationSettingsData,
      next: boolean
    ): Promise<NotificationWriteResult> => {
      if (call === undefined) return WRITE_FAILED
      try {
        await call(next)
      } catch {
        return WRITE_FAILED
      }
      setState((current) =>
        current.status === 'ready' ? { status: 'ready', data: apply(current.data) } : current
      )
      return WRITE_OK
    },
    []
  )

  return {
    state,
    reload,
    setToast: useCallback(
      (next: boolean) => write(client.setToastEnabled, (data) => ({ ...data, toastEnabled: next }), next),
      [client, write]
    ),
    setDesktop: useCallback(
      (next: boolean) => write(client.setDesktopEnabled, (data) => ({ ...data, desktopEnabled: next }), next),
      [client, write]
    )
  }
}
