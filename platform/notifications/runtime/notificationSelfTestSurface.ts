import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '../contracts/notificationContracts'
import type {
  TestNoticeCandidatePort,
  TestNoticeKind,
  TestNoticeReceipt
} from '../contracts/notificationSelfTest'
import type { PushChannelResolution } from '../delivery/pushChannelResolution'

/**
 * 三枚「测试」按钮的主进程实现（技术方案 §2/§3）。单独成文件：`notificationRuntime.ts` 已经顶在
 * 500 行硬线上，而这一块增长的理由（取数口径、三档回执）与运行时主体无关。
 *
 * 顺序即判据：
 * 1. **通道**先判（`runtime-ready` 恰好一条）——0 条与 ≥2 条都是 `push-unavailable`，带真实条数；
 * 2. **时区**再判，读不到 → `timezone-unreadable`，**绝不静默退回 UTC**（那会把日界算错一天）；
 * 3. **取数**由产品侧只读端口给（平台不 import 产品）；端口缺席 → `read-failed`，诚实的读不到；
 * 4. 真数据 → 同一个 `submit`、同一张批准表，只多 `namespace: 'test'`（去重域）与候选自带的【测试】前缀。
 *
 * 每次点击都是新键（`occurredAt` 由调用方给），所以连点两次是两条测试记录，且**不占真实去重键**。
 */
export type SelfTestSurfaceInput = {
  getTimezone: () => string
  resolvePushChannel: () => Promise<PushChannelResolution>
  candidates?: TestNoticeCandidatePort
  /** 交给运行时的**同一个**提交入口（不是另开一条发消息的路）；名字不叫 submit 只为不误导生产者门禁。 */
  deliver: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  /** 每次点击留一行可查记录（`MI_TEST_NOTICE_*`）：只带 kind、闭集码与条数，不带强度/时区/凭据。 */
  report?: (entry: { kind: TestNoticeKind; receipt: TestNoticeReceipt }) => void
  now: () => string
}

export function composeSelfTestSurface(input: SelfTestSurfaceInput) {
  return {
    async sendTestNotice(kind: TestNoticeKind): Promise<TestNoticeReceipt> {
      const finish = (receipt: TestNoticeReceipt): TestNoticeReceipt => {
        input.report?.({ kind, receipt })
        return receipt
      }
      const channel = await input.resolvePushChannel()
      if (!channel.ok) {
        return finish({ state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: channel.enabledChannelCount })
      }

      let timeZone = ''
      try {
        timeZone = input.getTimezone().trim()
      } catch {
        timeZone = ''
      }
      if (timeZone === '') {
        // 拿不到读者时区就不算日界：宁可说「暂时读不到」，也不用 UTC 顶一次。
        return finish({ state: 'unavailable', reasonCode: 'timezone-unreadable' })
      }

      if (input.candidates === undefined) {
        return finish({ state: 'unavailable', reasonCode: 'read-failed' })
      }

      const candidate = await input.candidates(kind).catch(() => ({ ok: false as const, reasonCode: 'read-failed' as const }))
      if (!candidate.ok) {
        if (candidate.reasonCode === 'source-disabled' || candidate.reasonCode === 'read-failed') {
          return finish({ state: 'unavailable', reasonCode: candidate.reasonCode })
        }
        return finish({ state: 'no-data', reasonCode: candidate.reasonCode })
      }

      const outcome = await input.deliver({ ...candidate.request, namespace: 'test' })
      if (outcome.kind === 'rejected') {
        // 被拒也是「没发出去」，按闭集里最接近的一档回，不新造码。
        return finish({ state: 'unavailable', reasonCode: 'read-failed' })
      }
      return { state: 'sent', channelId: channel.channelId, channelName: channel.channelName }
    }
  }
}
