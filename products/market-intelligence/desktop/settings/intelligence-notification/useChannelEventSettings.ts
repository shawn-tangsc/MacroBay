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

/**
 * 屏上四行，一行一条：**事件 id 与标题键写在一起**，页面按 `itemKey` 取行、按 `eventId` 绑定。
 *
 * 不再用 `ROWS[0] / ROWS[1] / ROWS[2]` 取：下标取法在补一行、删一行、换顺序时**不会报错**，
 * 只会让某一行的开关悄悄绑到别的事件上——2026-11-07 舆情行借用 `macro.event-landed` 就是这么来的。
 *
 * `control` 说明这一行的开关落到哪个存储：
 * - `channel-event`：`settings.json → notifications.channelEvents[eventId]`（平台否决位）；
 * - `outlet`：新闻推送水位（另一套存储，不走 channelEvents）；
 * - `surface-group`：日历组选择（`calendar-events`，一条管「开始前 / 发生后」两段）。
 */
export const INTELLIGENCE_CHANNEL_EVENT_ROWS = Object.freeze([
  { itemKey: 'signal', control: 'channel-event', eventId: EVENT_IDS.signalTriggered, titleKey: 'pages.intelligence.notification.rows.signalTriggered.title', infoKey: 'pages.intelligence.notification.rows.signalTriggered.info' },
  { itemKey: 'briefing', control: 'channel-event', eventId: EVENT_IDS.briefingReady, titleKey: 'pages.intelligence.notification.rows.briefingReady.title', infoKey: 'pages.intelligence.notification.rows.briefingReady.info' },
  { itemKey: 'sentiment', control: 'outlet', eventId: EVENT_IDS.sentimentAlert, titleKey: 'pages.intelligence.notification.rows.sentimentAlert.title', infoKey: 'pages.intelligence.notification.rows.sentimentAlert.info' },
  { itemKey: 'calendar', control: 'surface-group', eventId: EVENT_IDS.calendarEventUpcoming, titleKey: 'pages.intelligence.notification.rows.calendar.title', infoKey: 'pages.intelligence.notification.rows.calendar.info' }
] as const)

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
    // 读者刚选的值先留下；写失败也**不回退**（G8）：本行给「这次没存上，请重试」，
    // 读者按的是开就是开，不是「先显示开、再偷偷变回关」。
    setValues((current) => ({ ...current, [eventId]: enabled }))
    setFailedEventId(null)
    setSavingEventId(eventId)
    void (async () => {
      try {
        await notificationApi().setChannelEvent(eventId, enabled)
      } catch {
        if (!mounted.current) return
        // 不回退：保留读者刚选的值，只报这一行没存上。
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
