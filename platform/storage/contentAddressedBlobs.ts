import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 内容寻址的二进制落盘（入站附件字节）。
 *
 * 与 `generatedImageStorage` 的区别只有语义：那个是「应用生成的图」，这里是「读者发来的附件」——
 * 两者的上限、保留期和是否可清**将来会分开**，共用一个目录就会把两件事绑死。所以这里是独立模块，
 * 命名规则也独立：**全 64 位 sha256 + 扩展名**（生成图用前 16 位），同一份字节永远同一个名字。
 *
 * 三条不能省的行为：
 * - **写后读回校验**（hash + 字节数）：写进去的和交出去的必须是同一份，否则整条不落；
 * - **`missing` / `unreadable` / `invalid-ref` 分开报**：读不到不等于没有，路径穿越在入口即拒；
 * - **只做「字节 ⇒ 文件」**：不知道消息、会话、渠道，也不删任何被引用的文件——删除由保留期那一步
 *   按引用集决定（见下文的 `listEntries` / `deleteRef`）。
 *
 * 保留期口径（用户 2026-11-24 定，实现方不要自己改）：**删字节的唯一依据是「没有任何存活行引用」**，
 * 不是文件年龄——活行引用的文件永远不因超期被删，否则就是「聊天记录还在、图没了」。天数只当孤儿
 * 宽限期（防并发写到一半被扫）。行删除路径只删行、不碰字节；sweep 删前重算引用集，孤儿单独计数。
 */
export const contentAddressedBlobPolicy = Object.freeze({
  /** 单条附件的默认上限：与生成图同档，超了在入口就拒，不落半截。 */
  maxBytes: 2 * 1024 * 1024,
  /** 只认这几种图；要收任意文件先另开一批（白名单变了，文件名规则也要跟着变）。 */
  mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] as const,
  /** 文件名只由内容决定：全 sha256 + 扩展名。 */
  fileRefPattern: /^[a-f0-9]{64}\.(png|jpg|webp)$/
})

export type ContentAddressedBlobMime = (typeof contentAddressedBlobPolicy.mimeTypes)[number]
export type BlobExtension = 'png' | 'jpg' | 'webp'

export type WriteContentAddressedBlobOutcome =
  | Readonly<{ ok: true; fileRef: string; mime: ContentAddressedBlobMime; byteLength: number; reused: boolean }>
  | Readonly<{
    ok: false
    reasonCode: 'blob_too_large' | 'unsupported_blob_type' | 'write_verification_failed'
    message: string
  }>

/**
 * 读一条附件。四种状态各是一个值：`missing` 是「确实没有」，`unreadable` 是「读不到」——
 * 把两者折成一个 null，界面上就会把坏盘画成健康。
 */
export type ReadContentAddressedBlobResult =
  | Readonly<{ state: 'ok'; bytes: Uint8Array; mime: ContentAddressedBlobMime }>
  | Readonly<{ state: 'missing' }>
  | Readonly<{ state: 'unreadable'; reasonCode: 'read-failed' }>
  | Readonly<{ state: 'invalid-ref'; reasonCode: 'invalid-file-ref' }>

export type ContentAddressedBlobStore = Readonly<{
  directory: string
  write: (input: Readonly<{ bytes: Uint8Array; mime: string; maxBytes?: number }>) => Promise<WriteContentAddressedBlobOutcome>
  read: (fileRef: string) => Promise<ReadContentAddressedBlobResult>
  /** 只读描述：路径不合法或文件不存在都返回 null（不建目录、不写盘）。 */
  describe: (fileRef: string) => Promise<Readonly<{ fileRef: string; mime: ContentAddressedBlobMime; byteLength: number }> | null>
  /**
   * 目录里的内容寻址条目（含 `modifiedAtMs`，孤儿宽限期要用它）。**目录读不到返回 undefined**，不是空数组。
   *
   * 只列文件名形状合法的项：别的文件不属于这个 store，删了就是删别人的东西。
   */
  listEntries: () => Promise<readonly ContentAddressedBlobEntry[] | undefined>
  /** 删一个文件并返回释放的字节；不存在（或不是普通文件）返回 undefined。引用计数由调用方负责。 */
  deleteRef: (fileRef: string) => Promise<number | undefined>
}>

export type ContentAddressedBlobEntry = Readonly<{
  fileRef: string
  mime: ContentAddressedBlobMime
  byteLength: number
  modifiedAtMs: number
}>

const extensionByMime: Record<ContentAddressedBlobMime, BlobExtension> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
}

const mimeByExtension: Record<BlobExtension, ContentAddressedBlobMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp'
}

