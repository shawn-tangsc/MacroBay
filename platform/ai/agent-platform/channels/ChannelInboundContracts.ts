import { randomUUID } from 'node:crypto'

import type { ChannelPayloadCipher } from '../../../secrets/channels/channelCredentialContracts'
import type { ChannelConversationKind, ChannelInboundDisposition } from './channelContracts'

// Provider adapters must validate this ref before crossing the inbound boundary.
export type ChannelVerifiedInboundAttachment = {
  kind: 'image' | 'file'
  stableRef: string
  name?: string
  mimeType: string
  sizeBytes?: number
}

export type ChannelInboundFacts = {
  channelId: string
  generation: number
  providerEventKey: string
  providerMessageKey?: string
  providerConversationKey: string
  providerUserKey: string
  providerUserLabel?: string
  conversationKind: ChannelConversationKind
  mentionedBot: boolean
  text?: string
  attachments?: readonly ChannelVerifiedInboundAttachment[]
}

export type ChannelInboundRequest = ChannelInboundFacts & {
  acknowledge: () => Promise<void>
}

export type ChannelInboundResult = {
  disposition: ChannelInboundDisposition
  dispatchId?: string
}

// Recovery exposes ownership only. Payload becomes available after the final lifecycle gate.
export type ChannelExecutionClaim = {
  workItemId: string
  receiptId: string
  channelId: string
  dispatchId: string
  generation: number
  leaseToken: string
  leaseExpiresAt: string
}

export type ChannelDispatchAdmission = {
  workItemId: string
  receiptId: string
  channelId: string
  conversationId: string
  dispatchId: string
  generation: number
  ciphertext: Uint8Array
  keyRef: string
  keyRevision: number
}

export type ChannelDispatchFinalStatus = 'completed' | 'failed'

export type ChannelSessionFactory = {
  createForConversation: (input: { channelId: string; agentId: string }) => Promise<string>
  discardUnbound: (sessionId: string) => Promise<void>
  /** Optional existence probe; when provided, a deleted session is treated as unbound. */
  exists?: (sessionId: string) => Promise<boolean>
}

export type ChannelContentGuard = (facts: ChannelInboundFacts) => 'channel-content-rejected' | null

export type ChannelInboundPayload = {
  providerMessageKey: string | null
  providerUserKey: string
  text: string | null
  attachments: Array<{
    kind: 'image' | 'file'
    stableRef: string
    name: string | null
    mimeType: string
    sizeBytes: number | null
  }>
}

export type ChannelInboundEncryption = {
  cipher: ChannelPayloadCipher
}

export function createChannelDispatchId(): string {
  return `channel-dispatch:${randomUUID()}`
}

export function encodeChannelInboundPayload(facts: ChannelInboundFacts): Uint8Array {
  const payload: ChannelInboundPayload = {
    providerMessageKey: facts.providerMessageKey ?? null,
    providerUserKey: facts.providerUserKey,
    text: facts.text ?? null,
    attachments: (facts.attachments ?? []).map((attachment) => {
      if (!attachment.stableRef.trim() || !attachment.mimeType.trim()) {
        throw new Error('Channel inbound attachment is not a verified stable reference.')
      }
      return {
        kind: attachment.kind,
        stableRef: attachment.stableRef,
        name: attachment.name ?? null,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes ?? null
      }
    })
  }
  return new TextEncoder().encode(JSON.stringify(payload))
}

export function assertChannelInboundFacts(facts: ChannelInboundFacts): void {
  const required = [facts.channelId, facts.providerEventKey, facts.providerConversationKey, facts.providerUserKey]
  const hasInvalidAttachment = (facts.attachments ?? []).some((attachment) =>
    !attachment ||
    (attachment.kind !== 'image' && attachment.kind !== 'file') ||
    typeof attachment.stableRef !== 'string' || attachment.stableRef.length === 0 || attachment.stableRef.length > 512 ||
    typeof attachment.mimeType !== 'string' || attachment.mimeType.length === 0 || attachment.mimeType.length > 255 ||
    (attachment.name !== undefined && (typeof attachment.name !== 'string' || attachment.name.length > 255)) ||
    (attachment.sizeBytes !== undefined && (!Number.isSafeInteger(attachment.sizeBytes) || attachment.sizeBytes < 0))
  )
  if (
    required.some((value) => typeof value !== 'string' || value.length === 0 || value.length > 512) ||
    !Number.isSafeInteger(facts.generation) || facts.generation < 1 ||
    !['direct', 'group', 'channel'].includes(facts.conversationKind) ||
    typeof facts.mentionedBot !== 'boolean' ||
    (facts.text !== undefined && typeof facts.text !== 'string') ||
    (facts.providerUserLabel !== undefined && (typeof facts.providerUserLabel !== 'string' || facts.providerUserLabel.length > 128)) ||
    hasInvalidAttachment
  ) {
    throw new Error('Channel inbound facts are invalid.')
  }
}
