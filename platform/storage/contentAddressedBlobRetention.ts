import type { ContentAddressedBlobStore } from './contentAddressedBlobs'

/**
 * 内容寻址字节的保留期 sweep（入站附件的「跟保留期一起清」）。
 *
 * 它只回答一个问题：**哪些文件可以删**。答案由调用方给的引用集决定，不由文件年龄决定——
 * 活行引用的文件永远不因超期被删，否则就是「聊天记录还在、图没了」，读者点开是一张破图，
 * 比占点磁盘坏得多（用户 2026-11-24 定）。
 *
 * 三件事分开算，因为它们错的时候后果不同：
 * - **过期**（`droppedRefs`）：本次删掉的行释放掉的引用，行已经没了，文件就该走；
 * - **孤儿**（目录里有、任何行都没引用过）：写成功但行没落、或复位遗留，**只有 `includeOrphans`**
 *   才扫，并受宽限期保护（防并发写到一半被扫）；
 * - **活引用**（`liveRefs`）：一个都不许删，连它的年龄都不看。
 *
 * 两个「读不到」各自是一个状态，不许折成「没有可删」：目录读不到 = `directory-unreadable`，
 * 行库读不到 = `refs-unreadable`。这两种情况下这一轮**一个字节都不删**。
 */
export type ContentAddressedBlobSweepResult =
  | Readonly<{
    state: 'swept'
    dryRun: boolean
    /** 过期宽限期的边界（只有孤儿看它）。 */
    cutoff: string
    removedFiles: number
    removedOrphanFiles: number
    reclaimedBytes: number
    remainingFiles: number
    remainingBytes: number
  }>
  | Readonly<{ state: 'skipped'; reasonCode: 'directory-unreadable' | 'refs-unreadable' }>

export async function sweepContentAddressedBlobs(input: Readonly<{
  store: Pick<ContentAddressedBlobStore, 'listEntries' | 'deleteRef'>
  /** **删完行之后**重算的存活引用集；`undefined` = 行库读不到，整轮跳过。 */
  liveRefs: () => ReadonlySet<string> | undefined
  /** 本次删行释放掉的引用（用来把「过期」和「孤儿」分成两格）；没删行就给空集。 */
  droppedRefs?: ReadonlySet<string>
  /** 孤儿宽限期：文件 mtime 在这个窗口内不删（防并发写到一半被扫）。 */
  orphanGraceDays: number
  nowMs: number
  includeOrphans?: boolean
  dryRun?: boolean
}>): Promise<ContentAddressedBlobSweepResult> {
  const entries = await input.store.listEntries()
  if (entries === undefined) return { state: 'skipped', reasonCode: 'directory-unreadable' } as const
  const liveRefs = input.liveRefs()
  if (liveRefs === undefined) return { state: 'skipped', reasonCode: 'refs-unreadable' } as const

  const droppedRefs = input.droppedRefs ?? new Set<string>()
  const graceCutoffMs = input.nowMs - input.orphanGraceDays * 24 * 3_600_000
  const dryRun = input.dryRun === true

  let removedFiles = 0
  let removedOrphanFiles = 0
  let reclaimedBytes = 0
  let remainingFiles = 0
  let remainingBytes = 0

  for (const entry of entries) {
    // 活引用：一个都不删，连年龄都不看。
    if (liveRefs.has(entry.fileRef)) {
      remainingFiles += 1
      remainingBytes += entry.byteLength
      continue
    }
    const expired = droppedRefs.has(entry.fileRef)
    const orphan = !expired
    if (orphan && (input.includeOrphans !== true || entry.modifiedAtMs >= graceCutoffMs)) {
      remainingFiles += 1
      remainingBytes += entry.byteLength
      continue
    }
    if (!dryRun) {
      const freed = await input.store.deleteRef(entry.fileRef)
      // 删的时候已经不在了：按「没删」记，别把不存在的字节算进回收量。
      if (freed === undefined) {
        remainingFiles += 1
        remainingBytes += entry.byteLength
        continue
      }
      reclaimedBytes += freed
    } else {
      reclaimedBytes += entry.byteLength
    }
    if (expired) removedFiles += 1
    else removedOrphanFiles += 1
  }

  return Object.freeze({
    state: 'swept' as const,
    dryRun,
    cutoff: new Date(graceCutoffMs).toISOString(),
    removedFiles,
    removedOrphanFiles,
    reclaimedBytes,
    remainingFiles,
    remainingBytes
  })
}