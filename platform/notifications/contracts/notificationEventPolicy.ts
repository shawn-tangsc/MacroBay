/**
 * 平台批准表（契约 §4.1，**已签 2026-11-02**）：**生效值只读这张表**。
 *
 * 批准 ≠ 订阅：批准是上限（平台说这条**可以**到桌面 / 手机），订阅是读者的选择。
 * 投递表面 = 批准 ∩ 订阅；中心恒在，不受订阅影响。
 *
 * 改动任何一格都要回产品重签（平台 8 行＝通用模块产品经理，情报 8 行＝情报模块产品经理），
 * 不许在实现里顺手调——这张表被界面当作「未批准就画灰色 —」的唯一依据。
 *
 * 本版 **16 行（平台 8 + 情报 8）**，编号跳过 N4（`market-intelligence.signal.interpreted`
 * 本版不登记，编号不复用）。
 *
 * 2026-11-03 删掉 `market-intelligence.briefing.ready` 这一行：事件本身已按 §28 整条移除
 * （成功是常态，不打扰读者）。**批准表里不该留一条没有事件的批准**——留着就是一个静默复活的口子：
 * 哪天有人把事件声明加回来，桌面与通道当场就是「已批准」，谁都不用再看这张表。
 * 要恢复，先回来申请这一行，不留后门。
 *
 * **2026-11-04 用户翻案恢复** `market-intelligence.briefing.ready`（日报已完成）：他要每天在手机上看
 * 日报，而不是进入应用查看。恢复的是「读者可以勾选」这条路，**不是替读者勾上**：默认不勾，
 * 勾了才记录、才推；一天一期最多一条，同日重新生成不重推。情报侧 8 行由情报模块产品经理重签。
 */
import type { NotificationEventPolicy } from './notificationEventCatalog'

export const NOTIFICATION_EVENT_POLICY: NotificationEventPolicy = Object.freeze({
  // ── 平台 8 行（通用模块产品经理 2026-11-02 签） ──
  'platform.job.failed-terminal': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.job.repeated-failed': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  'platform.analysis.quota-exhausted': { approvedDisruptionLevels: ['center', 'toast'], approvedBypassQuietHours: false },
  'platform.provider.credential-invalid': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.provider.credential-recovered': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'platform.channel.push-suspended': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.channel.push-resumed': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'platform.desktop.blocked': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  // ── 情报 8 行（情报模块产品经理 2026-11-02 签 7 行；2026-11-04 按用户翻案加回 briefing.ready） ──
  'market-intelligence.briefing.failed': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  // 结果类：中心恒在；桌面与通道是**上限**，读者勾了才投递。措辞与预测校准同级，不是告警。
  'market-intelligence.briefing.ready': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false },
  // 这两行的 channel 是**上限**：通道投递尚未获用户点头，通道就绪前界面不提供该列。
  // 批准 ≠ 现况；撤掉再接通要重签，所以留着并解释——下一个人读到这里不许以为「批了就等于读者能配」。
  'market-intelligence.signal.triggered': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false },
  'market-intelligence.macro.event-landed': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false },
  'market-intelligence.source.consecutive-failed': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.source.stale': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.calibration.result': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'market-intelligence.timezone.invalid': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
})

/** 本版批准表行数：界面与验收按它核对「16 行」。多一行少一行都要回产品重签。 */
export const NOTIFICATION_EVENT_POLICY_ROW_COUNT = Object.keys(NOTIFICATION_EVENT_POLICY).length
