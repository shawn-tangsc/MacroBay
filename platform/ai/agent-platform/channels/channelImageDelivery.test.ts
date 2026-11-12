import { describe, expect, it } from 'vitest'

import {
  MAX_CHANNEL_IMAGE_BYTES,
  MAX_CHANNEL_IMAGE_CAPTION_CHARS,
  sniffImageMime,
  validateChannelImageDelivery
} from './channelImageDelivery'

function bytesOf(...head: number[]): Uint8Array {
  const value = new Uint8Array(64)
  head.forEach((byte, index) => { value[index] = byte })
  return value
}

const PNG = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const JPEG = bytesOf(0xff, 0xd8, 0xff)
// RIFF....WEBP
const WEBP = bytesOf(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50)

/**
 * 判定只看**字节签名**，不看声明 mime：供应商声明 png、实际吐 webp 的图存在，
 * 按声明放行就会把一张平台必拒的图送到网络上才失败。
 */
describe('image delivery validation', () => {
  it('accepts PNG and JPEG by their signatures', () => {
    expect(sniffImageMime(PNG)).toBe('image/png')
    expect(sniffImageMime(JPEG)).toBe('image/jpeg')
    expect(validateChannelImageDelivery({ bytes: PNG, caption: '日报' })).toEqual({ ok: true, mime: 'image/png' })
    expect(validateChannelImageDelivery({ bytes: JPEG, caption: '' })).toEqual({ ok: true, mime: 'image/jpeg' })
  })

  it('refuses WebP even when the declared mime says png, and records what it actually saw', () => {
    expect(sniffImageMime(WEBP)).toBeNull()
    const rejected = validateChannelImageDelivery({ bytes: WEBP, caption: '', declaredMime: 'image/png' })
    expect(rejected).toMatchObject({ ok: false, code: 'delivery-image-unsupported' })
    if (rejected.ok) throw new Error('unreachable')
    expect(rejected.detail).toContain('declared=image/png')
    expect(rejected.detail).toContain('actual=52494646')
  })

  it('refuses an unknown signature', () => {
    expect(validateChannelImageDelivery({ bytes: bytesOf(0x47, 0x49, 0x46), caption: '' }))
      .toMatchObject({ ok: false, code: 'delivery-image-unsupported' })
  })

  it('refuses an image over the channel limit before sending anything', () => {
    const large = new Uint8Array(MAX_CHANNEL_IMAGE_BYTES + 1)
    large.set(PNG)
    expect(validateChannelImageDelivery({ bytes: large, caption: '' }))
      .toMatchObject({ ok: false, code: 'delivery-image-too-large' })
  })

  it('refuses a caption that would have to be truncated', () => {
    expect(validateChannelImageDelivery({
      bytes: PNG,
      caption: 'x'.repeat(MAX_CHANNEL_IMAGE_CAPTION_CHARS + 1)
    })).toMatchObject({ ok: false, code: 'delivery-caption-too-long' })
  })
})
