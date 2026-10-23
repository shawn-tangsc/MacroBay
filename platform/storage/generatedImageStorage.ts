import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  generatedImageMimeType,
  isGeneratedImageFileName,
  type GeneratedImageExtension
} from '../ui/images/generatedImageUrl'

/**
 * T1：生成图片落盘（`userData/generated-images/`）。
 *
 * 只做「字节 ⇒ 文件」这一步，不知道 prompt / 会话 / 供应商：
 * - 文件名 = 内容 sha256 前 16 位 + 扩展名（内容幂等、不可预测、与 prompt 无关）；
 * - 目录不存在则创建（沿用 `jsonFileStorage` 的 mkdir + 写临时名再 rename 的模式）；
 * - 只接受 png/jpeg/webp；读/描述只认 hash 形状的文件名（路径穿越在入口即拒绝）。
 */
export const MAX_STORED_IMAGE_BYTES = 2 * 1024 * 1024

export const storedImageMimeTypes = ['image/png', 'image/jpeg', 'image/webp'] as const
export type StoredImageMime = (typeof storedImageMimeTypes)[number]

export type StoredGeneratedImage = {
  kind: 'image'
  mime: StoredImageMime
  fileName: string
  byteLength: number
  width?: number
  height?: number
}

export type WriteGeneratedImageOutcome =
  | { ok: true; file: StoredGeneratedImage }
  | { ok: false; reasonCode: 'image_too_large' | 'unsupported_image_type'; message: string }

export type GeneratedImageStorage = {
  directory: string
  write: (
    bytes: Uint8Array,
    mime: string,
    options?: { maxBytes?: number }
  ) => Promise<WriteGeneratedImageOutcome>
  describe: (fileName: string) => Promise<StoredGeneratedImage | null>
  read: (fileName: string) => Promise<{ bytes: Uint8Array; mime: StoredImageMime } | null>
  pathFor: (fileName: string) => string | null
}

const extensionByMime: Record<StoredImageMime, GeneratedImageExtension> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
}

export function normalizeImageMime(mime: string): StoredImageMime | null {
  const normalized = mime.trim().toLowerCase()
  if (normalized === 'image/jpg' || normalized === 'image/pjpeg') return 'image/jpeg'
  return (storedImageMimeTypes as readonly string[]).includes(normalized) ? (normalized as StoredImageMime) : null
}

/** 文件名只由内容决定：同一份字节永远得到同一个名字。 */
export function generatedImageFileName(bytes: Uint8Array, extension: GeneratedImageExtension): string {
  return `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${extension}`
}

export function createGeneratedImageStorage(input: {
  directory: string
  maxBytes?: number
}): GeneratedImageStorage {
  const directory = input.directory
  const defaultMaxBytes = input.maxBytes ?? MAX_STORED_IMAGE_BYTES

  function pathFor(fileName: string): string | null {
    if (!isGeneratedImageFileName(fileName)) return null
    return join(directory, fileName)
  }

  return {
    directory,
    pathFor,

    async write(bytes, mime, options) {
      const normalizedMime = normalizeImageMime(mime)
      if (!normalizedMime) {
        return { ok: false, reasonCode: 'unsupported_image_type', message: 'Unsupported image type.' }
      }
      const maxBytes = options?.maxBytes ?? defaultMaxBytes
      if (bytes.byteLength > maxBytes) {
        return {
          ok: false,
          reasonCode: 'image_too_large',
          message: `The image exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`
        }
      }
      const fileName = generatedImageFileName(bytes, extensionByMime[normalizedMime])
      const target = join(directory, fileName)
      await mkdir(directory, { recursive: true })
      const temporaryPath = `${target}.tmp`
      await writeFile(temporaryPath, bytes)
      await renameInto(temporaryPath, target)
      return {
        ok: true,
        file: {
          kind: 'image',
          mime: normalizedMime,
          fileName,
          byteLength: bytes.byteLength,
          ...readImageDimensions(bytes)
        }
      }
    },

    async describe(fileName) {
      const target = pathFor(fileName)
      if (!target) return null
      const mime = generatedImageMimeType(fileName)
      if (!mime) return null
      try {
        const info = await stat(target)
        if (!info.isFile()) return null
        return { kind: 'image', mime: mime as StoredImageMime, fileName, byteLength: info.size }
      } catch {
        return null
      }
    },

    async read(fileName) {
      const target = pathFor(fileName)
      const mime = generatedImageMimeType(fileName)
      if (!target || !mime) return null
      try {
        return { bytes: await readFile(target), mime: mime as StoredImageMime }
      } catch {
        return null
      }
    }
  }
}

/** 同名并发写同一内容时不要互相打架：rename 失败（目标已存在）视为成功。 */
async function renameInto(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch {
    await rm(from, { force: true })
  }
}

/** 只读尺寸（可选信息）：PNG/JPEG 够用，其它格式返回空值，绝不因此让落盘失败。 */
export function readImageDimensions(bytes: Uint8Array): { width?: number; height?: number } {
  const png = readPngDimensions(bytes)
  if (png) return png
  return readJpegDimensions(bytes) ?? {}
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return null
  }
  const width = readUint32(bytes, 16)
  const height = readUint32(bytes, 20)
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2
      continue
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6]
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8]
      if (width > 0 && height > 0) return { width, height }
      return null
    }
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}
