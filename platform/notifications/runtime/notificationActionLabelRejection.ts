import type { NotificationAction } from '../contracts/notificationContracts'
import type { NotificationSubmitRejection } from '../contracts/notificationSubmitRejection'

/**
 * 动作标签的两条**提交期**校验（契约 v2.58），单独成文：`notificationSubmitPlan.ts` 已经贴着
 * 500 行硬线，加一条规则就该先问「它是不是该有自己的文件」。
 *
 * - 引用指向另一个产品 → `action-label-wrong-scope`。解析得出来就是把 B 的文案贴在 A 的按钮上；
 *   解析不出来就是一个没有名字的按钮。两种都不许落库。
 * - 既没有 `labelRef` 也没有 `labelKey` → `action-label-missing`。没有名字的按钮不是按钮。
 *
 * 老记录只有 `labelKey`（平台闭集）：照常放行，它们还在库里躺着。
 */
export function actionLabelRejection(
  actions: readonly NotificationAction[],
  eventProductId: string
): NotificationSubmitRejection | undefined {
  for (const action of actions) {
    if (action.labelRef === undefined && action.labelKey === undefined) {
      return {
        kind: 'rejected',
        reason: 'action-label-missing',
        message: `action "${action.id}" carries no label reference`
      }
    }
    if (action.labelRef?.scope === 'product' && action.labelRef.productId !== eventProductId) {
      return {
        kind: 'rejected',
        reason: 'action-label-wrong-scope',
        message: `action "${action.id}" references product "${action.labelRef.productId}" but the event belongs to "${eventProductId}"`
      }
    }
  }
  return undefined
}
