/**
 * 平台批准表（契约 §4.1，**已签 2026-11-04**）：**生效值只读这张表**。
 *
 * 批准是**上限**，也是**内置规则**：读者没有逐条勾选权，能改的只有「应用内提示」「桌面提醒」两个总开关，
 * 以及情报模块那一页「哪三条情报推到手机」。投递表面 = 批准 ∩ 开关状态；中心恒在，不受开关影响。
 *
 * 改动任何一格都要回产品重签（平台 13 行＝通用模块产品经理，情报 8 行＝情报模块产品经理），
 * 不许在实现里顺手调。
 *
 * **本版 21 行（平台 13 + 情报 8）**，编号跳过 N4（`signal.interpreted` 本版不登记）、
 * N8（`calibration.result` 已撤回，编号不复用）。P8「频道连不上」是 2026-11-04 用户实测后新增的
 * 第 16 行（需求 v2.17 §11）：原来的 15 条里没有「收消息那条路断了」，最接近的 P6a 讲的是发不出去。
 * **P9「手动分析失败」是 2026-11-06 新增的第 17 行**（需求 r22 §2 档 0′）：读者自己点的那次失败
 * 每次都要回一条，所以去重键是那次运行、不是那一天；批准中心 + 桌面，**不批提示**——桌面与提示
 * 本来就互斥（桌面优先），读者人就在面板前，桌面弹不出来时中心那条记录与运行记录页已经够了。
 * **N10「舆情强度中以上」是 2026-11-06 新增的第 18 行**（情报需求 v3.58 §十四、契约 §4.1）：
 * 只批 `center` + `channel`——信息类，桌面与提示两档从来没批过，补上去等于替读者决定被打扰；
 * 手机这一档**有每日额度**（每天 5 条，超额只进中心并在列表里写明今天还有几条没推），额度不在这张表里判。
 * 它的读者开关也不在契约 §5.4 那张订阅表里，走舆情自己那份水位（没按过 = 一条都不推）。
 *
 * 2026-11-04 当天的三次收敛，读这张表前先看这里：
 * 1. **桌面只对「失败 / 需修正 / 系统状态」开放**（16 行）——读者原话：「不是都需要桌面通知的，
 *    不然我没打开应用还被轰炸」。信息类（模块信号、宏观事件）与完成类（日报完成）**不弹桌面**。
 * 2. **`platform.desktop.blocked`（P7）自己不走桌面**：它是「桌面没弹出来」这件事的结果，
 *    再投桌面就是「失败 → P7 → 投桌面 → 再失败」的自激循环。所以它只有 center + toast。
 * 3. **订阅层整体撤销**：不再有逐事件订阅表、不再有 `not-subscribed` 抑制；
 *    只有频道那三条（N2/N3/N5）有读者开关，存在通知设置的同一份 JSON 里（契约 §5.4）。
 * 4. **2026-11-08 用户拍板：自检事件可穿透免打扰**——全表只有 `platform.notification.self-test` 一行
 *    `approvedBypassQuietHours: true`（依据：读者亲手点的诊断，不算系统打扰），其余一律 false；
 *    它同时也是唯一一行四档全批（中心/提示/桌面/手机），因为全表没有一条真实事件同时批四档，
 *    借真实事件自检必然只测一部分。三层缺一不生效：声明 `diagnostic` + 本表批准 + 提交带 `test` 命名空间。
 */
import type { NotificationEventPolicy } from './notificationEventCatalog'

