import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type JsonFileStorage<T> = {
  read: () => Promise<T>
  write: (value: T) => Promise<void>
}

export function createJsonFileStorage<T>(filePath: string, fallback: T): JsonFileStorage<T> {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(filePath, 'utf8')) as T
      } catch (error) {
        if (isMissingFileError(error)) return fallback
        throw error
      }
    },
    async write(value) {
      await writeJsonFileAtomically(filePath, value)
    }
  }
}

/**
 * 先写同目录的临时文件、再 rename 覆盖目标：进程在写入中途退出时，原文件要么是旧的、
 * 要么是完整的新的。直接写目标文件会留下“新内容 + 上一版尾巴”的残片，之后每次读取都
 * 会在 `JSON.parse` 上失败（典型表现是页面一直显示“读取失败”）。
 */
export async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, filePath)
}

/**
 * 从一段可能粘着上一版残片的数组文本里取回数组：从最后一个 `]` 往前试，
 * 第一个能解析成数组的前缀就是答案。取不回来时返回 null，交给调用方决定怎么处理。
 */
export function recoverJsonArray(raw: string): unknown[] | null {
  for (let index = raw.lastIndexOf(']'); index >= 0; index = raw.lastIndexOf(']', index - 1)) {
    try {
      const parsed = JSON.parse(raw.slice(0, index + 1)) as unknown
      if (Array.isArray(parsed)) return parsed
    } catch {
      // 这个 `]` 不是数组结尾，换更早的再试。
    }
  }
  return null
}

/** 把坏文件按时间戳留一份，便于事后追查；留档失败不阻断恢复。 */
export async function quarantineCorruptFile(filePath: string, raw: string): Promise<void> {
  await writeFile(`${filePath}.corrupt-${Date.now()}`, raw, 'utf8').catch(() => undefined)
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
