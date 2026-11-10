/**
 * 「发一条测试提醒」——设置页三枚按钮的**产品侧**契约（需求 v4 §5、技术方案 §3）。
 *
 * 为什么这份契约在情报模块而不是平台：三个 kind 各自回答「舆情 / 日历开始前 / 日历落地」，
 * 那是产品自己的词；平台只认识「通知链路自检」那一种（`link`）。产品侧拼好一条
 * `NotificationSubmitRequest`，走平台**同一个**提交入口——平台不需要为产品开口子。
 *
 * 回执三档，闭集：
 * - `sent`：真的提交并投递了，必须带通道名（成功句「已发到 {通道名}（测试）」要有来源）；
 * - `no-data`：读到了，但那份数据此刻没有可发的样例（三种 kind 各一句，不合并）；
 * - `unavailable`：发不出去，四种原因各指一件事，读者要做的事完全不同。
 */

export const INTELLIGENCE_TEST_KINDS = ['sentiment', 'calendar-upcoming', 'calendar-landed'] as const

export type IntelligenceTestKind = (typeof INTELLIGENCE_TEST_KINDS)[number]

/** 「读到了，但没有可发的样例」：三种 kind 不共用一句话，否则读者不知道去看哪一份数据。 */
export type IntelligenceTestNoDataReason =
  | 'sentiment-none'
  | 'calendar-upcoming-none'
  | 'calendar-landed-none'

/**
 * 「发不出去」的四种原因：
 * - `push-unavailable`：此刻没有恰好一条 `runtime-ready` 通道（0 条或 ≥2 条），是配置事实，不是瞬时失败；
 * - `source-disabled`：这一行依赖的数据源没启用——去启用它，不是等一等；
 * - `timezone-unreadable`：读者时区读不到，窗口算不出来；**不拿 UTC 顶**（那会把 +08:00 印成 08:00）；
 * - `read-failed`：读不到，或提交被拒——「没拿到」和「确实没有」必须分开说。
 */
export type IntelligenceTestUnavailableReason =
  | 'push-unavailable'
  | 'source-disabled'
  | 'timezone-unreadable'
  | 'read-failed'
  /**
   * 提交成功、但**通道那一跳没成**：三种处境必须分开说，否则「手机没响」只有一个笼统的失败句。
   * - `channel-rejected`：通道拒收（或被频控/熔断挡下）；
   * - `unknown-after-send`：发出去了，但没拿到回执——既不是成功也不是失败；
   * - `not-attempted`：通道那一档根本没被尝试（提交被折叠/合并，或通道档没进这次提交）。
   */
  | 'channel-rejected'
  | 'unknown-after-send'
  | 'not-attempted'

export type IntelligenceTestReceipt =
  | Readonly<{ state: 'sent'; channelId: string; channelName: string }>
  | Readonly<{ state: 'no-data'; reasonCode: IntelligenceTestNoDataReason }>
  | Readonly<{
    state: 'unavailable'
    reasonCode: IntelligenceTestUnavailableReason
    /** 只在 `push-unavailable` 上出现：当时实际 `runtime-ready` 的通道条数（0 或 ≥2），由主进程数。 */
    enabledChannelCount?: number
  }>

/**
 * 入参校验：只认闭集里的三个 kind。
 *
 * 认不出就抛——**不回落成某一种**：回落等于替调用方选了一条它没说的消息，而按钮旁边写着
 * 「会发什么」。渲染层因此拿不到回执，也就不会把一条发错的消息报成成功。
 */
export function parseIntelligenceTestRequest(payload: unknown): IntelligenceTestKind {
  const kind = (payload as { kind?: unknown } | null | undefined)?.kind
  if (typeof kind !== 'string' || !(INTELLIGENCE_TEST_KINDS as readonly string[]).includes(kind)) {
    throw new Error('unknown-test-notification-kind')
  }
  return kind as IntelligenceTestKind
}