export const NOTIFICATION_EVENT_POLICY: NotificationEventPolicy = Object.freeze({
  // ── 平台 13 行（通用模块产品经理 2026-11-02 签 8 行；2026-11-04 按「桌面只给三类」补档，同日加 P8；2026-11-06 加 P9） ──
  'platform.job.failed-terminal': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.job.repeated-failed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.analysis.quota-exhausted': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.provider.credential-invalid': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.provider.credential-recovered': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.channel.push-suspended': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.channel.push-resumed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  // 桌面自己失败时不再投桌面：见文件头第 2 条。
  // 自检：**唯一一行四档全批 + 唯一一行批准穿透免打扰**（签署：通用模块产品经理，2026-11-08 用户拍板）。
  // 四档全批的理由：全表没有任何一条真实事件同时批了四档，借真实事件自检必然只测一部分。
  // 穿透免打扰的理由：「读者亲手点的诊断，不算系统打扰」；装配期对非诊断事件申请穿透直接报错。
  'platform.notification.self-test': { approvedDisruptionLevels: ['center', 'toast', 'desktop', 'channel'], approvedBypassQuietHours: true },
  'platform.desktop.blocked': { approvedDisruptionLevels: ['center', 'toast'], approvedBypassQuietHours: false },
  // P8 频道连不上（2026-11-04 用户拍板新增；通用 PM 需求 v2.17 §11 签字）：
  // 系统状态类，与该表其它系统状态同档；**不含 channel**——本机状态不该再推到手机。
  'platform.channel.connection-lost': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  // P9 手动分析失败（2026-11-06 通用模块产品经理签）：失败类，桌面允许；**不批提示**——桌面与提示
  // 互斥且桌面优先，同一次失败不该在应用内再吵一遍。读者要的是「我点的那次到底怎么了」，
  // 那条答案在中心与运行记录页里，不在提示条上。
  'platform.analysis.manual-failed': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  // P10 连续失败（r23 档 1）：需修正类，桌面允许；独立额度每天 2 条 + 6 小时冷却，在平台判。
  'platform.analysis.repeated-failure': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  // P11 被放弃（r23 档 2）：失败类，桌面允许；独立额度每天 2 条。
  'platform.analysis.attempt-abandoned': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  // P12 恢复（r23 档 3）：完成类，**不批桌面**——桌面只对失败/需修正开放，这条不为例外。
  'platform.analysis.recovered': { approvedDisruptionLevels: ['center', 'toast'], approvedBypassQuietHours: false },
  // ── 情报 8 行（情报模块产品经理 2026-11-02 签 7 行；2026-11-04 重签桌面与提示档；2026-11-06 加 N10） ──
  'market-intelligence.briefing.failed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  // 完成类：**桌面批准、提示不批**（2026-11-06 用户拍板「日报生成要桌面通知」；11-04 的原话是
  // 「不弹应用内提示」，今天只说了桌面，没说要提示——那是另一种打扰，不能顺手留下）。
  // 通道仍是上限，读者在情报页勾了才推。
  'market-intelligence.briefing.ready': { approvedDisruptionLevels: ['center', 'channel', 'desktop'], approvedBypassQuietHours: false },
  // 信息类：桌面撤档（读者不想被「没打开应用还轰炸」）；通道是上限，读者在情报页勾了才推。
  'market-intelligence.signal.triggered': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false },
  // **组键 `calendar-events`**（契约 §5.5）：日历「开始前」（N11）与「发生后」（本条）是同一件事的两个
  // 时间点，读者只该勾一次。组里可用面取两条批准表的**交集**，所以两行的档位必须一致——
  // 只改其中一行，交集就会变，绿着一半却只对一条生效，那正是要拦的（`notificationEventPolicy.test` 钉住）。
  'market-intelligence.macro.event-landed': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false, surfaceGroup: 'calendar-events' },
  // N11 日历「开始前」（契约 §4.1 已批，情报需求 v3.78 §十六）：**与 N5 同一个组键** `calendar-events`，
  // 所以两行的档位形状必须一致——只改一行，组选择取的交集就变，勾了「应用内提示」会只闪一条。
  // 桌面不批：读者要的话说一句，两条一起批。
  'market-intelligence.calendar.event-upcoming': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false, surfaceGroup: 'calendar-events' },
  'market-intelligence.source.consecutive-failed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.source.stale': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.timezone.invalid': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  // N10 舆情「强度中以上」（契约 §4.1 已批；情报需求 v3.58 §十四）：只批 center + channel。
  // 桌面与提示两档没批过，也不许顺手补——信息类按读者原话「没打开应用还被轰炸」是明确不要的。
  // 手机这一档不是无限量：每天 5 条（读者时区），超出的只进中心并在列表里写明还有几条没推。
  'market-intelligence.sentiment.alert': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false },
  // AI 分析结论：用户 2026-11-08 问起「为什么不推手机」后补通。**真的到手机**（不是只到中心）：
  // `channel` 必须批；`center` 是「中心必达」。按次收窄由 `narrowedDisruptionLevels` 决定，
  // 引擎只许收窄、不许放大（见 `notificationSubmitPlan.ts`）。
  'market-intelligence.analysis.conclusion': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false }
})

/** 本版批准表行数：验收与守卫按它核对「21 行」。多一行少一行都要回产品重签。 */
export const NOTIFICATION_EVENT_POLICY_ROW_COUNT = Object.keys(NOTIFICATION_EVENT_POLICY).length
