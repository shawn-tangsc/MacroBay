import type { NotificationDeliveryState } from '@platform/notifications/contracts/notificationContracts'

/**
 * The reader's own push: one existing record, delivered to the phone once more.
 *
 * The platform does the work (`redeliverPush` never creates a record, never rewrites its content and
 * never touches its count); this module only turns "what is on screen" into the three values the
 * platform checks, and the answer back into something a card can show.
 *
 * The dedupe key is the day's, not the issue's: one completion record per day, and every language and
 * every regeneration writes into that same row. Sending the key with a period would silently address a
 * record that does not exist.
 */

export type BriefingPushEdition = Readonly<{ date: string; periodId: string; locale: string }>

/** The record this day's completion notice lives in. One key, one row, whoever wrote it. */
export function briefingPushDedupeKey(date: string): string {
  return `briefing-ready:${date}`
}

/** Which edition the reader is looking at: the platform refuses to push a different one. */
export function briefingPushEditionId(edition: BriefingPushEdition): string {
  return `${edition.date}:${edition.locale}:${edition.periodId}`
}

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

/**
 * The channel the phone receives through, read from the platform rather than named here.
 *
 * `wired: undefined` means the platform answered without saying: the capabilities are unknown, so the
 * button stays pressable and a missing channel is reported by the send itself. Only an explicit
 * `false` disables it — "this build cannot send" is a claim, and a claim needs evidence.
 */
export type BriefingPushChannel = Readonly<{ wired: boolean | undefined; name: string | undefined }>

/** The bridge, or nothing: a build without the notification runtime disables the button instead of throwing. */
type PushBridge = Readonly<{
  redeliverPush: (input: { dedupeKey: string; editionId: string; locale: string }) => Promise<unknown>
  getDeliverySettings?: () => Promise<{ pushWired?: boolean; channels?: readonly unknown[] }>
}>

function pushBridge(): PushBridge | undefined {
  const platform = (globalThis as { window?: { platform?: { notifications?: unknown } } }).window?.platform
  const notifications = platform?.notifications as Partial<PushBridge> | undefined
  return notifications && typeof notifications.redeliverPush === 'function' ? (notifications as PushBridge) : undefined
}

/** Whether this build can push at all; the fourth disabled state reads it. */
export function briefingPushAvailable(): boolean {
  return pushBridge() !== undefined
}

/**
 * Which channel would carry this publication, and whether the port that carries it is assembled.
 *
 * The name is the platform's own label for the channel the reader configured — never a product word and
 * never a channel brand: a hard-coded name is how a build keeps announcing one channel after the reader
 * switched to another. When several exist, the deliverable one is the one a send would reach.
 */
export async function readBriefingPushChannel(): Promise<BriefingPushChannel> {
  const bridge = pushBridge()
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
  const bridge = pushBridge()
  if (!bridge) return { state: 'failed', reason: 'runtime-unavailable' }
  let result: unknown
  try {
    result = await bridge.redeliverPush({
      dedupeKey: briefingPushDedupeKey(edition.date),
      editionId: briefingPushEditionId(edition),
      locale: edition.locale
    })
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
    case 'redeliver-edition-mismatch': return 'edition-mismatch'
    case 'redeliver-surface-invalid': return 'runtime-unavailable'
    case 'push-paused': return 'push-paused'
    case 'channel-missing': return 'channel-not-configured'
    default: return 'runtime-unavailable'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
