import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export type AppLogLevel = 'info' | 'warn' | 'error'

export interface AppLogLimits {
  /** 单文件上限：超过就滚动。 */
  maxFileBytes: number
  /** 滚动保留个数（不含当前的 `app.log`）。 */
  maxRolledFiles: number
  /** 全部日志文件的总量硬上限：超过就从最旧的一端删。 */
  maxTotalBytes: number
}

export const APP_LOG_LIMITS: AppLogLimits = Object.freeze({
  maxFileBytes: 5 * 1024 * 1024,
  maxRolledFiles: 3,
  maxTotalBytes: 15 * 1024 * 1024
})

/** 落盘前的最后一道处理。写入器自己不做脱敏，但缺了它一律不写（fail-closed）。 */
export type AppLogRedactor = (text: string) => string

export interface AppLog {
  /** 追加一条结构化日志；任何写入失败都只上报到控制台，不打断调用方。 */
  log: (level: AppLogLevel, event: string, fields?: Record<string, unknown>) => void
  /** 当前写入的文件路径，便于诊断与自检。 */
  path: string
}

export interface CreateAppLogOptions {
  directory: string
  redact: AppLogRedactor
  limits?: Partial<AppLogLimits>
  now?: () => Date
}

const CURRENT_LOG_FILE_NAME = 'app.log'

function rolledLogFileName(index: number): string {
  return `app.${index}.log`
}

/**
 * 追加写 `directory/app.log`，轮转在写入器内部完成：写满 `maxFileBytes` 就把
 * `app.log` 滚成 `app.1.log`（旧的依次后移，超出 `maxRolledFiles` 的最旧一个删除），
 * 再按 `maxTotalBytes` 从最旧的一端削到总量以内。
 *
 * 不注册定时器、不产生第二个清理任务：清理只发生在滚动的那一刻。
 */
export function createAppLog(options: CreateAppLogOptions): AppLog {
  if (typeof options.redact !== 'function') {
    throw new Error('createAppLog requires a redactor: refusing to write log lines that were not redacted.')
  }

  const limits: AppLogLimits = { ...APP_LOG_LIMITS, ...options.limits }
  const currentPath = join(options.directory, CURRENT_LOG_FILE_NAME)
  const now = options.now ?? (() => new Date())
  let currentBytes: number | null = null

  function ensureDirectory(): void {
    mkdirSync(options.directory, { recursive: true })
  }

  function rotate(): void {
    // 最旧的先删除，再把其余文件依次后移，最后把当前文件滚成 `app.1.log`。
    removeIfExists(join(options.directory, rolledLogFileName(limits.maxRolledFiles)))
    for (let index = limits.maxRolledFiles - 1; index >= 1; index--) {
      renameIfExists(
        join(options.directory, rolledLogFileName(index)),
        join(options.directory, rolledLogFileName(index + 1))
      )
    }
    renameIfExists(currentPath, join(options.directory, rolledLogFileName(1)))
    currentBytes = 0
  }

  function pruneToTotalSize(): void {
    const sizes = [
      { path: currentPath, size: fileSize(currentPath) },
      ...Array.from({ length: limits.maxRolledFiles }, (_, offset) => {
        const path = join(options.directory, rolledLogFileName(offset + 1))
        return { path, size: fileSize(path) }
      })
    ].filter((entry) => entry.size > 0)

    let total = sizes.reduce((sum, entry) => sum + entry.size, 0)
    // 最旧的一端在数组末尾（`app.1.log` 比 `app.2.log` 新）。
    for (let index = sizes.length - 1; index > 0 && total > limits.maxTotalBytes; index--) {
      unlinkSync(sizes[index].path)
      total -= sizes[index].size
    }
  }

  function write(level: AppLogLevel, event: string, fields?: Record<string, unknown>): void {
    try {
      ensureDirectory()
      if (currentBytes === null) currentBytes = fileSize(currentPath)

      const line = `${options.redact(
        // 信封字段写在最后：载荷里的同名字段不能改写时间、级别与事件名。
        JSON.stringify({ ...fields, time: now().toISOString(), level, event })
      )}\n`
      const bytes = Buffer.byteLength(line, 'utf8')
      let size = currentBytes
      let rotated = false
      if (size > 0 && size + bytes > limits.maxFileBytes) {
        rotate()
        size = 0
        rotated = true
      }
      appendFileSync(currentPath, line, 'utf8')
      currentBytes = size + bytes
      if (rotated) pruneToTotalSize()
    } catch (error) {
      console.error('[platform] failed to write the application log', error)
    }
  }

  return {
    path: currentPath,
    log: write
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function removeIfExists(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // 文件本来就不存在：轮转没有历史文件是正常状态。
  }
}

function renameIfExists(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch {
    // 来源不在就跳过这一步，轮转链在该位置上自然断开。
  }
}
