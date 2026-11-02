/**
 * 平台批准表（契约 §4.1，**已签 2026-11-02**）：**生效值只读这张表**。
 *
 * 批准 ≠ 订阅：批准是上限（平台说这条**可以**到桌面 / 手机），订阅是读者的选择。
 * 投递表面 = 批准 ∩ 订阅；中心恒在，不受订阅影响。
 *
 * 改动任何一格都要回产品重签（平台 8 行＝通用模块产品经理，情报 8 行＝情报模块产品经理），
 * 不许在实现里顺手调——这张表被界面当作「未批准就画灰色 —」的唯一依据。
 *
 * 本版 16 行（平台 8 + 情报 8），编号跳过 N4（`market-intelligence.signal.interpreted`
 * 本版不登记，编号不复用）。
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
  // ── 情报 8 行（情报模块产品经理 2026-11-02 签） ──
  'market-intelligence.briefing.failed': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.briefing.ready': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false },
  'market-intelligence.signal.triggered': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false },
  'market-intelligence.macro.event-landed': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false },
  'market-intelligence.source.consecutive-failed': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.source.stale': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.calibration.result': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'market-intelligence.timezone.invalid': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
})

/** 本版批准表行数：界面与验收按它核对「16 行」。多一行少一行都要回产品重签。 */
export const NOTIFICATION_EVENT_POLICY_ROW_COUNT = Object.keys(NOTIFICATION_EVENT_POLICY).length
