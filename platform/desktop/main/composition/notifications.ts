import type { AppLanguage, AppSettings } from '@platform/settings/schema/appSettings'
import { configureNotificationRuntime } from '@platform/notifications/ipc/registerNotificationIpc'

/**
 * 通知运行时的装配。
 *
 * 搬家不是目的，**收口**才是：`app.ts` 里这一段原本是 10 行闭包，它读的是设置与时区两份状态。
 * 现在这两份状态由调用方按端口传进来，模块自己不知道设置存在哪儿——`app.ts` 只剩一行。
 *
 * 两处口径保持不变（都是从 `app.ts` 逐字搬过来的，不是重写）：
 * - **免打扰窗口按设置的读者时区判断**，不按运行机器；
 * - **桌面通知每次读设置拿当前语言**，所以切语言后连历史通知也按新语言解析。
 */
export type NotificationCompositionPorts = Readonly<{
  /** 当前设置。每次调用都重读，**不许缓存**：语言与时区随时会变。 */
  getSettings: () => Promise<AppSettings>
  /** 读者时区（设置里的那一个，不是运行机器的）。 */
  timeZone: () => string
}>

export function composeNotificationRuntime(ports: NotificationCompositionPorts): void {
  configureNotificationRuntime({
    getSettings: async () => (await ports.getSettings()).notifications,
    clock: { now: () => new Date(), timeZone: ports.timeZone },
    getLanguage: async (): Promise<AppLanguage> => {
      const language = (await ports.getSettings()).language
      return language === 'en-US' ? 'en-US' : 'zh-CN'
    }
  })
}
