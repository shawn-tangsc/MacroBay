/**
 * 平台事件声明表（契约 §2）：平台自己产生的 10 条通知事件（P8 于 2026-11-04 新增；P9 于 2026-11-06 签）。
 *
 * 与产品 manifest 里的声明**同形**，只是声明者固定为 `platform`；批准值不在这里——
 * 生效表面只读 `notificationEventPolicy.ts` 的批准表（契约 §4：「生效值只读批准表」）。
 *
 * 键名由事件 id 机械生成（`notificationEventTitleKey` / `notificationEventReasonKey`），
 * 句子归文案表；这里一条句子都不写，免得两处都能改。
 */
import type { NotificationEventDeclaration } from './notificationEventCatalog'

/** 标题键：`notification.event.<event id>.title`。同一处生成，调用点不手拼。 */
export function notificationEventTitleKey(eventTypeId: string): string {
  return `notification.event.${eventTypeId}.title`
}

/** 理由键：`notification.event.<event id>.reason`。 */
export function notificationEventReasonKey(eventTypeId: string): string {
  return `notification.event.${eventTypeId}.reason`
}

/**
 * 正文键：`notification.event.<event id>.body`；带变体时是 `.body.<variant>`。
 *
 * 与标题/理由同源：产品声明一条事件时，四个键都由这里生成，调用点不手拼——
 * 手写的键在事件改名时不会有人同步，目录解析出来就会落空。
 */
export function notificationEventBodyKey(eventTypeId: string, variant?: string): string {
  const base = `notification.event.${eventTypeId}.body`
  return variant === undefined ? base : `${base}.${variant}`
}


/**
 * 声明一条平台事件。正文两种写法互斥：默认一句 `…body`；给了 `bodyVariants` 就只有
 * `…body.<variant>`——同时声明基础句会让文案门禁要求一句永远用不到的句子（变体表一旦存在，
 * 没选变体的提交会被拒成 `unknown-body-variant`，基础句没有消费者）。
 */
function declaration(
  id: string,
  input: Omit<NotificationEventDeclaration, 'id' | 'titleKey' | 'bodyKey' | 'reasonKey' | 'bodyKeyByVariant'> & {
    bodyVariants?: readonly string[]
  }
): NotificationEventDeclaration {
  const { bodyVariants, ...rest } = input
  return {
    id,
    titleKey: notificationEventTitleKey(id),
    reasonKey: notificationEventReasonKey(id),
    ...(bodyVariants
      ? { bodyKeyByVariant: Object.fromEntries(bodyVariants.map((variant) => [variant, notificationEventBodyKey(id, variant)])) }
      : { bodyKey: notificationEventBodyKey(id) }),
    ...rest
  }
}

