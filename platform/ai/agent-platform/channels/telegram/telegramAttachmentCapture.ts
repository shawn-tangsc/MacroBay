import type { ChannelInboundAttachmentCaptureState, ChannelVerifiedInboundAttachment } from '../ChannelInboundContracts'
import { captureInboundAttachment } from '../channelAttachmentCapture'
import { contentAddressedBlobPolicy, type ContentAddressedBlobStore } from '../../../../storage/contentAddressedBlobs'
import type { TelegramApiClient } from './TelegramApiClient'

/**
 * Telegram 入站附件的字节落盘（0.4.5，v1 只做这一个平台）。
 *
 * 三件顺序**不能换**：
 * 1. **先按 store 的策略拒**（白名单 + 2MB）：超限或格式不在白名单里的，一个请求都不发——
 *    先拉下来再丢，既浪费读者的流量，也把「发不了这类」拖慢成一次失败下载；
 * 2. 再 `getFile` + 下载（走注入的平台网络层，见 `TelegramApiClient.downloadFile`）；
 * 3. 再写内容寻址 store；写不进去也是**暂时读不到**（可重试），不是「没有」。
 *
 * 其余平台为什么不做（别让下一个人以为漏了）：Discord / Lark 的附件引用里只有文件 id，
 * 要下载还得**另存 message id 或原始 URL**（我们在正常化时把 URL 故意丢了，收窄攻击面）；
 * QQ 同理，当时也是故意丢 URL。v1 只在 Telegram 上做真拉取，别的平台**只登记引用、字节不落盘**，
 * 不为了「统一」给它们造一个假拉取。
 */
export async function captureTelegramAttachment(input: Readonly<{
  attachment: ChannelVerifiedInboundAttachment
  api: Pick<TelegramApiClient, 'downloadFile'>
  store: Pick<ContentAddressedBlobStore, 'write'>
  signal?: AbortSignal
}>): Promise<ChannelInboundAttachmentCaptureState> {
  const mime = normalizedMime(input.attachment.mimeType)
  if (mime === null) return { state: 'unavailable', reasonCode: 'attachment-unsupported-type' }
  if (input.attachment.sizeBytes !== undefined && input.attachment.sizeBytes > contentAddressedBlobPolicy.maxBytes) {
    return { state: 'unavailable', reasonCode: 'attachment-too-large' }
  }
  const fileId = telegramFileId(input.attachment.stableRef)
  if (fileId === null) return { state: 'unavailable', reasonCode: 'attachment-ref-invalid' }

  const downloaded = await input.api.downloadFile(fileId, input.signal)
  // 下载失败 = 暂时读不到（可重试）。**不是** `missing`：那句「你没有这张图」会把网络问题说成读者的错。
  if (!downloaded.ok) return { state: 'unreadable', reasonCode: 'attachment-download-failed' }

  const captured = await captureInboundAttachment({
    attachment: { ...input.attachment, mimeType: mime },
    bytes: downloaded.value,
    store: input.store
  })
  if (!captured.ok) {
    return captured.reasonCode === 'attachment-store-failed'
      ? { state: 'unreadable', reasonCode: 'attachment-store-failed' }
      : { state: 'unavailable', reasonCode: captured.reasonCode }
  }
  return { state: 'stored', fileRef: captured.attachment.fileRef }
}

/** 只认 store 白名单里的四种写法（`image/jpg` 归到 `image/jpeg`）；别的返回 null。 */
function normalizedMime(mime: string): string | null {
  const normalized = mime.trim().toLowerCase()
  const value = normalized === 'image/jpg' || normalized === 'image/pjpeg' ? 'image/jpeg' : normalized
  return (contentAddressedBlobPolicy.mimeTypes as readonly string[]).includes(value) ? value : null
}

/** `telegram:file:<file_id>` → `<file_id>`；形状不对返回 null（不拿一个没校验的串去请求）。 */
function telegramFileId(stableRef: string): string | null {
  const prefix = 'telegram:file:'
  if (!stableRef.startsWith(prefix)) return null
  const fileId = stableRef.slice(prefix.length).trim()
  return fileId.length > 0 && fileId.length <= 512 && !fileId.includes('..') ? fileId : null
}