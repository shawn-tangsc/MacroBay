/**
 * runtime 的投递面（契约 §16.3 / 通道方案 §2.2）：把一条**首次提交**的记录投出去，并把每个
 * 表面的证据写回同一条记录。合并/重复提交不重推——这一步只被 `submit()` 的新记录分支调用一次。
 *
 * 文案与短编号在这里解析一次，四个钩子拿同一份 `content`；端口不再解析、不再拼时刻。
 */
import { notificationCopyText, resolveNotificationCopyText } from '../../i18n/notificationCopy'
import type { NotificationCopyPort } from '../contracts/notificationCopyPort'
import type {
  NotificationPushBackoff,
  NotificationRecord,
  NotificationRuntimeSettings
} from '../contracts/notificationContracts'
import {
  routeTransientDelivery,
  type DeliveryHooks,
  type NotificationClock,
  type NotificationDeliveryContent
} from './notificationRouting'

export type NotificationPushTransition = { kind: 'paused' | 'resumed'; channelId: string }

export type NotificationDeliveryInput = {
  deliveryHooks?: DeliveryHooks
  clock: NotificationClock
  getLanguage?: () => Promise<'zh-CN' | 'en-US'>
  copy?: NotificationCopyPort
  now: () => string
}

export function createNotificationDelivery(input: NotificationDeliveryInput) {
  async function resolveContent(record: NotificationRecord): Promise<NotificationDeliveryContent> {
    const language = (await input.getLanguage?.()) ?? 'zh-CN'
    const fallback = language === 'en-US' ? 'A notification' : '有一条通知'
    const resolve = (
      key: NotificationRecord['titleKey'] | undefined,
      params: Readonly<Record<string, string>> | undefined
    ): string => {
      if (key === undefined) return ''
      const ref = record.productId === undefined
        ? { scope: 'platform' as const, key, ...(params === undefined ? {} : { params }) }
        : { scope: 'product' as const, productId: record.productId, key, ...(params === undefined ? {} : { params }) }
      const resolved = input.copy?.resolve(ref, language)
      if (typeof resolved === 'string' && resolved.length > 0) return resolved
      const text = notificationCopyText(language, key)
      if (typeof text !== 'string' || text.length === 0) return fallback
      // 参数缺失时不许把 `{taskName}` 印到读者面前：回退兜底句。
      const filled = resolveNotificationCopyText(language, text, params ?? {})
      return /\{\w+\}/.test(filled) ? fallback : filled
    }
    return {
      title: resolve(record.titleKey, record.titleParams),
      body: resolve(record.bodyKey, record.bodyParams),
      reason: resolve(record.reasonKey, record.reasonParams),
      ...(record.deeplink === undefined ? {} : { deeplink: record.deeplink }),
      shortId: record.id.slice(0, 8)
    }
  }

  /**
   * 只在这一步投递一次（契约 §16.3「合并不重推」）。跳过不算失败：该表面不写 delivery 条目；
   * `unknown-after-send` 是独立原因码，不能写成「没发到手机」。
   */
  async function deliverNewRecord(
    record: NotificationRecord,
    settings: NotificationRuntimeSettings,
    pushBackoff: Readonly<Record<string, NotificationPushBackoff>>
  ): Promise<{
    record: NotificationRecord
    pushBackoff: Readonly<Record<string, NotificationPushBackoff>>
    transition?: NotificationPushTransition
  }> {
    const content = await resolveContent(record)
    const attempts = await routeTransientDelivery(record, settings, input.deliveryHooks ?? {}, input.clock, content)
    const delivery: NotificationRecord['delivery'] = { ...record.delivery }
    for (const attempt of attempts) {
      if (attempt.channel !== 'toast' && attempt.channel !== 'popup' && attempt.channel !== 'desktop') continue
      if (attempt.result === 'skipped') {
        delete delivery[attempt.channel]
        continue
      }
      delivery[attempt.channel] = {
        state: attempt.result === 'failed' ? 'failed' : 'sent-accepted',
        at: attempt.attemptedAt,
        ...(attempt.reason === undefined ? {} : { reason: attempt.reason })
      }
    }

    const nextBackoff: Record<string, NotificationPushBackoff> = { ...pushBackoff }
    let transition: NotificationPushTransition | undefined
    if (delivery.push?.state === 'queued') {
      const at = input.now()
      const channelId = settings.push.channelId
      const current = channelId === null ? undefined : pushBackoff[channelId]
      if (channelId === null || !input.deliveryHooks?.push) {
        delivery.push = { state: 'failed', reason: 'push-unavailable', at }
      } else if (current?.pausedUntil !== null && current?.pausedUntil !== undefined && current.pausedUntil > at) {
        // 熔断窗口内不发：写独立原因码，不调用端口（通道方案 §3）。
        delivery.push = { state: 'failed', reason: 'push-backoff', at }
      } else {
        const result = await input.deliveryHooks.push({ ...record, delivery }, content)
        if (result.ok) {
          if (current?.pausedUntil !== null && current?.pausedUntil !== undefined) {
            transition = { kind: 'resumed', channelId }
          }
          nextBackoff[channelId] = { channelId, failures: 0, pausedUntil: null }
          delivery.push = {
            state: 'sent-accepted',
            at,
            ...(result.messageId === undefined ? {} : { messageId: result.messageId })
          }
        } else {
          const failures = (current?.failures ?? 0) + 1
          const pausedUntil = failures >= 3
            ? new Date(Date.parse(at) + 30 * 60_000).toISOString()
            : null
          nextBackoff[channelId] = { channelId, failures, pausedUntil }
          if (pausedUntil !== null && (current?.pausedUntil ?? null) !== pausedUntil) {
            transition = { kind: 'paused', channelId }
          }
          delivery.push = { state: 'failed', reason: result.reason ?? 'channel-rejected', at }
        }
      }
    }
    return { record: { ...record, delivery }, pushBackoff: nextBackoff, ...(transition === undefined ? {} : { transition }) }
  }

  return { resolveContent, deliverNewRecord }
}

export type NotificationDeliverySurface = ReturnType<typeof createNotificationDelivery>
