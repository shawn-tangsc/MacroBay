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
const LINK_SAMPLE_REQUEST: NotificationSubmitRequest = {
  eventTypeId: 'market-intelligence.briefing.ready',
  dedupeVars: { builder: 'template', vars: { date: 'self-test' } },
  rendered: {
    'zh-CN': { title: '【测试】通知链路自检', body: '这是测试消息，不是真实提醒。收到它说明推送链路是通的。', reason: '测试消息' },
    'en-US': { title: '[Test] Notification link check', body: 'This is a test message, not a real alert. Getting it means the push link works.', reason: 'Test message' }
  },
  actions: [],
  occurredAt: '2026-11-08T00:00:00.000Z'
}

export type SelfTestSurfaceInput = {
  resolvePushChannel: () => Promise<PushChannelResolution>
  /** 交给运行时的**同一个**提交入口（不是另开一条发消息的路）；名字不叫 submit 只为不误导生产者门禁。 */
  deliver: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  /** 每次点击留一行可查记录（`MI_TEST_NOTICE_*`）：只带闭集码与条数。 */
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
      const outcome = await input.deliver({ ...LINK_SAMPLE_REQUEST, namespace: 'test' })
      // 提交被拒也是「没发出去」：按闭集里最接近的一档回，不新造码。
      if (outcome.kind === 'rejected') return finish({ state: 'unavailable', reasonCode: 'read-failed' })
      return finish({ state: 'sent', channelId: channel.channelId, channelName: channel.channelName })
    }
  }
}
