import type { TestNoticeCandidate, TestNoticeCandidatePort, TestNoticeKind } from '@platform/notifications/contracts/notificationSelfTest'

/**
 * 三枚测试按钮的**产品侧只读端口**（技术方案 §3）。
 *
 * 平台只认 `TestNoticeCandidatePort` 这一个形状；三条取数分别由两条产品线实现（舆情 / 日历两条），
 * 各自新建只读文件、口径写在自己的注释里。**这一层不猜字段**：谁的那条还没接，就诚实地报
 * `read-failed`（界面「暂时读不到」），绝不返回一条编出来的候选。
 *
 * 口径不在本文件重复——每条查询的窗口、日界、门槛都写在各自的实现里，这里只做「kind → 实现」的分发。
 */
export type SelfTestReaderPorts = Partial<Record<TestNoticeKind, () => Promise<TestNoticeCandidate>>>

export function createNotificationSelfTestCandidates(ports: SelfTestReaderPorts): TestNoticeCandidatePort {
  return async (kind: TestNoticeKind): Promise<TestNoticeCandidate> => {
    const reader = ports[kind]
    if (reader === undefined) return { ok: false, reasonCode: 'read-failed' }
    try {
      return await reader()
    } catch {
      // 取数抛错也是「读不到」，不改写采集、不重试：这个按钮只回答「现在能不能发一条」。
      return { ok: false, reasonCode: 'read-failed' }
    }
  }
}
