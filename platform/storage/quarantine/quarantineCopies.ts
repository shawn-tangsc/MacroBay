import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/**
 * 隔离副本（`.corrupt-*`）的清单：**只读扫描**，不删、不改、不新建。
 *
 * 这些副本是各存储自己的「读坏兜底」留下的：读到坏内容时把原文按 `.corrupt-<时间戳>`
 * 原样留一份（`jsonFileStorage.quarantineCorruptFile`、设置存储、产品里几处同口径的写法），
 * 便于事后追查。它们散落在各自文件旁边、没有索引——所以这里按**数据根目录**扫一遍文件名。
 *
 * 三条口径写在这里，别在调用点各判一次：
 * 1. **读不到 ≠ 没有**：根目录读不出来就抛（调用方画错误态 + 重试）；子目录读失败要计数，
 *    列表照出，但要明说「可能不全」；
 * 2. **绑定上限**：`maxVisitedEntries` / `maxCopies` 让最坏情况有终点，命中就置 `truncated`；
 * 3. **不跟符号链接**：副本只可能是普通文件，跟着链接走会扫出数据根之外的路径。
 */

export type QuarantineCopyView = Readonly<{
  /** 文件名（含 `.corrupt-<时间戳>` 后缀）。 */
  fileName: string
  /** 相对数据根目录的路径，用 `/` 分隔；界面按它说「在哪儿」。 */
  relativePath: string
  sizeBytes: number
  /** UTC ISO；界面按读者设置时区显示。 */
  modifiedAt: string
}>

export type QuarantineCopyScan = Readonly<{
  copies: readonly QuarantineCopyView[]
  /** 有目录没读到：列表可能不全，这是「读不到」的一部分，不许当作「没有副本」。 */
  unreadableDirectories: number
  /** 命中上限，列表被截断。 */
  truncated: boolean
}>

export const quarantineCopyScanPolicy = Object.freeze({
  /** `<file>.corrupt-<epoch ms>`；产品侧同口径，重复留档会再带一个 `-<n>`。 */
  fileNamePattern: /\.corrupt-\d{10,}(?:-\d+)?$/u,
  maxVisitedEntries: 20_000,
  maxCopies: 200,
  maxDepth: 12
})

type ScanState = {
  copies: QuarantineCopyView[]
  unreadableDirectories: number
  visited: number
  truncated: boolean
}

export async function listQuarantineCopies(
  rootDirectory: string,
  policy: Readonly<{ maxVisitedEntries?: number; maxCopies?: number; maxDepth?: number }> = {}
): Promise<QuarantineCopyScan> {
  const maxVisitedEntries = policy.maxVisitedEntries ?? quarantineCopyScanPolicy.maxVisitedEntries
  const maxCopies = policy.maxCopies ?? quarantineCopyScanPolicy.maxCopies
  const maxDepth = policy.maxDepth ?? quarantineCopyScanPolicy.maxDepth
  const state: ScanState = { copies: [], unreadableDirectories: 0, visited: 0, truncated: false }

  // 根目录读不出来 → 直接抛：这是「整个清单拿不到」，与「扫完了、没有」必须分开。
  const rootEntries: Dirent[] = await readdir(rootDirectory, { withFileTypes: true })
  await walk(rootEntries, rootDirectory, 0)

  state.copies.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
  return {
    copies: state.copies,
    unreadableDirectories: state.unreadableDirectories,
    truncated: state.truncated
  }

  async function walk(entries: readonly Dirent[], directory: string, depth: number): Promise<void> {
    for (const entry of entries) {
      if (state.truncated) return
      if (state.visited >= maxVisitedEntries || state.copies.length >= maxCopies) {
        state.truncated = true
        return
      }
      state.visited += 1
      const absolutePath = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (depth >= maxDepth) continue
        try {
          const children: Dirent[] = await readdir(absolutePath, { withFileTypes: true })
          await walk(children, absolutePath, depth + 1)
        } catch {
          state.unreadableDirectories += 1
        }
        continue
      }
      if (!entry.isFile() || !quarantineCopyScanPolicy.fileNamePattern.test(entry.name)) continue
      try {
        const info = await stat(absolutePath)
        state.copies.push({
          fileName: entry.name,
          relativePath: relative(rootDirectory, absolutePath).split(sep).join('/'),
          sizeBytes: info.size,
          modifiedAt: new Date(info.mtimeMs).toISOString()
        })
      } catch {
        // 文件在扫描与 `stat` 之间消失（读者自己删了）：不是错误，跳过这一条。
      }
    }
  }
}
