import type { ChannelExecutionClaim } from './ChannelInboundContracts'

export type ChannelDeliverySource = 'inbound-reply' | 'task-result' | 'agent-notify'
/**
 * Where one delivered message stands. NOT `TaskResultOutcome` (completed/failed/cancelled), which is
 * what happened to the task run and goes into `source_id`. The two never convert into each other;
 * they only meet as separate counts on the delivery-health panel.
 *
 * `sending` is an internal durable lease. Only its matching owner can record a result.
 */
export type ChannelDeliveryStatus = 'pending' | 'sending' | 'delivered' | 'failed' | 'unknown-after-send' | 'skipped'

/**
 * Why a delivery was skipped. A closed set on purpose: a skipped row without a reason tells the
 * user "it was skipped, do not ask" — and each reason needs a different next action.
 */
export type ChannelDeliverySkipReason =
  // Two different user actions: bind a channel, or enable the bound one.
  | 'delivery-no-target-bound'
  | 'delivery-target-disabled'
  | 'delivery-empty-output'
  | 'delivery-not-authorized'
  | 'delivery-retry-not-permitted'
  | 'delivery-owner-invalid'

/**
 * Runtime list of the closed reason set. The UI needs it to tell a reason it can explain from a
 * code it has never heard of, so the union above and this list must not drift.
 */
export const channelDeliverySkipReasons = [
  'delivery-no-target-bound',
  'delivery-target-disabled',
  'delivery-empty-output',
  'delivery-not-authorized',
  'delivery-retry-not-permitted',
  'delivery-owner-invalid'
] as const satisfies readonly ChannelDeliverySkipReason[]

export function isChannelDeliverySkipReason(value: string | null | undefined): value is ChannelDeliverySkipReason {
  return value != null && (channelDeliverySkipReasons as readonly string[]).includes(value)
}

export type ChannelDeliveryTransportResult =
  | { kind: 'delivered' }
  | { kind: 'failed'; code: ChannelDeliveryFailureCode }
  | { kind: 'unknown-after-send' }

export type ChannelDeliveryFailureCode =
  | 'delivery-host-unavailable'
  | 'delivery-permission-denied'
  | 'delivery-rate-limited'
  | 'delivery-provider-rejected'

export type ChannelDeliveryTransport = {
  send: (input: {
    channelId: string
    providerConversationKey: string
    text: string
    idempotencyKey: string
  }) => Promise<ChannelDeliveryTransportResult>
  typing?: (input: { channelId: string; providerConversationKey: string }) => Promise<void>
  supportsIdempotency: (channelId: string) => boolean
}

export type ChannelDeliveryRequest = {
  channelId: string
  agentId: string
  conversationId: string
  source: ChannelDeliverySource
  sourceId: string
  text: string
  executionClaim?: ChannelExecutionClaim
  retryUnknown?: boolean
}

export type ChannelDeliveryResult = {
  status: ChannelDeliveryStatus
  attemptId: string | null
  errorCode: string | null
}

export type ChannelDeliveryAttemptView = {
  id: string
  channelId: string
  agentId: string
  conversationId: string
  source: ChannelDeliverySource
  status: ChannelDeliveryStatus
  errorCode: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type ChannelDeliveryAuditView = {
  id: string
  channelId: string
  attemptId: string | null
  code: string
  createdAt: string
}
