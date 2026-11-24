import { randomUUID } from 'node:crypto'

import type { ChannelPayloadCipher } from '../../../secrets/channels/channelCredentialContracts'
import type { ChannelConversationKind, ChannelInboundDisposition } from './channelContracts'

// Provider adapters must validate this ref before crossing the inbound boundary.
/**
 * 附件字节的落盘状态（0.4.5）。三态分开，是因为读者看到的话不同：
 * - `stored`：字节在本地，随时能取（消息行只留 `fileRef`，不留字节）；
 * - `unavailable`：这类附件我们不收（超 2MB / 不在 png·jpeg·webp 白名单 / 引用形状不对）——
 *   重试没用，读者需要换一张图；
 * - `unreadable`：这次没取到（下载失败 / 写盘校验失败）——**可重试**，不许说成「没有」。
 *
 * 没有这一项 = 老记录，或者这个平台只登记引用、字节从不落盘（v1 只有 Telegram 真拉取）。
 */
export type ChannelInboundAttachmentCaptureState =
  | { state: 'stored'; fileRef: string }
  | { state: 'unavailable'; reasonCode: 'attachment-too-large' | 'attachment-unsupported-type' | 'attachment-ref-invalid' }
  | { state: 'unreadable'; reasonCode: 'attachment-download-failed' | 'attachment-store-failed' }

export type ChannelVerifiedInboundAttachment = {
  kind: 'image' | 'file'
  stableRef: string
  name?: string
  mimeType: string
  sizeBytes?: number
  capture?: ChannelInboundAttachmentCaptureState
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
  /**
   * 回一句话给发起人（宿主提供，走同一条通道）。
   * 目前只用于「没有权限」这一档：静默忽略是装死，读者不知道自己被挡住。
   */
  reply?: (text: string) => Promise<void>
}

export type ChannelInboundResult = {
  disposition: ChannelInboundDisposition
  dispatchId?: string
}

/**
 * 「打开这条频道的会话」的结果。**成功时不带会话 id**：那个值不出主进程，
 * 渲染层拿到的只有「可以跳了」或一个具名原因。
 */
export type ChannelConversationOpenResult =
  | { ok: true }
  | { ok: false; code: 'conversation-session-missing' | 'session-selection-unavailable' }

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

export type ChannelSessionSuggestion = {
  channelId: string
  agentId: string
  /** 对方显示名（Telegram 的 first_name 这类）：会话名优先用它。 */
  displayLabel?: string
  /** 平台原样的会话 id（`telegram:chat:<id>` 这类）：拿不到显示名时取后四位。 */
  providerConversationKey: string
  /** 这条频道下已经有别的会话：名字需要加区分段，否则同一个人/两个人都叫「Telegram 对话」。 */
  disambiguate: boolean
}

export type ChannelSessionFactory = {
  createForConversation: (input: ChannelSessionSuggestion & { title: string }) => Promise<string>
  discardUnbound: (sessionId: string) => Promise<void>
  /** Optional existence probe; when provided, a deleted session is treated as unbound. */
  exists?: (sessionId: string) => Promise<boolean>
  /**
   * Optional ownership probe：这条会话是不是这个助手的。
   * 读者改了频道的助手之后，旧会话仍属于上一个助手，运行时会在第一毫秒抛
   * `Session ... does not belong to agent ...`——看起来就是「处理失败」。
   * 有这条判据时，这种绑定按「未绑定」处理，重新建一条属于当前助手的会话。
   */
  belongsToAgent?: (sessionId: string, agentId: string) => Promise<boolean>
}

/**
 * The inbound content guard runs before the payload is encrypted and stored, so a replayed or
 * backfilled work item can never bypass it with the raw text. It returns the text to persist
 * (wrapped for untrusted external input) or a rejection code; returning null text drops it.
 */
export type ChannelInboundGuardDecision = {
  text: string | null
  rejection: 'channel-content-rejected' | null
}

export type ChannelContentGuard = (facts: ChannelInboundFacts) => ChannelInboundGuardDecision

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
    capture?: ChannelInboundAttachmentCaptureState
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
        sizeBytes: attachment.sizeBytes ?? null,
        ...(attachment.capture === undefined ? {} : { capture: attachment.capture })
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
