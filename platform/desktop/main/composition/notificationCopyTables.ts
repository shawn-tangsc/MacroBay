import type { ProductManifest } from '@platform/product-manifest'
import type { NotificationCopyTableSet } from '@platform/notifications/contracts/notificationCopyPort'

/**
 * 产品通知文案表随 manifest 注入（契约 §3.3）。
 *
 * 平台**不 import 产品代码**：文案表由产品在自己的 manifest 上声明，组合根只按 `manifest.id`
 * 收成一张 map 交给文案端口。所以这里不认识任何产品名，删掉某个产品目录也不会留下悬空 import。
 *
 * 没声明 `notificationCopy` 的产品不出现在表里：它的事件文案解析不到，由文案端口返回 null，
 * 调用方退到平台兜底句并记 `copy-unresolved`（契约 §3.3 要求「解析不到不许露键」）。
 */
export function productNotificationCopyTables(
  manifests: readonly ProductManifest[]
): Readonly<Record<string, NotificationCopyTableSet>> {
  const tables: Record<string, NotificationCopyTableSet> = {}
  for (const manifest of manifests) {
    if (manifest.notificationCopy !== undefined) tables[manifest.id] = manifest.notificationCopy
  }
  return tables
}