export const PLATFORM_NOTIFICATION_EVENTS: readonly NotificationEventDeclaration[] = Object.freeze([
  // P1 任务跑到终态仍失败：同一任务同一天一条、次数累加（`condition` + 24h 窗，跨天重算）。
  declaration('platform.job.failed-terminal', {
    category: 'failure',
    requiresUserAction: true,
    requestedDisruptionLevels: ['toast', 'desktop'],
    dedupeKeyTemplate: 'job-failed:{definitionId}:{date}',
    dedupeUnit: 'condition',
    conditionWindowMs: 86_400_000
  }),
  // P2 同一任务连续 3 次终态失败：只通知、不暂停任务；同一天同一任务一条。
  declaration('platform.job.repeated-failed', {
    category: 'needs-action',
    requiresUserAction: true,
    requestedDisruptionLevels: ['desktop'],
    dedupeKeyTemplate: 'job-repeated:{definitionId}:{date}',
    dedupeUnit: 'occurrence'
  }),
  // P3 分析额度用尽：同一天只发一次，不随每次被拒重复。
  declaration('platform.analysis.quota-exhausted', {
    category: 'needs-action',
    requiresUserAction: false,
    requestedDisruptionLevels: ['toast'],
    dedupeKeyTemplate: 'quota-exhausted:{date}',
    dedupeUnit: 'occurrence'
  }),
  // P4a 供应商凭据失效：同一供应商 1 小时内合并；恢复是独立事件，不改这条的正文。
  declaration('platform.provider.credential-invalid', {
    category: 'needs-action',
    requiresUserAction: true,
    requestedDisruptionLevels: ['toast', 'desktop'],
    dedupeKeyTemplate: 'credential-invalid:{providerId}',
    dedupeUnit: 'condition',
    conditionWindowMs: 3_600_000
  }),
  // P4b 凭据恢复：一天最多一条；独立 id、独立记录，不弹不叫醒。
  declaration('platform.provider.credential-recovered', {
    category: 'completed',
    requiresUserAction: false,
    requestedDisruptionLevels: [],
    dedupeKeyTemplate: 'credential-recovered:{providerId}:{day}',
    dedupeUnit: 'occurrence'
  }),
  // P6a 通道连续失败、自动暂停推送：绝不发到通道本身（申请档位里没有 channel）。
  declaration('platform.channel.push-suspended', {
    category: 'needs-action',
    requiresUserAction: true,
    requestedDisruptionLevels: ['toast', 'desktop'],
    dedupeKeyTemplate: 'push-suspended:{channelId}',
    dedupeUnit: 'condition',
    conditionWindowMs: 86_400_000
  }),
  // P6b 通道恢复：一天最多一条。
  declaration('platform.channel.push-resumed', {
    category: 'completed',
    requiresUserAction: false,
    requestedDisruptionLevels: [],
    dedupeKeyTemplate: 'push-resumed:{channelId}:{day}',
    dedupeUnit: 'occurrence'
  }),
  // P7 桌面通知没弹出来：只说观测到的事实，不猜为什么；不合并，随事件本身。
  declaration('platform.desktop.blocked', {
    category: 'reminder',
    requiresUserAction: false,
    requestedDisruptionLevels: [],
    dedupeKeyTemplate: 'desktop-blocked:{recordId}',
    dedupeUnit: 'occurrence',
  }),
  // P8 频道连不上（2026-11-04 用户拍板新增，需求 v2.17 §11）：**自动重连失败之后**提交一次，
  // 键带频道 id + 断开起始时刻，同一次断开只留一条；原因两档（网络连不上 / 代理这一跳没连上）
  // 就是正文变体名。**不含 channel**：这是本机状态，不该再推到手机。
  declaration('platform.channel.connection-lost', {
    category: 'needs-action',
    requiresUserAction: true,
    requestedDisruptionLevels: ['toast', 'desktop'],
    dedupeKeyTemplate: 'channel-lost:{channelId}:{disconnectedAt}',
    dedupeUnit: 'occurrence',
    bodyVariants: ['network', 'proxy']
  }),
  // P9 读者自己点的那次分析失败（2026-11-06 通用模块产品经理签；需求 r23 档 0′）：
  // **每次必回**，去重键就是那次运行——连点三次失败是三条，不是一条。
  // 正文只放人话（`{reason}` 由生产者按细分码映射、按读者语言取句），细分码只经深链进运行记录：
  // 原始报错里可能带 URL 或密钥片段，一个字都不许进正文。
  //
  // **故意不写 `dailyLimit`**：读者点了「立即分析」、等了几分钟、结果没成，这时候再用
  // 「今天通知额度用完了」把他挡掉，比完全不通知更糟——他做了一次动作，等的是一个回执。
  // 所以这条的豁免靠「声明里没写上限」（可选字段，没写就不判），不靠某个特判分支；
  // 谁以后想给它「顺手统一」补一个数，先读上面这句。
  declaration('platform.analysis.manual-failed', {
    category: 'failure',
    requiresUserAction: true,
    requestedDisruptionLevels: ['desktop'],
    dedupeKeyTemplate: 'manual-failed:{runId}',
    dedupeUnit: 'occurrence'
  }),
])
