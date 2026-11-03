import type { PlatformText } from '../../../i18n/platformText'

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

export type ChannelLogSources = {
  operations?: readonly { id: string; action: string; createdAt: string }[]
  runtime?: readonly { id: string; code: string; createdAt: string }[]
  /** 发送失败的来源是**投递审计**（不是投递尝试）：一条审计一行，code 是闭集。 */
  deliveries?: readonly { id: string; code: string; createdAt: string }[]
}

const MAX_ROWS = 50

export function buildChannelLogRows(sources: ChannelLogSources, labels: Labels): ChannelLogRow[] {
  const rows: ChannelLogRow[] = []

  for (const entry of sources.operations ?? []) {
    rows.push({
      id: `op-${entry.id}`,
      at: entry.createdAt,
      level: 'INFO',
      text: `${labels.channelLogOperationPrefix}${labels.channelLogActionText[entry.action] ?? labels.channelLogsUnknownCode}`
    })
  }
  for (const entry of sources.runtime ?? []) {
    rows.push({
      id: `run-${entry.id}`,
      at: entry.createdAt,
      level: 'ERROR',
      text: `${labels.channelLogRuntimePrefix}${labels.channelLogRuntimeText[entry.code] ?? labels.channelLogsUnknownCode}`
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
