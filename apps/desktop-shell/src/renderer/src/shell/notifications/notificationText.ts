import { notificationCopy, type NotificationCopyKey, type NotificationCopyLanguage } from '@platform/i18n/notificationCopy'
import type { SafeNotificationRecord } from '@platform/notifications/contracts/notificationContracts'

/**
 * 记录里存的是键 + 参数，句子在**展示时**按当前语言解析：切了语言，历史通知也跟着变。
 *
 * 抽屉与右上角横幅共用这一处：同一个记录在两处显示不同的句子，比显示得难看严重得多。
 * 缺参时保留 `{name}`——静默删掉整段会得到一句读得通、但指错对象的话。
 */
export function resolveNotificationText(
  record: Pick<SafeNotificationRecord, 'titleKey' | 'titleParams' | 'bodyKey' | 'bodyParams'>,
  language: NotificationCopyLanguage
): { title: string; body: string } {
  const table = notificationCopy[language]
  const fill = (template: string, params?: Readonly<Record<string, string>>): string =>
    params === undefined
      ? template
      : template.replace(/\{(\w+)\}/g, (whole, name: string) =>
          Object.prototype.hasOwnProperty.call(params, name) ? params[name]! : whole
        )
  const title = table[record.titleKey as NotificationCopyKey] ?? record.titleKey
  const body = record.bodyKey === undefined ? '' : table[record.bodyKey as NotificationCopyKey] ?? record.bodyKey
  return { title: fill(title, record.titleParams), body: fill(body, record.bodyParams) }
}
