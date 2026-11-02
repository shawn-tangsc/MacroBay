/**
 * 文案解析端口（契约 §3.3）：记录里存键与参数，句子在**投递那一刻**按当前语言解析一次。
 *
 * 平台事件用平台闭集键；产品事件的键由装配层注入的产品文案表解析。平台**不 import 产品代码**：
 * 产品表由组合根传进来，这个文件只认 `NotificationCopyRef`。
 *
 * 解析不到**不许露键**：回退平台兜底句，并由调用方记 `copy-unresolved` 诊断（契约 §3.3）。
 */
import type { NotificationCopyLanguage, NotificationCopyTable } from '../../i18n/notificationCopy'

export type NotificationCopyRef =
  | { scope: 'platform'; key: string; params?: Readonly<Record<string, string>> }
  | { scope: 'product'; productId: string; key: string; params?: Readonly<Record<string, string>> }

export type NotificationCopyPort = {
  resolve: (ref: NotificationCopyRef, language: NotificationCopyLanguage) => string | null
}

export type NotificationCopyTableSet = Readonly<Record<NotificationCopyLanguage, Readonly<Record<string, string>>>>

export function createNotificationCopyPort(input: {
  platform: Readonly<Record<NotificationCopyLanguage, NotificationCopyTable>>
  products?: Readonly<Record<string, NotificationCopyTableSet>>
}): NotificationCopyPort {
  return {
    resolve(ref, language) {
      const table = (ref.scope === 'platform'
        ? input.platform[language]
        : input.products?.[ref.productId]?.[language]) as Readonly<Record<string, string>> | undefined
      const template = table?.[ref.key]
      if (typeof template !== 'string' || template.trim().length === 0) return null
      return interpolate(template, ref.params)
    }
  }
}

/** 占位符缺参时保留原样（与 `resolveNotificationCopyText` 同一条策略：至少看得出缺哪一项）。 */
function interpolate(template: string, params: Readonly<Record<string, string>> = {}): string {
  return template.replace(/\{(\w+)\}/gu, (placeholder, name: string) => params[name] ?? placeholder)
}
