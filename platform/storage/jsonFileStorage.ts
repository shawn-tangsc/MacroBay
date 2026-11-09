import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export type JsonFileStorage<T> = {
  read: () => Promise<T>
  write: (value: T) => Promise<void>
  /**
   * 读到损坏内容时，在**不改原文件**的前提下留一份 `.corrupt-*` 副本。
   *
   * 调用方拿到的 `read()` 仍然是「坏了就抛」——留档与恢复是两件事：这份文档是整份读—改—写的
   * 目标，静默拿默认值覆盖等于抹掉读者的配置，所以这里只留证据，恢复由人决定。
   * 留档失败直接抛（fail-closed）：宁可不保存，也不要在一份来路不明的文件上写。
   */
  preserveCorruptCopy?: (error: unknown) => Promise<void>
}

export function createJsonFileStorage<T>(filePath: string, fallback: T): JsonFileStorage<T> {
  return {
    async preserveCorruptCopy() {
      // 原文件一个字节都不动：只读它的内容、另存一份带时间戳的副本。
      const raw = await readFile(filePath, 'utf8')
      await quarantineCorruptFile(filePath, raw)
    },
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
 *
 * 只要写入的是“会被再次读回的完整文档”，就该走这里，而不是直接 `writeFile`。
 */
export async function writeFileAtomically(
  filePath: string,
  data: string | Uint8Array,
  encoding: BufferEncoding = 'utf8'
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  // 临时名必须**同进程内也唯一**：只按 PID 命名时，同一次钩子里的两次并发写会写同一个 tmp，
  // 一个刚 truncate、另一个写到一半，谁先 rename 谁就把半成品发布成正式文件——产出的正是
  // 「一份完整文档 + 一份从中间开始的残片」。唯一名让两笔写各自成形，rename 只换自己的那个。
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    if (typeof data === 'string') await writeFile(temporaryPath, data, encoding)
    else await writeFile(temporaryPath, data)
    await rename(temporaryPath, filePath)
  } catch (error) {
    // rename 之后 tmp 已经不存在；反过来的失败要清掉自己的残留，别把目录越积越脏。
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

/** 同步版本，供只读快照/同步写入的存储使用；语义与 `writeFileAtomically` 相同。 */
export function writeFileAtomicallySync(filePath: string, data: string, encoding: BufferEncoding = 'utf8'): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, data, encoding)
    renameSync(temporaryPath, filePath)
  } catch (error) {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // 残留清理失败不改变原始错误：那才是调用方要读的那条。
    }
    throw error
  }
}

export async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export function writeJsonFileAtomicallySync(filePath: string, value: unknown): void {
  writeFileAtomicallySync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * 从一段可能粘着上一版残片的 JSON 文本里取回文档：从后往前试能构成完整值的
 * `}` / `]` 位置，第一个能解析的前缀就是答案。取不回来时返回 undefined。
 *
 * 只看最后 50 个闭合符，避免在超大文件上做 O(n²) 的重复解析；真实事故的残片
 * 只有几个字符，这个上限足够。
 */
export function recoverJsonValue(raw: string): unknown | undefined {
  const text = raw.trimEnd()
  const candidates: number[] = []
  for (let index = text.length - 1; index >= 0 && candidates.length < 50; index -= 1) {
    const char = text[index]
    if (char === '}' || char === ']') candidates.push(index)
  }
  for (const index of candidates) {
    try {
      return JSON.parse(text.slice(0, index + 1)) as unknown
    } catch {
      // 这个闭合符不是文档结尾，换更早的再试。
    }
  }
  return undefined
}

/** 数组版本的取回：不是数组就返回 null。 */
export function recoverJsonArray(raw: string): unknown[] | null {
  const value = recoverJsonValue(raw)
  return Array.isArray(value) ? value : null
}

/**
 * 读回一个 JSON 文档。文件被写坏时取回最长可解析前缀，把原样留一份 `.corrupt-*`，
 * 并把取回的内容写回，让下一次读取恢复正常；文件不存在或完全无法取回时返回 undefined。
 */
export async function readJsonFileRecovering(filePath: string): Promise<unknown | undefined> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) return undefined
    throw error
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    const recovered = recoverJsonValue(raw)
    await quarantineCorruptFile(filePath, raw)
    if (recovered === undefined) return undefined
    await writeJsonFileAtomically(filePath, recovered)
    return recovered
  }
}

/** `readJsonFileRecovering` 的同步版本，供同步读取的存储使用。 */
export function readJsonFileRecoveringSync(filePath: string): unknown | undefined {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) return undefined
    throw error
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    const recovered = recoverJsonValue(raw)
    void quarantineCorruptFile(filePath, raw)
    if (recovered === undefined) return undefined
    writeJsonFileAtomicallySync(filePath, recovered)
    return recovered
  }
}

/** 把坏文件按时间戳留一份，便于事后追查；留档失败不阻断恢复。 */
export async function quarantineCorruptFile(filePath: string, raw: string): Promise<void> {
  await writeFile(`${filePath}.corrupt-${Date.now()}`, raw, 'utf8').catch(() => undefined)
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
