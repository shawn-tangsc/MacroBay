/**
 * 设置域的变更信号（C8）：**两处同源的设置，一处保存后另一处跟着重读**。
 *
 * 同一 renderer 内的一条窗口事件，不扩平台 IPC（跨窗口广播是本版明确不做的）。
 * 每条事件带 `domain` 与 `origin`：
 * - `domain` 让订阅方只重读自己那一块（来源 / 通知 / 日报 / 平台）；
 * - `origin` 让**发出方忽略自己那一次**，否则一次保存会引出一轮多余的重读。
 *
 * 为什么不是「让保存方直接调另一个界面的重读函数」：两个界面互相不持有对方，
 * 事件是唯一不新增依赖的方向；谁保存谁发，谁开着谁重读。
 */
export const SETTINGS_DOMAINS = ['sources', 'notifications', 'briefing', 'platform'] as const

export type SettingsDomain = (typeof SETTINGS_DOMAINS)[number]

export const SETTINGS_REVISION_EVENT = 'market-intelligence:settings-revision'

export type SettingsRevisionDetail = Readonly<{ domain: SettingsDomain; origin: string }>

export function notifySettingsRevision(domain: SettingsDomain, origin: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<SettingsRevisionDetail>(SETTINGS_REVISION_EVENT, {
    detail: { domain, origin }
  }))
}

/** 订阅一个域；返回取消订阅。事件形状不对（别处同名事件）一律忽略。 */
export function subscribeSettingsRevision(
  domain: SettingsDomain,
  listener: (detail: SettingsRevisionDetail) => void
): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<SettingsRevisionDetail>).detail
    if (detail === undefined || detail.domain !== domain || typeof detail.origin !== 'string') return
    listener(detail)
  }
  window.addEventListener(SETTINGS_REVISION_EVENT, handler)
  return () => window.removeEventListener(SETTINGS_REVISION_EVENT, handler)
}