/** 只做 mime 归一：`image/jpg` 与 `image/pjpeg` 都是 `image/jpeg`。 */
export function normalizeBlobMime(mime: string): ContentAddressedBlobMime | null {
  const normalized = mime.trim().toLowerCase()
  if (normalized === 'image/jpg' || normalized === 'image/pjpeg') return 'image/jpeg'
  return (contentAddressedBlobPolicy.mimeTypes as readonly string[]).includes(normalized)
    ? normalized as ContentAddressedBlobMime
    : null
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 文件名只由内容决定：同一份字节永远得到同一个名字。 */
export function contentAddressedBlobFileName(bytes: Uint8Array, extension: BlobExtension): string {
  return `${sha256Hex(bytes)}.${extension}`
}

export function createContentAddressedBlobStore(input: Readonly<{ directory: string; maxBytes?: number }>): ContentAddressedBlobStore {
  const directory = input.directory
  const defaultMaxBytes = input.maxBytes ?? contentAddressedBlobPolicy.maxBytes

  function mimeFor(fileRef: string): ContentAddressedBlobMime | null {
    const extension = fileRef.slice(fileRef.lastIndexOf('.') + 1) as BlobExtension
    return mimeByExtension[extension] ?? null
  }

  return {
    directory,

    async write({ bytes, mime, maxBytes }) {
      const normalizedMime = normalizeBlobMime(mime)
      if (!normalizedMime) {
        return { ok: false, reasonCode: 'unsupported_blob_type', message: 'Unsupported attachment type.' }
      }
      const cap = maxBytes ?? defaultMaxBytes
      if (bytes.byteLength > cap) {
        return { ok: false, reasonCode: 'blob_too_large', message: `The attachment exceeds the ${Math.round(cap / (1024 * 1024))} MB limit.` }
      }

      const fileRef = contentAddressedBlobFileName(bytes, extensionByMime[normalizedMime])
      const target = join(directory, fileRef)
      await mkdir(directory, { recursive: true })
      const existed = await exists(target)
      if (!existed) {
        const temporaryPath = `${target}.tmp`
        await writeFile(temporaryPath, bytes)
        // 写后读回校验：落盘的和交出去的是不是同一份字节，只有读回来才算数。
        const written = await readFile(temporaryPath).catch(() => undefined)
        if (written === undefined || written.byteLength !== bytes.byteLength || sha256Hex(written) !== sha256Hex(bytes)) {
          await rm(temporaryPath, { force: true }).catch(() => undefined)
          return { ok: false, reasonCode: 'write_verification_failed', message: 'The attachment did not survive a read-back check.' }
        }
        await renameInto(temporaryPath, target)
      }
      return { ok: true, fileRef, mime: normalizedMime, byteLength: bytes.byteLength, reused: existed }
    },

    async read(fileRef) {
      if (!contentAddressedBlobPolicy.fileRefPattern.test(fileRef)) {
        return { state: 'invalid-ref', reasonCode: 'invalid-file-ref' } as const
      }
      const mime = mimeFor(fileRef)
      if (!mime) return { state: 'invalid-ref', reasonCode: 'invalid-file-ref' } as const
      try {
        return { state: 'ok', bytes: await readFile(join(directory, fileRef)), mime } as const
      } catch (error) {
        // 「没有」与「读不到」是两件事：ENOENT 才是空，其余都是读失败。
        return isNotFound(error) ? { state: 'missing' } as const : { state: 'unreadable', reasonCode: 'read-failed' } as const
      }
    },

    async describe(fileRef) {
      if (!contentAddressedBlobPolicy.fileRefPattern.test(fileRef)) return null
      const mime = mimeFor(fileRef)
      if (!mime) return null
      try {
        const info = await stat(join(directory, fileRef))
        return info.isFile() ? Object.freeze({ fileRef, mime, byteLength: info.size }) : null
      } catch {
        return null
      }
    },

    async listEntries() {
      try {
        const names = await readdir(directory)
        const entries: ContentAddressedBlobEntry[] = []
        for (const fileRef of names.filter((name) => contentAddressedBlobPolicy.fileRefPattern.test(name)).sort()) {
          const mime = mimeFor(fileRef)
          if (!mime) continue
          const info = await stat(join(directory, fileRef))
          if (!info.isFile()) continue
          entries.push(Object.freeze({ fileRef, mime, byteLength: info.size, modifiedAtMs: info.mtimeMs }))
        }
        return Object.freeze(entries)
      } catch {
        return undefined
      }
    },

    async deleteRef(fileRef) {
      if (!contentAddressedBlobPolicy.fileRefPattern.test(fileRef)) return undefined
      const target = join(directory, fileRef)
      try {
        const info = await stat(target)
        if (!info.isFile()) return undefined
        await rm(target)
        return info.size
      } catch {
        return undefined
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

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}