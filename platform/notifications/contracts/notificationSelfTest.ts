import type { NotificationSubmitRequest } from './notificationContracts'

/**
 * 设置页三枚「测试」按钮的**平台侧契约**（技术方案 §2/§3）。
 *
 * 测试消息与真实推送走**同一条链**：同一个 `submit`、同一张批准表、同一套免打扰与严重度；
 * 只两处不同——去重命名空间（`namespace: 'test'`，规划器拼成 `test:<product>|<key>`）与正文里的
 * 【测试】前缀（由候选自带，产品那边加 `testPrefix` 键，平台不另造句子）。
 *
 * **取数不在这里**：平台不 import 产品代码。这个类型只是「产品怎么把一条真数据交给平台」的端口，
 * 由组合根注入；端口缺席时一律 `read-failed`——诚实的「读不到」，不是静默的空。
 */
export type TestNoticeKind = 'sentiment' | 'calendar-upcoming' | 'calendar-landed'

export type TestNoticeNoDataReason = 'sentiment-none' | 'calendar-upcoming-none' | 'calendar-landed-none'

export type TestNoticeUnavailableReason =
  | 'push-unavailable'
  | 'source-disabled'
  | 'timezone-unreadable'
  | 'read-failed'

/** 一条可发的真数据（成品文案已带【测试】前缀与「这是测试消息」首行），或三种「没有」之一。 */
export type TestNoticeCandidate =
  | { ok: true; request: NotificationSubmitRequest }
  | { ok: false; reasonCode: TestNoticeNoDataReason | 'source-disabled' | 'read-failed' }

/**
 * 三档回执（闭集）。`sent` 必带通道名——成功句是「已发到 {通道名}（测试）」，渲染层读不到通道列表。
 * `enabledChannelCount` **只在 `push-unavailable` 上出现**，且与 reason 出自同一次判定。
 */
export type TestNoticeReceipt =
  | { state: 'sent'; channelId: string; channelName: string }
  | { state: 'no-data'; reasonCode: TestNoticeNoDataReason }
  | { state: 'unavailable'; reasonCode: TestNoticeUnavailableReason; enabledChannelCount?: number }

/** 产品侧只读取数端口：入参只有 kind，强度/条数/时区/通道全由主进程按当前配置重算。 */
export type TestNoticeCandidatePort = (kind: TestNoticeKind) => Promise<TestNoticeCandidate>
