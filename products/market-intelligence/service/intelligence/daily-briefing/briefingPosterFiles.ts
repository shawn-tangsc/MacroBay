import {
  createGeneratedImageStorage,
  generatedImageFileName,
  normalizeImageMime
} from '@platform/storage/generatedImageStorage'

/**
 * 海报文件：**内容寻址**，`userData/briefing-posters/<contentHash>.png`。
 *
 * 为什么不是「日期＋期号＋语言」（读者下载名 `briefingExportFileName` 那一套）：那会让版本标识
 * 变成日期的函数，重生成后键不变、海报静默不重发。同一个坑下载名已经踩过一次（两期同一天同名
 * 互覆盖）。所以存盘只认内容 hash，读者那份名字另算。
 *
 * 文件名的派生只有一处（`posterFileName`）；表里只存 `content_hash`，不存第二份文件名——
 * 两套命名必然有一处被当成键，然后静默漂移。
 */
export const MAX_BRIEFING_POSTER_BYTES = 10 * 1024 * 1024

const extension = '.png'
/** sha256 前 16 位（与平台生成图同一条规则）。 */
const contentHashPattern = /^[0-9a-f]{16}$/

export type BriefingPosterFile = Readonly<{
  contentHash: string
  byteLength: number
  width?: number
  height?: number
}>

export type BriefingPosterWriteResult =
  | Readonly<{ ok: true; file: BriefingPosterFile }>
  | Readonly<{ ok: false; reasonCode: 'image_too_large' | 'unsupported_image_type' }>

export type BriefingPosterFiles = Readonly<{
  directory: string
  /** 字节进、内容 hash 出；同一份字节永远同一个名字（内容幂等）。 */
  write: (bytes: Uint8Array) => Promise<BriefingPosterWriteResult>
  /** 按内容 hash 读；文件不在返回 null（「没有」），读不出来抛错（「拿不到」），两者不合并。 */
  read: (contentHash: string) => Promise<{ bytes: Uint8Array; mime: string } | null>
  remove: (contentHash: string) => Promise<void>
}>

/** 唯一一处「hash → 文件名」。别处要名字都从这里取。 */
export function posterFileName(contentHash: string): string {
  return `${contentHash}${extension}`
}

/** 反向：文件名 → 内容 hash。形状不对返回 null（路径穿越在存储入口已被拒，这里再挡一次）。 */
export function posterContentHash(fileName: string): string | null {
  if (!fileName.endsWith(extension)) return null
  const hash = fileName.slice(0, -extension.length)
  return contentHashPattern.test(hash) ? hash : null
}

export function createBriefingPosterFiles(input: Readonly<{
  directory: string
  maxBytes?: number
}>): BriefingPosterFiles {
  const storage = createGeneratedImageStorage({
    directory: input.directory,
    maxBytes: input.maxBytes ?? MAX_BRIEFING_POSTER_BYTES
  })

  return {
    directory: input.directory,

    async write(bytes) {
      const written = await storage.write(bytes, 'image/png')
      if (!written.ok) {
        return {
          ok: false,
          reasonCode: written.reasonCode === 'image_too_large' ? 'image_too_large' : 'unsupported_image_type'
        }
      }
      // 名字由存储按字节算出，这里只取 hash。`generatedImageFileName` 与它必须同一套规则，
      // 下面这条断言把两者钉在一起，改了一边另一边立刻红。
      const expected = generatedImageFileName(bytes, 'png')
      if (written.file.fileName !== expected) throw new Error('briefing-poster:file-name-drift')
      const contentHash = posterContentHash(written.file.fileName)
      if (contentHash === null) throw new Error('briefing-poster:unexpected-file-name')
      return {
        ok: true,
        file: {
          contentHash,
          byteLength: written.file.byteLength,
          ...(written.file.width === undefined ? {} : { width: written.file.width }),
          ...(written.file.height === undefined ? {} : { height: written.file.height })
        }
      }
    },

    read(contentHash) {
      if (!contentHashPattern.test(contentHash)) return Promise.resolve(null)
      return storage.read(posterFileName(contentHash))
    },

    async remove(contentHash) {
      if (!contentHashPattern.test(contentHash)) return
      const { rm } = await import('node:fs/promises')
      const target = storage.pathFor(posterFileName(contentHash))
      // `pathFor` 只认 hash 形状的名字；拿不到 = 名字本身就不该存在，不猜。
      if (target === null) return
      await rm(target, { force: true })
    }
  }
}

/** 判「这份字节是不是 png」只看签名，不看调用方声明（与通道侧同一条口径）。 */
export function isPngBytes(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
}

/** 声明 mime 只是旁证；出站判定一律看字节。 */
export function posterMimeDeclaration(): string {
  return normalizeImageMime('image/png') ?? 'image/png'
}