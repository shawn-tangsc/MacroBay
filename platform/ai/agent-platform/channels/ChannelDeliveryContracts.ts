import type { ChannelExecutionClaim } from './ChannelInboundContracts'

export type ChannelDeliverySource = 'inbound-reply' | 'task-result' | 'agent-notify'
// `sending` is an internal durable lease. Only its matching owner can record a result.
export type ChannelDeliveryStatus = 'pending' | 'sending' | 'delivered' | 'failed' | 'unknown-after-send' | 'skipped'

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
