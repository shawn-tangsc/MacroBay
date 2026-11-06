import { useCallback, useEffect, useState } from 'react'

import { newsPushOutletClient, type NewsPushOutletClient } from '../../shared/ipc/newsPushOutletClient'

/**
 * 「舆情提醒」第四条的读与写。
 *
 * 三条硬规矩（对应界面规范 §9d 与 U12）：
 * - **值只从服务读**：没有 `useState` 存的「真值」，写完**重新读一次**再渲染；
 * - **写完读回的值说了算**：服务端没写进去时界面必须跟着它回到原值——本地先翻转再回滚，
 *   会在那一瞬间给读者看一个不存在的状态；
 * - **默认关**：从来没有水位就是 `enabled: false`，不许因为「另外三条都开着」而默认打开。
 *
 * 为什么默认关不是保守：水位与基线只有在读者按下那一刻才成立，替他打开，这功能最关键的
 * 第一次就没人验过。
 */

export type NewsPushOutletSwitchState = Readonly<{
  status: 'loading' | 'ready' | 'error'
  enabled: boolean
  enabledAt?: string
  saving: boolean
  saveFailed: boolean
  reload: () => void
  setEnabled: (enabled: boolean) => void
}>

export function useNewsPushOutletSwitch(
  client: NewsPushOutletClient = newsPushOutletClient
): NewsPushOutletSwitchState {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [enabled, setEnabled] = useState(false)
  const [enabledAt, setEnabledAt] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    void client.state().then(
      (state) => {
        if (cancelled) return
        setEnabled(state.enabled)
        setEnabledAt(state.enabledAt)
        setStatus('ready')
      },
      () => { if (!cancelled) setStatus('error') }
    )
    return () => { cancelled = true }
  }, [client, reloadToken])

  const reload = useCallback(() => { setReloadToken((token) => token + 1) }, [])

  const setEnabledAndReRead = useCallback((next: boolean) => {
    setSaving(true)
    setSaveFailed(false)
    void client.setEnabled(next).then(
      () => {
        // 重新读一次，而不是把 `next` 直接写进 state：写进去的是**我们的意愿**，
        // 读回来的是**服务端的事实**，两者不同时读者只该看到后者。
        void client.state().then(
          (state) => {
            setEnabled(state.enabled)
            setEnabledAt(state.enabledAt)
            setSaving(false)
          },
          () => { setSaving(false); setSaveFailed(true) }
        )
      },
      () => { setSaving(false); setSaveFailed(true) }
    )
  }, [client])

  return { status, enabled, ...(enabledAt === undefined ? {} : { enabledAt }), saving, saveFailed, reload, setEnabled: setEnabledAndReRead }
}
