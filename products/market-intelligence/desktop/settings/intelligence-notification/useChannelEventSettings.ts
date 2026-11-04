import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'

/**
 * 情报 · 通知设置页的数据面：三条「推不推手机」的读与写。
 *
 * 两条硬约束：
 * - **写只走 `setChannelEvent`**，页面不自己拼设置、也不本地持久化；平台只接受批准含
 *   `channel` 的 id，写别的会抛错——这里不吞，转成那一行的就地失败提示。
 * - **没写过的按开**（「装上就推，不想收再去关」）：`getChannelEvents()` 只返回存过的键，
 *   缺省值在这里补，且只补一次，读回 `false` 时不会被默认值覆盖。
 *
 * 保存失败**回滚那一行**并就地提示，不假装成功（界面规范 §9d 第③条）。
 */

/** 这一屏的三条，顺序就是页面顺序：信号 → 宏观 → 日报。 */
export const INTELLIGENCE_CHANNEL_EVENT_ROWS = Object.freeze([
  { eventId: EVENT_IDS.signalTriggered, titleKey: 'pages.intelligence.notification.rows.signalTriggered.title', infoKey: 'pages.intelligence.notification.rows.signalTriggered.info' },
  { eventId: EVENT_IDS.macroEventLanded, titleKey: 'pages.intelligence.notification.rows.macroEventLanded.title', infoKey: 'pages.intelligence.notification.rows.macroEventLanded.info' },
  { eventId: EVENT_IDS.briefingReady, titleKey: 'pages.intelligence.notification.rows.briefingReady.title', infoKey: 'pages.intelligence.notification.rows.briefingReady.info' }
])

export type IntelligenceChannelEventRow = (typeof INTELLIGENCE_CHANNEL_EVENT_ROWS)[number]

type ChannelEventValues = Readonly<Record<string, boolean>>

export type ChannelEventSettingsState = {
  status: 'loading' | 'ready' | 'error'
  /** 每条当前是否推手机；缺省按开。 */
  values: ChannelEventValues
  /** 正在保存的那一条（开关同时禁用，防连点）。 */
  savingEventId: string | null
  /** 保存失败的那一条；只影响它自己那一行。 */
  failedEventId: string | null
  /** 频道是否可用（可用 = 推送端口装配好且至少一个可投递目标）。不可用不禁用开关。 */
  channelReady: boolean
  reload: () => void
  toggle: (eventId: string, enabled: boolean) => void
}

type NotificationApi = {
  getChannelEvents: () => Promise<Readonly<Record<string, boolean>>>
  setChannelEvent: (eventId: string, enabled: boolean) => Promise<unknown>
  getDeliverySettings: () => Promise<{ pushWired: boolean; channels: readonly unknown[] }>
}

function notificationApi(): NotificationApi {
  const api = window.platform?.notifications as NotificationApi | undefined
  if (!api) throw new Error('notification-api-unavailable')
  return api
}

/** 「可投递」只看投影自己的 `deliverable`：不从通道列表里猜，也不读适配器的验收状态。 */
function isDeliverableChannel(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'deliverable' in value && value.deliverable === true
}

function isChannelReady(delivery: { pushWired: boolean; channels: readonly unknown[] }): boolean {
  if (delivery.pushWired !== true) return false
  return delivery.channels.some(isDeliverableChannel)
}

export function useChannelEventSettings(): ChannelEventSettingsState {
  const [status, setStatus] = useState<ChannelEventSettingsState['status']>('loading')
  const [values, setValues] = useState<ChannelEventValues>({})
  const [savingEventId, setSavingEventId] = useState<string | null>(null)
  const [failedEventId, setFailedEventId] = useState<string | null>(null)
  const [channelReady, setChannelReady] = useState(true)
  // 卸载后不再 setState：这一屏会被设置页挂载/卸载，慢响应回来时组件可能已经走了。
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async () => {
    setStatus('loading')
    setFailedEventId(null)
    try {
      const api = notificationApi()
      const [stored, delivery] = await Promise.all([api.getChannelEvents(), api.getDeliverySettings()])
      if (!mounted.current) return
      const next: Record<string, boolean> = {}
      for (const row of INTELLIGENCE_CHANNEL_EVENT_ROWS) {
        next[row.eventId] = stored[row.eventId] ?? true
      }
      setValues(next)
      setChannelReady(isChannelReady(delivery))
      setStatus('ready')
    } catch {
      if (!mounted.current) return
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = useCallback((eventId: string, enabled: boolean) => {
    const previous = values[eventId] ?? true
    setValues((current) => ({ ...current, [eventId]: enabled }))
    setFailedEventId(null)
    setSavingEventId(eventId)
    void (async () => {
      try {
        await notificationApi().setChannelEvent(eventId, enabled)
      } catch {
        if (!mounted.current) return
        // 回滚到点之前的值：界面绝不显示「开着」而设置里其实是关的。
        setValues((current) => ({ ...current, [eventId]: previous }))
        setFailedEventId(eventId)
      } finally {
        if (mounted.current) setSavingEventId(null)
      }
    })()
  }, [values])

  return useMemo(
    () => ({
      status,
      values,
      savingEventId,
      failedEventId,
      channelReady,
      reload: () => void load(),
      toggle
    }),
    [status, values, savingEventId, failedEventId, channelReady, load, toggle]
  )
}
