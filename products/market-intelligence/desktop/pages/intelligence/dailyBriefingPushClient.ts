import type { NotificationDeliveryState } from '@platform/notifications/contracts/notificationContracts'

import { dailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'

/**
 * The reader's own push: publish the edition on screen, then push that record.
 *
 * The platform does the work (`redeliverPush` never creates a record, never rewrites its content and
 * never touches its count); this module only says *which edition* the reader is looking at, and turns
 * the answer back into something a card can show.
 *
 * No key is built here (契约 v2.32): the main process writes/locates the record and pushes it by its
 * `recordId`. A hand-built key is how a product ends up addressing another issue's record while the
 * reader sees an error about "this edition".
 */

export type BriefingPushEdition = Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US' }>

/**
 * Why the button cannot be pressed, or `null` when it can.
 *
 * Nine states in all — five a click can reach and four that disable it — and the four are kept apart
 * because their sentences are different: a missing channel is something the reader can fix, a missing
 * edition is something they can generate, and a non-primary language is a fact about this version.
 */
export type BriefingPushBlocked = 'generating' | 'no-edition' | 'not-ready' | 'non-primary-language'

export type BriefingPushOutcome =
  | Readonly<{ state: 'sent'; delivery: 'sent-accepted' | 'sent-unconfirmed' }>
  | Readonly<{ state: 'failed'; reason: BriefingPushFailure }>

/**
 * The ways a send can fail, in the reader's terms.
 *
 * `redeliver-*` is the platform's own vocabulary and never appears on screen; the mismatch case has its
 * own sentence because "you regenerated, so the phone has the older issue" is not a failure to send.
 */
export type BriefingPushFailure =
  | 'channel-not-configured'
  | 'channel-disconnected'
  | 'channel-rate-limited'
  | 'runtime-unavailable'
  | 'push-paused'
  | 'record-missing'
  | 'edition-mismatch'
  | 'surface-invalid'

/**
 * The channel the phone receives through, read from the platform rather than named here.
 *
 * `wired: undefined` means the platform answered without saying: the capabilities are unknown, so the
 * button stays pressable and a missing channel is reported by the send itself. Only an explicit
 * `false` disables it — "this build cannot send" is a claim, and a claim needs evidence.
 */
export type BriefingPushChannel = Readonly<{ wired: boolean | undefined; name: string | undefined }>

/**
 * 通道名从平台的投递设置里读（纯展示）；**发布本身走产品 IPC**——先写/更新记录再重投是主进程的事，
 * 渲染层不该自己拼那两步。
 */
type ChannelBridge = Readonly<{
  getDeliverySettings?: () => Promise<{ pushWired?: boolean; channels?: readonly unknown[] }>
}>

function channelBridge(): ChannelBridge | undefined {
  const platform = (globalThis as { window?: { platform?: { notifications?: unknown } } }).window?.platform
  return platform?.notifications as ChannelBridge | undefined
}

/** Whether this build can publish at all; the fourth disabled state reads it. */
export function briefingPushAvailable(): boolean {
  const products = (globalThis as { window?: { platform?: { products?: { invoke?: unknown } } } }).window?.platform?.products
  return typeof products?.invoke === 'function'
}

/**
 * Which channel would carry this publication, and whether the port that carries it is assembled.
 *
 * The name is the platform's own label for the channel the reader configured — never a product word and
 * never a channel brand: a hard-coded name is how a build keeps announcing one channel after the reader
 * switched to another. When several exist, the deliverable one is the one a send would reach.
 */
export async function readBriefingPushChannel(): Promise<BriefingPushChannel> {
  const bridge = channelBridge()
  if (!bridge) return { wired: false, name: undefined }
  if (typeof bridge.getDeliverySettings !== 'function') return { wired: undefined, name: undefined }
  try {
    const settings = await bridge.getDeliverySettings()
    const channels = Array.isArray(settings?.channels) ? settings.channels : []
    const named = channels.find((entry) => isRecord(entry) && entry.deliverable === true) ?? channels.find(isRecord)
    const name = isRecord(named) && typeof named.name === 'string' ? named.name.trim() : ''
    return {
      // Absent `pushWired` is not `false`: an older platform that does not answer the question must not
      // disable a button that would have worked.
      wired: typeof settings?.pushWired === 'boolean' ? settings.pushWired : undefined,
      name: name === '' ? undefined : name
    }
  } catch {
    return { wired: undefined, name: undefined }
  }
}

/**
 * Send the edition on screen.
 *
 * A rejection is mapped to one of the reader's reasons; every one of them is a sentence, never a code.
 * `sent-unconfirmed` is a success with its own wording: the platform's result says the request left but
 * no receipt came back, and calling that "sent" is what the copy forbids.
 */
export async function redeliverBriefingPush(edition: BriefingPushEdition): Promise<BriefingPushOutcome> {
  if (!briefingPushAvailable()) return { state: 'failed', reason: 'runtime-unavailable' }
  let result: unknown
  try {
    // 主进程的两步：先按这一版写/更新完成记录（只记不发），再重投那条记录。库里有记录时第一步
    // 只是合并，不会多一行；库里没有时它就补上，读者不必先去别处「生成一条通知」。
    result = await dailyBriefingClient.publishToPhone({ date: edition.date, periodId: edition.periodId, locale: edition.locale })
  } catch {
    return { state: 'failed', reason: 'runtime-unavailable' }
  }
  if (!isRecord(result)) return { state: 'failed', reason: 'runtime-unavailable' }
  if (result.kind === 'rejected') return { state: 'failed', reason: rejectionReason(result.reason) }
  if (result.kind !== 'accepted') return { state: 'failed', reason: 'runtime-unavailable' }
  const delivery = result.delivery as Partial<NotificationDeliveryState> | undefined
  // The success sentence reads the delivery state and nothing else — a port that answered "ok" without
  // a receipt is `sent-unconfirmed`, not a clean send.
  return delivery?.state === 'sent-accepted'
    ? { state: 'sent', delivery: 'sent-accepted' }
    : { state: 'sent', delivery: 'sent-unconfirmed' }
}

/** The platform's five rejections, in the reader's terms. */
function rejectionReason(code: unknown): BriefingPushFailure {
  switch (code) {
    case 'redeliver-target-missing': return 'record-missing'
    // 主进程先写后推之后，遇到的多半是「这一版根本还没生成」；读者要做的同一件事：先去生成。
    case 'edition-missing': return 'record-missing'
    case 'redeliver-edition-mismatch': return 'edition-mismatch'
    case 'redeliver-surface-invalid': return 'surface-invalid'
    case 'push-paused': return 'push-paused'
    case 'channel-missing': return 'channel-not-configured'
    default: return 'runtime-unavailable'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
