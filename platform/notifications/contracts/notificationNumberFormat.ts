/**
 * 数字参数在**读的那一刻**按语言格式化（契约 v2.42 的第三种参数变体）。
 *
 * 两条硬规矩：
 * - **符号不进正文**：这里只出「绝对值 + 单位」，方向由模板里的「净流出 / 跌 / 放大」说。
 *   所以 `-420_000_000` 与 `420_000_000` 在这里是同一个结果——正负号归文案，不归格式化器。
 * - **只有这一处格式化**：提交时把数字拼成「−4.2 亿美元」就是把语言拍死在数据里，
 *   切语言后历史通知不会跟着变（和作业名冻成一种语言是同一个病）。
 */
import type { NotificationCopyLanguage } from '../../i18n/notificationCopy'

export type NotificationNumberKind = 'usd' | 'pct' | 'multiple' | 'count'

export type NotificationCopyNumber = {
  /** 数值本身；正负号由模板负责，这里只取绝对值。 */
  number: number
  kind: NotificationNumberKind
}

export function formatNotificationNumber(
  value: NotificationCopyNumber,
  language: NotificationCopyLanguage
): string | null {
  if (!Number.isFinite(value.number)) return null
  const magnitude = Math.abs(value.number)
  switch (value.kind) {
    case 'usd':
      return language === 'en-US' ? formatUsdEn(magnitude) : formatUsdZh(magnitude)
    case 'pct':
      return `${trim(magnitude)}%`
    case 'multiple':
      return language === 'en-US' ? `${trim(magnitude)}×` : `${trim(magnitude)} 倍`
    case 'count':
      return String(Math.round(magnitude))
    default:
      return null
  }
}

/** 中文按「亿 / 万 / 元」，与读者在面板上看到的读法一致。 */
function formatUsdZh(magnitude: number): string {
  if (magnitude >= 100_000_000) return `${trim(magnitude / 100_000_000)} 亿美元`
  if (magnitude >= 10_000) return `${trim(magnitude / 10_000)} 万美元`
  return `${trim(magnitude)} 美元`
}

function formatUsdEn(magnitude: number): string {
  if (magnitude >= 1_000_000_000) return `$${trim(magnitude / 1_000_000_000)}B`
  if (magnitude >= 1_000_000) return `$${trim(magnitude / 1_000_000)}M`
  if (magnitude >= 1_000) return `$${trim(magnitude / 1_000)}K`
  return `$${trim(magnitude)}`
}

/** 整数不拖 `.0`（「成交放大 3 倍」不该写成「3.0 倍」），非整数保留一位。 */
function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
