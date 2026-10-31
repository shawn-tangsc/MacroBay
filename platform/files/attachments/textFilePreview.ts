import { open, stat } from 'node:fs/promises'

/**
 * 文本附件预览一次最多读取的字节数。超过它的附件只读前 N 字节，由 `truncated` 标记。
 * Owner: platform/files/attachments。回归：textFilePreview.test.ts。
 */
export const TEXT_FILE_READ_LIMIT_BYTES = 128 * 1024

interface TextFilePreview {
  /** 去掉首尾空白后的实际读取路径，供渲染层回填。 */
  path: string
  text: string
  /** 文件大于读取上限时为真；此时 `text` 只是前 `TEXT_FILE_READ_LIMIT_BYTES` 字节。 */
  truncated: boolean
}

/**
 * 读取文本附件的预览内容。
 *
 * 只依赖 Node 文件系统：不碰 Electron、不写盘、不缓存，主进程与产品服务可共用。
 * 抛出的错误文案直接面向渲染层，覆盖路径为空、不是普通文件、疑似二进制、读盘失败四种情况。
 */
export async function readTextFilePreview(path: string): Promise<TextFilePreview> {
  const trimmedPath = path.trim()
  if (!trimmedPath) throw new Error('File path is required.')

  const info = await stat(trimmedPath)
  if (!info.isFile()) throw new Error('Only files can be attached.')

  const bytesToRead = Math.min(info.size, TEXT_FILE_READ_LIMIT_BYTES)
  const buffer = Buffer.alloc(bytesToRead)
  const file = await open(trimmedPath, 'r')
  try {
    await file.read(buffer, 0, bytesToRead, 0)
    if (isLikelyBinary(buffer)) throw new Error('Binary files are not supported in text attachments yet.')
  } finally {
    await file.close()
  }

  return {
    path: trimmedPath,
    text: buffer.toString('utf8'),
    truncated: info.size > TEXT_FILE_READ_LIMIT_BYTES
  }
}

/** 只看前 1 KiB 的 NUL 字节：附件预览够用，且避免为识别类型多读整份文件。 */
function isLikelyBinary(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 1024)
  for (let index = 0; index < sampleSize; index++) {
    if (buffer[index] === 0) return true
  }
  return false
}
