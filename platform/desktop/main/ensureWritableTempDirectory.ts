import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type WritableTempDirectoryResult = {
  /** 进程之后应当使用的临时目录。 */
  directory: string
  /** 是否因为系统临时目录不可用而改用了后备目录。 */
  redirected: boolean
  /** 系统临时目录探针失败的原因（仅在 redirected 时有值），用于启动日志。 */
  osTempError?: string
}

export type EnsureWritableTempDirectoryOptions = {
  /** 操作系统给出的临时目录（Windows 上来自 TMP/TEMP）。 */
  osTempDirectory: string
  /** 系统临时目录不可用时落到哪里；通常位于 userData 下。 */
  fallbackDirectory: string
  /** 被改写的环境变量容器；只写 TEMP 与 TMP。 */
  environment: NodeJS.ProcessEnv
  /** 同步 Electron 自己的临时路径；打包/测试环境可以不传。 */
  setPath?: (name: 'temp', value: string) => void
}

/**
 * 启动前确认临时目录真的可写，不可写就换到一个应用自己管得住的目录。
 *
 * 存在的理由是一个具体的崩溃：Windows 受限/管理员会话里 TMP/TEMP 可能指向一个
 * 建不出来的目录（例如未提权时无法在盘符根下创建的 `D:\tmp`）。SQLite 建临时文件
 * 直接返回 `SQLITE_CANTOPEN`（"unable to open database file"），而它发生在启动迁移
 * 里，界面还没出来就弹错误框。把 TEMP/TMP 指到 userData 下的目录之后，SQLite、
 * Node 与 Electron 的临时文件都落在同一个可写位置。
 *
 * 只在系统临时目录确实不可写时才改写，正常机器上行为不变（探针文件写一个删一个）。
 */
export function ensureWritableTempDirectory(
  options: EnsureWritableTempDirectoryOptions
): WritableTempDirectoryResult {
  const osTempError = probeWritable(options.osTempDirectory)
  if (osTempError === null) {
    return { directory: options.osTempDirectory, redirected: false }
  }

  let fallbackError: string | null
  try {
    mkdirSync(options.fallbackDirectory, { recursive: true })
    fallbackError = probeWritable(options.fallbackDirectory)
  } catch (error) {
    fallbackError = errorCode(error)
  }
  if (fallbackError !== null) {
    throw new Error(
      `No writable temporary directory. System temp "${options.osTempDirectory}" failed with ${osTempError}; ` +
        `fallback "${options.fallbackDirectory}" failed with ${fallbackError}.`
    )
  }

  options.environment.TEMP = options.fallbackDirectory
  options.environment.TMP = options.fallbackDirectory
  options.setPath?.('temp', options.fallbackDirectory)
  return { directory: options.fallbackDirectory, redirected: true, osTempError }
}

/** 能创建并删除一个探针文件时返回 null，否则返回错误码。 */
function probeWritable(directory: string): string | null {
  const probeFile = join(directory, `.macrobay-temp-probe-${process.pid}-${Date.now()}`)
  try {
    writeFileSync(probeFile, '')
  } catch (error) {
    return errorCode(error)
  }
  try {
    rmSync(probeFile, { force: true })
  } catch {
    // 探针文件删不掉不影响判定：能写就说明目录可用。
  }
  return null
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? 'unknown'
}
