/**
 * 出站图片的**纯判定**：格式按字节签名判、上限与 caption 发送前判。
 *
 * 为什么不能看声明 mime：供应商响应里的 `mime_type` 只是声明（`providerImagePayload.ts:30`
 * 有就用、没有默认 image/png），而请求体不带 `output_format`，吐什么格式由供应商默认值决定。
 * 落盘按声明定扩展名、回读又由扩展名反推 mime——「声明 png、实际 webp」会被一路放行到网络上才失败。
 * 所以唯一判据是字节头。
 *
 * 本版只发 PNG / JPEG；WebP 直接拒绝（走 sendDocument 在手机上显示成文件，属于静默降级观感）。
 */
export const MAX_CHANNEL_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_CHANNEL_IMAGE_CAPTION_CHARS = 1_024
export const channelImageMimeTypes = ['image/png', 'image/jpeg'] as const

export type ChannelImageMime = (typeof channelImageMimeTypes)[number]
export type ChannelImageRejection =
  | 'delivery-image-too-large'
  | 'delivery-image-unsupported'
  | 'delivery-caption-too-long'

export type ChannelImageValidation =
  | { ok: true; mime: ChannelImageMime }
  | { ok: false; code: ChannelImageRejection; detail: string }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]

/**
 * 字节签名 → 能发的 mime；认不出或 WebP 都返回 `null`（由上层给 `delivery-image-unsupported`）。
 * 只读前 12 字节，零依赖、纯函数。
 */
export function sniffImageMime(bytes: Uint8Array): ChannelImageMime | null {
  if (bytes.byteLength >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return 'image/png'
  if (bytes.byteLength >= 3 && JPEG_SIGNATURE.every((value, index) => bytes[index] === value)) return 'image/jpeg'
  return null
}

/** 证据用：前 8 字节的十六进制（只有格式头，不含图片内容）。 */
export function imageSignatureHex(bytes: Uint8Array): string {
  return [...bytes.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function validateChannelImageDelivery(input: {
  bytes: Uint8Array
  caption: string
  /** 存储/供应商声明的 mime：**不参与判定**，只在不一致时写进 detail 供回溯。 */
  declaredMime?: string
}): ChannelImageValidation {
  // caption 先判：说明文字超长时整条不发，避免出现「图发了、说明被截断」的假成功。
  if ([...input.caption].length > MAX_CHANNEL_IMAGE_CAPTION_CHARS) {
    return { ok: false, code: 'delivery-caption-too-long', detail: `${[...input.caption].length} code points` }
  }
  if (input.bytes.byteLength > MAX_CHANNEL_IMAGE_BYTES) {
    return { ok: false, code: 'delivery-image-too-large', detail: `${input.bytes.byteLength} bytes` }
  }
  const mime = sniffImageMime(input.bytes)
  if (mime === null) {
    const declared = input.declaredMime?.trim().toLowerCase() ?? 'unknown'
    return { ok: false, code: 'delivery-image-unsupported', detail: `declared=${declared} actual=${imageSignatureHex(input.bytes)}` }
  }
  return { ok: true, mime }
}
