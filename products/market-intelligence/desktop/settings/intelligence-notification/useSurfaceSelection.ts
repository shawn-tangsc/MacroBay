import { useCallback, useEffect, useState } from 'react'

import type { SelectableSurface } from '@platform/notifications/contracts/notificationSurfaceSelection'

/**
 * 「发到哪些地方」那一层的读写（契约 §5.5 第三层，归平台存）。
 *
 * 页面**不自己判三层**：可用面、冲突与否都由平台读到；这里只把它翻译成画得出来的状态。
 * 「总开关关着但读者勾了」那一格由页面当场说明——那是「不许点了没反应」的同一件事。
 */

type SurfaceState = Readonly<{
  status: 'loading' | 'ready' | 'error'
  /** 这一条（或这一组）实际允许的面，已按批准表上限夹紧。 */
  available: readonly SelectableSurface[]
  selection: Readonly<Partial<Record<SelectableSurface, boolean>>>
  /** 组里两条存量值不一致：平台已按「都关」处理，页面要按「读不到」说，而不是当成读者关的。 */
  conflict: boolean
  /** 应用内提示的总开关；关着时勾了也不会闪。 */
  toastMasterOff: boolean
  saving: boolean
  saveFailed: boolean
  reload: () => void
  toggle: (surface: SelectableSurface, next: boolean) => void
}>

type NotificationsBridge = Readonly<{
  getSurfaceSelection?: (eventTypeId: string) => Promise<unknown>
  setSurfaceSelection?: (eventTypeId: string, surfaces: Record<string, boolean>) => Promise<unknown>
  getDeliverySettings?: () => Promise<unknown>
}>

function bridge(): NotificationsBridge | undefined {
  return (window as unknown as { platform?: { notifications?: NotificationsBridge } }).platform?.notifications
}

export function useSurfaceSelection(eventTypeId: string): SurfaceState {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [available, setAvailable] = useState<readonly SelectableSurface[]>([])
  const [selection, setSelection] = useState<Readonly<Partial<Record<SelectableSurface, boolean>>>>({})
  const [conflict, setConflict] = useState(false)
  const [toastMasterOff, setToastMasterOff] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [token, setToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    const api = bridge()
    if (!api?.getSurfaceSelection) { setStatus('error'); return }
    void Promise.all([
      (api.getSurfaceSelection as (eventTypeId: string) => Promise<unknown>)(eventTypeId),
      api.getDeliverySettings ? api.getDeliverySettings() : Promise.resolve(undefined)
    ]).then(
      ([read, delivery]) => {
        if (cancelled) return
        const value = read as { available: readonly SelectableSurface[]; selection: Readonly<Partial<Record<SelectableSurface, boolean>>>; conflict: boolean }
        setAvailable(value.available)
        setSelection(value.selection)
        setConflict(value.conflict === true)
        const settings = delivery as { toastEnabled?: boolean } | undefined
        setToastMasterOff(settings?.toastEnabled === false)
        setStatus('ready')
      },
      () => { if (!cancelled) setStatus('error') }
    )
    return () => { cancelled = true }
  }, [eventTypeId, token])

  const reload = useCallback(() => setToken((current) => current + 1), [])

  const toggle = useCallback((surface: SelectableSurface, next: boolean) => {
    const api = bridge()
    if (!api?.setSurfaceSelection) { setSaveFailed(true); return }
    setSaving(true)
    setSaveFailed(false)
    void (api.setSurfaceSelection as (eventTypeId: string, surfaces: Record<string, boolean>) => Promise<unknown>)(
      eventTypeId,
      { [surface]: next }
    ).then(
      () => { setSaving(false); reload() },
      () => { setSaving(false); setSaveFailed(true) }
    )
  }, [eventTypeId, reload])

  return { status, available, selection, conflict, toastMasterOff, saving, saveFailed, reload, toggle }
}
