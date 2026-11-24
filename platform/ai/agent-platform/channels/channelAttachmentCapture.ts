import type { ChannelVerifiedInboundAttachment } from './ChannelInboundContracts'
import {
  type ContentAddressedBlobMime,
  type ContentAddressedBlobStore,
  type WriteContentAddressedBlobOutcome
} from '../../../storage/contentAddressedBlobs'
import { sweepContentAddressedBlobs, type ContentAddressedBlobSweepResult } from '../../../storage/contentAddressedBlobRetention'

/**
 * 入站附件的**捕获与读取**（0.4.5：读者发来的图存本地、跟保留期一起清）。
 *
 * 字节只走平台的内容寻址 store（`platform/storage/contentAddressedBlobs`，哈希命名、写后读回校验），
 * 渠道这一层只做两件事：
 * - **写**：`ok` 才把 `fileRef` 交给消息行；白名单外 / 超上限 → 拒并给原因，**一个字节都不落**；
 * - **读**：把 store 的四态映射成读者能分辨的三态——「有字节」「暂时读不到（可重试）」「没有附件」。
 *   三态里**只有「没有 `fileRef`」才是「没有」**；文件缺失、读不出来、引用形状不对都是**错误态**，
 *   把坏盘画成「你没有」正是这条线一直被要求避免的事。
 *
 * 边界：这一层不知道通道、不知道会话、不会删字节。行删除只删行；字节由保留期 sweep 按引用集决定
 * （见 `contentAddressedBlobRetention`：活引用永不因超期被删，孤儿只有显式开启才扫）。
 */
export const CHANNEL_ATTACHMENT_UNAVAILABLE = '这项数据暂时读不到，不是你没有。'

export type StoredInboundAttachment = {
  kind: ChannelVerifiedInboundAttachment['kind']
  stableRef: string
  name: string | null
  mimeType: string
  sizeBytes: number | null
  /** 内容寻址的文件引用；消息行只留它，不留字节。 */
  fileRef: string
}

export type InboundAttachmentCaptureOutcome =
  | Readonly<{ ok: true; attachment: StoredInboundAttachment; reused: boolean }>
  | Readonly<{
    ok: false
    reasonCode: 'attachment-too-large' | 'attachment-unsupported-type' | 'attachment-store-failed'
    message: string
  }>

export async function captureInboundAttachment(input: Readonly<{
  attachment: ChannelVerifiedInboundAttachment
  bytes: Uint8Array
  store: Pick<ContentAddressedBlobStore, 'write'>
}>): Promise<InboundAttachmentCaptureOutcome> {
  const written: WriteContentAddressedBlobOutcome = await input.store.write({
    bytes: input.bytes,
    mime: input.attachment.mimeType
  })
  if (!written.ok) {
    // 只转译原因码，不改判据：上限与白名单的唯一出处是 store 的策略常量。
    const reasonCode = written.reasonCode === 'blob_too_large'
      ? 'attachment-too-large'
      : written.reasonCode === 'unsupported_blob_type'
        ? 'attachment-unsupported-type'
        : 'attachment-store-failed'
    return { ok: false, reasonCode, message: written.message }
  }
  return {
    ok: true,
    reused: written.reused,
    // 行上只留引用：字节已经在 store 里，这条记录**不含 bytes**。
    attachment: {
      kind: input.attachment.kind,
      stableRef: input.attachment.stableRef,
      name: input.attachment.name ?? null,
      mimeType: input.attachment.mimeType,
      sizeBytes: input.attachment.sizeBytes ?? null,
      fileRef: written.fileRef
    }
  }
}

/** 读者侧三态：只有「没有引用」才是空态，其余三种读不到都是错误态且可重试。 */
export type InboundAttachmentRead =
  | Readonly<{ state: 'bytes'; bytes: Uint8Array; mime: ContentAddressedBlobMime }>
  | Readonly<{ state: 'unreadable'; retryable: true; reasonCode: 'file-missing' | 'read-failed' | 'invalid-ref' }>
  | Readonly<{ state: 'none' }>

export async function readInboundAttachment(
  store: Pick<ContentAddressedBlobStore, 'read'>,
  fileRef: string | null | undefined
): Promise<InboundAttachmentRead> {
  // 没有引用 = 这条消息本来就没存过附件字节（老记录、或该平台只登记引用）→ 空态。
  if (fileRef === null || fileRef === undefined || fileRef.trim().length === 0) return { state: 'none' }
  const read = await store.read(fileRef)
  if (read.state === 'ok') return { state: 'bytes', bytes: read.bytes, mime: read.mime }
  return {
    state: 'unreadable',
    retryable: true,
    reasonCode: read.state === 'missing' ? 'file-missing' : read.state === 'unreadable' ? 'read-failed' : 'invalid-ref'
  }
}

/**
 * 附件字节的保留期（Chief 2026-11-24）：**跟消息同生共死，不按天删**。
 *
 * 今天没有「删过期消息行」这一步——消息自身没有保留期，别替它发明一个。所以这次只做**孤儿回收**：
 * 写了字节但行没落下的残留、或复位遗留的文件。`liveRefs` 由调用方从活着的消息行收集；
 * 收集不到（`undefined`）整轮跳过，一个字节都不删——「读不到」不是「没有可删」。
 */
export const CHANNEL_ATTACHMENT_ORPHAN_GRACE_DAYS = 7

export async function runChannelAttachmentSweep(input: Readonly<{
  store: Pick<ContentAddressedBlobStore, 'listEntries' | 'deleteRef'>
  liveRefs: () => ReadonlySet<string> | undefined
  nowMs: number
  dryRun?: boolean
  log?: (line: string) => void
}>): Promise<ContentAddressedBlobSweepResult> {
  const result = await sweepContentAddressedBlobs({
    store: input.store,
    liveRefs: input.liveRefs,
    orphanGraceDays: CHANNEL_ATTACHMENT_ORPHAN_GRACE_DAYS,
    nowMs: input.nowMs,
    includeOrphans: true,
    dryRun: input.dryRun === true
  })
  // 一行带数的日志：跑完了要说清「搬了多少 / 还剩多少」，否则下次没人能回答磁盘去哪了。
  input.log?.(result.state === 'swept'
    ? `[channel-attachments] sweep dryRun=${String(result.dryRun)} removedFiles=${result.removedFiles} `
      + `removedOrphanFiles=${result.removedOrphanFiles} reclaimedBytes=${result.reclaimedBytes} `
      + `remainingFiles=${result.remainingFiles} remainingBytes=${result.remainingBytes}`
    : `[channel-attachments] sweep skipped reason=${result.reasonCode}`)
  return result
}