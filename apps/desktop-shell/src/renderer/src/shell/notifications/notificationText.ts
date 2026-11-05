import { notificationCopy, type NotificationCopyKey, type NotificationCopyLanguage } from '@platform/i18n/notificationCopy'
import type { SafeNotificationRecord } from '@platform/notifications/contracts/notificationContracts'

/**
 * 记录里存的是键 + 参数，句子在**展示时**解析：改措辞，历史通知跟着变好。
 *
 * 但**用哪种语言**不跟界面走：记录带着提交时的语言标签时就用它。否则切一次语言，昨天收到的
 * 通知会变成今天的说法——那是改写历史，跟运行记录的规矩冲突。
 *
 * 没有标签的是**旧记录**（提交时没人记语言）：跟随当前语言。这是历史遗留处理，不是设计；
 * 谁也不许替它们补一个「当时应该是中文」。
 *
 * 抽屉与右上角横幅共用这一处：同一个记录在两处显示不同的句子，比显示得难看严重得多。
 * 缺参时保留 `{name}`——静默删掉整段会得到一句读得通、但指错对象的话。
 */
export function resolveNotificationText(
  record: Pick<SafeNotificationRecord, 'titleKey' | 'titleParams' | 'bodyKey' | 'bodyParams' | 'language'>,
  currentLanguage: NotificationCopyLanguage
): { title: string; body: string } {
  const language = record.language ?? currentLanguage
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
