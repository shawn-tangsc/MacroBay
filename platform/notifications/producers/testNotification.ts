import type { NotificationRequest } from '../contracts/notificationContracts'

/**
 * 「发送测试通知」的请求构造：**唯一目的是验证链路**，不描述任何业务事实。
 *
 * 两处容易做错，都用用例钉住：
 *
 * 1. **去重键每次不同**。整条管道最擅长的就是去重，而测试按钮最不需要的恰恰是去重——
 *    同一个键会让用户点第二次时什么都没发生，他会以为按钮坏了。
 * 2. **`sourceId` 与真实来源分开**（`platform.test`），测试通知不占真实来源的熔断额度：
 *    否则用户连点十次检查链路，当晚真实的任务失败通知就会被折叠成「今日另有 N 条」。
 */
export function buildTestNotificationRequest(nowMs: number = Date.now()): NotificationRequest {
  return {
    owner: 'platform',
    sourceId: 'platform.test',
    titleKey: 'notification.test.title',
    bodyKey: 'notification.test.body',
    severity: 'info',
    priority: 'normal',
    // 走完整链路：桌面被系统拦了，中心里那条仍要在——那是用户判断「系统放没放行」的唯一手段。
    requestedChannels: ['center', 'desktop'],
    dedupeKey: `test-${nowMs}`
  }
}
