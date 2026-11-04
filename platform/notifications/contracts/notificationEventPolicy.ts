/**
 * 平台批准表（契约 §4.1，**已签 2026-11-04**）：**生效值只读这张表**。
 *
 * 批准是**上限**，也是**内置规则**：读者没有逐条勾选权，能改的只有「应用内提示」「桌面提醒」两个总开关，
 * 以及情报模块那一页「哪三条情报推到手机」。投递表面 = 批准 ∩ 开关状态；中心恒在，不受开关影响。
 *
 * 改动任何一格都要回产品重签（平台 8 行＝通用模块产品经理，情报 7 行＝情报模块产品经理），
 * 不许在实现里顺手调。
 *
 * **本版 15 行（平台 8 + 情报 7）**，编号跳过 N4（`signal.interpreted` 本版不登记）、
 * N8（`calibration.result` 已撤回，编号不复用）。
 *
 * 2026-11-04 当天的三次收敛，读这张表前先看这里：
 * 1. **桌面只对「失败 / 需修正 / 系统状态」开放**（11 行）——读者原话：「不是都需要桌面通知的，
 *    不然我没打开应用还被轰炸」。信息类（模块信号、宏观事件）与完成类（日报完成）**不弹桌面**。
 * 2. **`platform.desktop.blocked`（P7）自己不走桌面**：它是「桌面没弹出来」这件事的结果，
 *    再投桌面就是「失败 → P7 → 投桌面 → 再失败」的自激循环。所以它只有 center + toast。
 * 3. **订阅层整体撤销**：不再有逐事件订阅表、不再有 `not-subscribed` 抑制；
 *    只有频道那三条（N2/N3/N5）有读者开关，存在通知设置的同一份 JSON 里（契约 §5.4）。
 */
import type { NotificationEventPolicy } from './notificationEventCatalog'

export const NOTIFICATION_EVENT_POLICY: NotificationEventPolicy = Object.freeze({
  // ── 平台 8 行（通用模块产品经理 2026-11-02 签；2026-11-04 按「桌面只给三类」补档） ──
  'platform.job.failed-terminal': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.job.repeated-failed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.analysis.quota-exhausted': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.provider.credential-invalid': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.provider.credential-recovered': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.channel.push-suspended': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.channel.push-resumed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  // 桌面自己失败时不再投桌面：见文件头第 2 条。
  'platform.desktop.blocked': { approvedDisruptionLevels: ['center', 'toast'], approvedBypassQuietHours: false },
  // ── 情报 7 行（情报模块产品经理 2026-11-02 签 7 行；2026-11-04 重签桌面与提示档） ──
  'market-intelligence.briefing.failed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  // 完成类：不弹桌面、不弹提示（只在应用内与中心出现），通道是上限，读者在情报页勾了才推。
  'market-intelligence.briefing.ready': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false },
  // 信息类：桌面撤档（读者不想被「没打开应用还轰炸」）；通道是上限，读者在情报页勾了才推。
  'market-intelligence.signal.triggered': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false },
  'market-intelligence.macro.event-landed': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false },
  'market-intelligence.source.consecutive-failed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.source.stale': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.timezone.invalid': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false }
})

/** 本版批准表行数：验收与守卫按它核对「15 行」。多一行少一行都要回产品重签。 */
export const NOTIFICATION_EVENT_POLICY_ROW_COUNT = Object.keys(NOTIFICATION_EVENT_POLICY).length
