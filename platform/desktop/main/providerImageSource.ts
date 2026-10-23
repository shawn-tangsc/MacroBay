import {
  MAX_SOURCE_IMAGE_BYTES,
  validateEditSourceImage,
  type ImageEditSourceDescriptor,
  type ImageEditSourceMime
} from '../../ai/providers/providerImageEdit'
import {
  readImageDimensions,
  type GeneratedImageStorage,
  type StoredGeneratedImage
} from '../../storage/generatedImageStorage'

/**
 * T3：把渲染层给的「原图引用」变成主进程可用的字节。
 * - `file`：会话里已生成的图片 ⇒ 按 hash 文件名从 generated-images 读盘（渲染层不持有路径）；
 * - `inline`：本次上传的字节 ⇒ 先落盘成一张会话图片，再参与请求（消息里同样只留引用）。
 * 不满足 4MB / mime 白名单时**不**发任何请求。
 */
export type ResolvedImageEditSource =
  | {
      ok: true
      source: { mime: ImageEditSourceMime; bytes: Uint8Array }
      stored: StoredGeneratedImage
    }
  | { ok: false; reasonCode: string; message: string }

export async function resolveImageEditSource(
  storage: GeneratedImageStorage,
  descriptor: ImageEditSourceDescriptor
): Promise<ResolvedImageEditSource> {
  if (descriptor.kind === 'file') {
    const file = await storage.read(descriptor.fileName)
    if (!file) {
      return { ok: false, reasonCode: 'source_image_missing', message: 'The source image is no longer available.' }
    }
    const validated = validateEditSourceImage({ mime: file.mime, bytes: file.bytes })
    if (!validated.ok) return validated
    const stored: StoredGeneratedImage = {
      kind: 'image',
      mime: validated.mime,
      fileName: descriptor.fileName,
      byteLength: file.bytes.byteLength,
      ...readImageDimensions(file.bytes)
    }
    return { ok: true, source: { mime: validated.mime, bytes: file.bytes }, stored }
  }

  const validated = validateEditSourceImage({ mime: descriptor.mime, bytes: descriptor.bytes })
  if (!validated.ok) return validated
  const written = await storage.write(descriptor.bytes, validated.mime, { maxBytes: MAX_SOURCE_IMAGE_BYTES })
  if (!written.ok) {
    return { ok: false, reasonCode: written.reasonCode, message: written.message }
  }
  return { ok: true, source: { mime: validated.mime, bytes: descriptor.bytes }, stored: written.file }
}
