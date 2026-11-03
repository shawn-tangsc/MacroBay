import { describeChannelManagementAudit } from '@platform/ai/agent-platform/channels/channelManagementAuditActions'
import {
  describeChannelRuntimeAudit,
  describeChannelRuntimeLifecycle,
  describeChannelTelegramFailure
} from '@platform/ai/agent-platform/channels/channelRuntimeAuditDescriptors'
import type { PlatformText } from '../../../i18n/platformText'

import { channelFailureReason } from './channelSettingsPresentation'

/**
 * 日志面板的行模型：三类来源合并成一条时间线，**每条正文都带类别前缀**。
 *
 * 三类是读者关心的三种问题：谁改了什么（操作）、为什么停了（运行异常）、为什么没发出去
 * （发送失败）。级别词固定大写——它们是日志术语，不翻译、也不换成图标。
 *
 * 码 → 人话只查闭集；查不到统一写「没有更多说明」，**原始码一个都不上屏**。
 */
export type ChannelLogLevel = 'INFO' | 'WARN' | 'ERROR'

export type ChannelLogRow = {
  id: string
  at: string
  level: ChannelLogLevel
  text: string
}

type Labels = PlatformText['settings']

/** 管理审计一行：启用失败时带 `code`（原因码），成功时没有。 */
export type ChannelLogOperationInput = { id: string; action: string; code?: string | null; createdAt: string }
/** 运行审计与投递审计一行：两者都必带一个码。 */
export type ChannelLogCodeInput = { id: string; code: string; createdAt: string }

export type ChannelLogSources = {
  /** 管理审计：`code` 在这一类里只在「启用失败」时有值（写的是原因码）。 */
  operations?: readonly ChannelLogOperationInput[]
  runtime?: readonly ChannelLogCodeInput[]
  /** 发送失败的来源是**投递审计**（不是投递尝试）：一条审计一行，code 是闭集。 */
  deliveries?: readonly ChannelLogCodeInput[]
}

const MAX_ROWS = 50

export function buildChannelLogRows(sources: ChannelLogSources, labels: Labels): ChannelLogRow[] {
  const rows: ChannelLogRow[] = []

  for (const entry of sources.operations ?? []) {
    // 动作码也只走闭集表；查不到才有兜底句，常用动作一个都不许落到它。
    const copyKey = describeChannelManagementAudit(entry.action)
    // 启用失败和启用成功是同一个动作码，区别只在 `code`：不把原因写进这一行，日志里就只剩
    // 「操作：启用了推送」，读者看不出这次其实没开成、更看不出为什么。
    const failedEnable = entry.action === 'request-enable' && typeof entry.code === 'string' && entry.code !== ''
    rows.push({
      id: `op-${entry.id}`,
      at: entry.createdAt,
      level: 'INFO',
      text: failedEnable
        ? `${labels.channelLogOperationPrefix}${labels.channelLogEnableFailedPrefix}${
            channelFailureReason(entry.code, labels) ?? labels.channelFailureReasonUnknown
          }`
        : `${labels.channelLogOperationPrefix}${
            copyKey === undefined ? labels.channelLogsUnknownCode : labels.channelLogActionText[copyKey]
          }`
    })
  }
  for (const entry of sources.runtime ?? []) {
    // 起停不是异常：走 INFO + 「运行：」前缀，与「运行异常：」分开。
    const lifecycle = describeChannelRuntimeLifecycle(entry.code)
    if (lifecycle !== undefined) {
      rows.push({
        id: `lifecycle-${entry.id}`,
        at: entry.createdAt,
        level: 'INFO',
        text: `${labels.channelLogLifecyclePrefix}${labels.channelLogLifecycleText[lifecycle.copyKey]}`
      })
      continue
    }
    // 镜像来的 Telegram 运行失败：先查这张表，否则会落到「没有更多说明」。
    const telegramFailure = describeChannelTelegramFailure(entry.code)
    if (telegramFailure !== undefined) {
      rows.push({
        id: `run-${entry.id}`,
        at: entry.createdAt,
        level: telegramFailure.level,
        text: `${labels.channelLogRuntimePrefix}${labels.channelLogTelegramFailureText[telegramFailure.copyKey]}`
      })
      continue
    }
    // 其余运行审计：级别与文案都由平台那张表决定：**查不到的码给 WARN + 兜底句**，宁可当提醒，不许当故障。
    const descriptor = describeChannelRuntimeAudit(entry.code)
    rows.push({
      id: `run-${entry.id}`,
      at: entry.createdAt,
      level: descriptor?.level ?? 'WARN',
      text: `${labels.channelLogRuntimePrefix}${
        descriptor === undefined ? labels.channelLogsUnknownCode : labels.channelLogRuntimeText[descriptor.copyKey]
      }`
    })
  }
  for (const entry of sources.deliveries ?? []) {
    // 「交出去了、拿不到回执」既不是成功也不是失败：它是「不确定」，不进「发送失败」那一类。
    // 面板上仍要能看见它，所以单独用 WARN 行，前缀也说「不确定」。
    const uncertain = entry.code === 'unknown-after-send'
    rows.push({
      id: `delivery-${entry.id}`,
      at: entry.createdAt,
      level: uncertain ? 'WARN' : 'ERROR',
      text: uncertain
        ? `${labels.channelLogUncertainPrefix}${labels.channelLogDeliveryText.unknownAfterSend}`
        : `${labels.channelLogDeliveryPrefix}${labels.channelLogDeliveryText[entry.code] ?? labels.channelLogsUnknownCode}`
    })
  }

  return rows.sort((left, right) => right.at.localeCompare(left.at)).slice(0, MAX_ROWS)
}
