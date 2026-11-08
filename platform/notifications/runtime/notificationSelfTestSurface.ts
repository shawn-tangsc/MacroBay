import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '../contracts/notificationContracts'
import type { TestNoticeReceipt } from '../contracts/notificationSelfTest'
import type { PushChannelResolution } from '../delivery/pushChannelResolution'

/**
 * 平台「链接自检」那颗按钮的主进程实现（设置页的「发送测试通知」）。
 *
 * `link` 是**唯一**的 kind：不取产品数据、不需要任何取数端口，所以它是平台唯一该有的那种测试。
 * 顺序：通道（`runtime-ready` 恰好一条；0 条与 ≥2 条都是 `push-unavailable`，带真实条数）→ 固定样例
 * → 同一个提交入口（`test:` 去重域，正文带【测试】）。每次点击都是新键，不占真实去重键。
 */
/**
 * 正文与标题走**平台自己的文案表**（`notification.event.platform.notification.self-test.*`），
 * 不在代码里写字面量：中心与手机拿同一份，读者在手机上第一句就知道这是自检、不是出事了。
 * 去重键带**点击时刻**：读者连点两次要收到两条，否则他会以为通道坏了——而他要验的正是这个。
 */
export type SelfTestSurfaceInput = {
  resolvePushChannel: () => Promise<PushChannelResolution>
  /** 交给运行时的**同一个**提交入口；名字以 `submit` 开头，生产者门禁才看得见这件事由谁发。 */
  submitRequest: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  /** 每次点击留一行可查记录（`notification.*`）：只带闭集码与条数。 */
  report?: (entry: { receipt: TestNoticeReceipt }) => void
  now: () => string
}

export function composeSelfTestSurface(input: SelfTestSurfaceInput) {
  return {
    async sendTestNotice(): Promise<TestNoticeReceipt> {
      const finish = (receipt: TestNoticeReceipt): TestNoticeReceipt => {
        input.report?.({ receipt })
        return receipt
      }
      const channel = await input.resolvePushChannel()
      if (!channel.ok) {
        return finish({ state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: channel.enabledChannelCount })
      }
      const at = input.now()
      // 每次点击都是新键（`seq` 用点击时刻），所以连点是多条测试记录，且不占任何真实键。
      // 实参写平：事件 id 就在提交调用里，生产者门禁第一层就能读到（不靠名字猜、也不靠再跟一层）。
      const outcome = await input.submitRequest({
        eventTypeId: 'platform.notification.self-test',
        actions: [],
        // 点开回到设置页那枚按钮（平台范围；具体落到哪一屏由设置侧给页面 id）。
        deeplink: { scope: 'platform' },
        dedupeVars: { builder: 'template', vars: { date: at.slice(0, 10), seq: String(Date.parse(at)) } },
        occurredAt: at,
        namespace: 'test'
      })
      // **只有真投递出去才算 sent**。`collapsed`（宿主当日熔断折叠成聚合、不投递）、`merged`（并进已有那条）、
      // `delegated`（让渡给产品）都**没有发生投递**，回「已发到 X」就是把「成功了但没发生」喂给读者——
      // 比熔断本身更糟。被拒按闭集最接近的一档回，不新造码。
      if (outcome.kind === 'rejected') return finish({ state: 'unavailable', reasonCode: 'read-failed' })
      if (outcome.kind === 'collapsed') return finish({ state: 'unavailable', reasonCode: 'collapsed' })
      if (outcome.kind === 'merged') return finish({ state: 'unavailable', reasonCode: 'merged' })
      if (outcome.kind === 'delegated') return finish({ state: 'unavailable', reasonCode: 'delegated' })
      return finish({ state: 'sent', channelId: channel.channelId, channelName: channel.channelName })
    }
  }
}
