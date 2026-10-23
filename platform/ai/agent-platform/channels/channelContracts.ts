import type { PlatformWebSocketConstructor } from '../../../network/platformWebSocket'
import type { ProxyMode } from '../../../settings/schema/appSettings'

import type { AgentChannelType } from '../schemas/channelSchemas'

export type ChannelConversationKind = 'direct' | 'group' | 'channel'

export type ChannelInboundAttachment = {
  kind: 'image' | 'file'
  providerAttachmentId: string
  name?: string
  mimeType: string
  sizeBytes?: number
  downloadUrl?: string
}

// Adapters supply only facts received from the provider. Platform code owns routing and policy.
export type ChannelIncomingEvent = {
  providerEventId: string
  providerMessageId?: string
  conversationKey: string
  conversationKind: ChannelConversationKind
  userKey: string
  userLabel?: string
  text?: string
  attachments?: ChannelInboundAttachment[]
  mention?: {
    mentionedBot: boolean
    source: 'provider'
  }
}

export type ChannelInboundDisposition = 'acknowledged' | 'duplicate' | 'ignored' | 'retry'

export type ChannelInboundDelivery = {
  event: ChannelIncomingEvent
  acknowledge: () => Promise<void>
}

export type ChannelInboundListener = (
  event: ChannelIncomingEvent
) => Promise<ChannelInboundDisposition>

export function channelInboundDispositionRequiresAcknowledgement(
  disposition: ChannelInboundDisposition
): boolean {
  return disposition !== 'retry'
}

/**
 * Adapters use this boundary to defer provider acknowledgement until platform
 * receipt and policy handling has reached a terminal result.
 */
export async function dispatchChannelInboundDelivery(
  delivery: ChannelInboundDelivery,
  listener: ChannelInboundListener
): Promise<ChannelInboundDisposition> {
  const disposition = await listener(normalizeChannelIncomingEvent(delivery.event))
  if (channelInboundDispositionRequiresAcknowledgement(disposition)) {
    await delivery.acknowledge()
  }
  return disposition
}

/** Keeps adapter-provided input limited to the normalized provider-fact contract. */
export function normalizeChannelIncomingEvent(event: ChannelIncomingEvent): ChannelIncomingEvent {
  return {
    providerEventId: event.providerEventId,
    ...(event.providerMessageId ? { providerMessageId: event.providerMessageId } : {}),
    conversationKey: event.conversationKey,
    conversationKind: event.conversationKind,
    userKey: event.userKey,
    ...(event.userLabel ? { userLabel: event.userLabel } : {}),
    ...(event.text !== undefined ? { text: event.text } : {}),
    ...(event.attachments ? {
      attachments: event.attachments.map((attachment) => ({
        kind: attachment.kind,
        providerAttachmentId: attachment.providerAttachmentId,
        ...(attachment.name ? { name: attachment.name } : {}),
        mimeType: attachment.mimeType,
        ...(attachment.sizeBytes !== undefined ? { sizeBytes: attachment.sizeBytes } : {}),
        ...(attachment.downloadUrl ? { downloadUrl: attachment.downloadUrl } : {})
      }))
    } : {}),
    ...(event.mention ? { mention: { ...event.mention } } : {})
  }
}

export type ChannelRuntimeErrorCode =
  | 'channel-credential-invalid'
  | 'channel-credential-expired'
  | 'channel-agent-missing'
  | 'channel-autonomy-required'
  | 'channel-policy-denied'
  | 'channel-mention-required'
  | 'channel-duplicate-event'
  | 'channel-network-unavailable'
  | 'channel-proxy-unavailable'
  | 'channel-rate-limited'
  | 'channel-provider-rejected'
  | 'channel-stale-generation'
  | 'channel-delivery-failed'
  | 'channel-delivery-unknown'
  | 'channel-support-evidence-missing'
  | 'channel-migration-required'

export type ChannelRuntimeSafeStatus = {
  state: 'inactive' | 'connecting' | 'connected' | 'error'
  lifecycle: 'connecting' | 'ready' | 'reconnecting' | 'awaiting-credential' | 'awaiting-qr-scan' | 'terminal-error'
  errorCode?: ChannelRuntimeErrorCode
  retryable?: boolean
  updatedAt: number
}

export type ChannelRuntimeStatusListener = (status: ChannelRuntimeSafeStatus) => void

export type ChannelRuntimeHost = {
  connect: (signal: AbortSignal) => Promise<void>
  close: (reason?: string) => Promise<void>
  subscribeToIncoming: (listener: ChannelInboundListener) => () => void
  sendMessage: (conversationKey: string, text: string) => Promise<void>
  sendTypingIndicator?: (conversationKey: string) => Promise<void>
  onStreamUpdate?: (conversationKey: string, fullText: string) => Promise<void>
  onStreamComplete?: (conversationKey: string, fullText: string) => Promise<boolean>
  onStreamError?: (conversationKey: string, text: string) => Promise<void>
  subscribeToRuntimeStatus: (listener: ChannelRuntimeStatusListener) => () => void
}

export type ChannelTransportDependencies = {
  getPlatformFetch: () => typeof fetch
  createPlatformWebSocket: PlatformWebSocketConstructor
  proxyMode: ProxyMode
}

export type ChannelCapabilities = {
  receiveText: boolean
  receiveImages: boolean
  receiveFiles: boolean
  sendText: boolean
  streaming: boolean
  typingIndicator: boolean
  nativeCommands: boolean
  groupMention: boolean
  qrEnrollment: boolean
  reconnect: boolean
}

export type ChannelAdapterSupportStatus = 'supported' | 'planned' | 'experimental' | 'blocked'

export type ChannelAdapterAcceptanceEntry = {
  adapterType: AgentChannelType
  adapterVersion: string
  status: ChannelAdapterSupportStatus
  capabilities: ChannelCapabilities
  receiveSmokeAt: string | null
  sendSmokeAt: string | null
  reconnectSmokeAt: string | null
  restartRecoveryAt: string | null
  proxySmokeAt: string | null
  credentialRotationAt: string | null
  disableDeleteFencingAt: string | null
  capabilityEvidence: Partial<Record<keyof ChannelCapabilities, string>>
}

export const channelOptionalCapabilities = [
  'receiveImages',
  'receiveFiles',
  'streaming',
  'typingIndicator',
  'nativeCommands',
  'groupMention',
  'qrEnrollment'
] as const satisfies readonly (keyof ChannelCapabilities)[]
