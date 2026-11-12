import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { sniffImageMime } from '../ai/agent-platform/channels/channelImageDelivery'

/**
 * 日报海报的**主进程暂存区**（`userData/channel-outbox/`，方案 §1）。
 *
 * 为什么要有它：海报是渲染层现渲染出来的、从不落盘；出站图片只收字节，投递层也不该认识路径。
 * 所以渲染层把字节交过来（同一个 `publishToPhone` IPC 的可选 `poster`），**主进程**在这里
 * 判体积、按字节头嗅探、按内容 hash 落盘，并写一条**来源记录**（`editionId` 唯一）。
 *
 * 三条防穿透规则（方案 §2，一条都不能少）：
 * - 调用方**给不出路径**：它只能给 `{date, periodId, locale}`，路径永远由这里拼；
 * - `editionId` 必须与本次发布**完全一致**：读取时按这组三元组重算 id，记录里的 id 对不上就是
 *   `delivery-image-source-not-allowed`（detail `edition-mismatch`）；
 * - **不按目录判来源**：outbox 里可能有上一版或失败重试的残留，判据永远是「来源记录 + 版本绑定」。
 *
 * 清理：保留期 7 天；每次写入顺手清掉过期记录与不再被引用的文件，也提供 `prune()` 给维护任务。
 * 删除前留一行痕（`onPrune`），不静默。
 */
export const MAX_CHANNEL_POSTER_BYTES = 8 * 1024 * 1024
export const CHANNEL_POSTER_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

export type ChannelPosterEdition = { date: string; periodId: string; locale: string }

export type ChannelPosterRecord = {
  kind: 'briefing-poster'
  editionId: string
  fileName: string
  mime: 'image/png' | 'image/jpeg'
  byteLength: number
  createdAt: string
}

export type StorePosterOutcome =
  | { ok: true; record: ChannelPosterRecord }
  | { ok: false; code: 'delivery-image-too-large' | 'delivery-image-unsupported'; detail: string }

export type ReadPosterOutcome =
  | { ok: true; bytes: Uint8Array; mime: 'image/png' | 'image/jpeg'; record: ChannelPosterRecord }
  | { ok: false; code: 'delivery-image-unavailable' | 'delivery-image-source-not-allowed' | 'delivery-image-unsupported'; detail: string }

/** `editionId` 的**唯一**拼法：只此一处，读取与写入都从这里算（两处各拼一次就会错位）。 */
export function channelPosterEditionId(edition: ChannelPosterEdition): string {
  return `${edition.date}:${edition.locale}:${edition.periodId}`
}

export type ChannelPosterOutbox = {
  directory: string
  store: (input: { edition: ChannelPosterEdition; bytes: Uint8Array; mime: string }) => Promise<StorePosterOutcome>
  read: (edition: ChannelPosterEdition) => Promise<ReadPosterOutcome>
  /** 只问「这一版有没有暂存海报」：不读字节（路由决定用，读盘留给真正要发的时候）。 */
  has: (edition: ChannelPosterEdition) => Promise<boolean>
  prune: () => Promise<readonly string[]>
}

export function createChannelPosterOutbox(deps: {
  /** `userData/channel-outbox`：与 `generated-images/` 分开，来源不同不能靠目录混用。 */
  directory: string
  now: () => string
  /** 清理留痕（文件名 + 时间）；不静默删。 */
  onPrune?: (entry: { fileName: string; at: string }) => void
}): ChannelPosterOutbox {
  const recordsFile = join(deps.directory, 'records.json')

  async function loadRecords(): Promise<Record<string, ChannelPosterRecord>> {
    try {
      const parsed = JSON.parse(await readFile(recordsFile, 'utf8')) as unknown
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, ChannelPosterRecord>
        : {}
    } catch {
      // 文件不存在（第一次）与读坏了都当「没有记录」：判据是记录本身，没有就是没有。
      return {}
    }
  }

  async function saveRecords(records: Record<string, ChannelPosterRecord>): Promise<void> {
    await mkdir(deps.directory, { recursive: true })
    const temp = `${recordsFile}.tmp`
    await writeFile(temp, JSON.stringify(records), 'utf8')
    await rename(temp, recordsFile)
  }

  function expired(record: ChannelPosterRecord, now: string): boolean {
    const created = Date.parse(record.createdAt)
    const current = Date.parse(now)
    if (!Number.isFinite(created) || !Number.isFinite(current)) return false
    return current - created > CHANNEL_POSTER_RETENTION_MS
  }

  async function prune(): Promise<readonly string[]> {
    const at = deps.now()
    const records = await loadRecords()
    const removed: string[] = []
    const kept: Record<string, ChannelPosterRecord> = {}
    for (const [editionId, record] of Object.entries(records)) {
      if (!expired(record, at)) { kept[editionId] = record; continue }
      try { await rm(join(deps.directory, record.fileName), { force: true }) } catch { /* 已经不在了 */ }
      deps.onPrune?.({ fileName: record.fileName, at })
      removed.push(record.fileName)
    }
    if (removed.length > 0) await saveRecords(kept)
    return removed
  }

  return {
    directory: deps.directory,

    async store(input) {
      // ① 体积先判：**在写盘之前**拒，别把 8 MB 垃圾写进磁盘再说不行。
      if (input.bytes.byteLength === 0) {
        return { ok: false, code: 'delivery-image-unsupported', detail: 'empty' }
      }
      if (input.bytes.byteLength > MAX_CHANNEL_POSTER_BYTES) {
        return { ok: false, code: 'delivery-image-too-large', detail: `bytes=${input.bytes.byteLength}` }
      }
      // ② 真实格式按字节头判，不信声明（webp 本版不收，与频道图片同一条规则）。
      const actual = sniffImageMime(input.bytes)
      if (actual !== 'image/png' && actual !== 'image/jpeg') {
        return { ok: false, code: 'delivery-image-unsupported', detail: `declared=${input.mime} actual=${actual ?? 'unknown'}` }
      }
      const editionId = channelPosterEditionId(input.edition)
      // ③ 文件名 = 内容 hash：内容幂等、不可预测，同一版重发只会覆盖同一个文件。
      const fileName = `${createHash('sha256').update(input.bytes).digest('hex').slice(0, 32)}.${actual === 'image/png' ? 'png' : 'jpg'}`
      const record: ChannelPosterRecord = {
        kind: 'briefing-poster',
        editionId,
        fileName,
        mime: actual,
        byteLength: input.bytes.byteLength,
        createdAt: deps.now()
      }
      await mkdir(deps.directory, { recursive: true })
      await writeFile(join(deps.directory, fileName), input.bytes)
      // ④ 来源记录按 `editionId` 唯一：同一版覆盖这一版的海报，不累积。
      const records = await loadRecords()
      records[editionId] = record
      await saveRecords(records)
      // 顺手清理过期记录（7 天窗口）：写入路径不需要额外的维护任务也能收敛。
      await prune()
      return { ok: true, record }
    },

    async has(edition) {
      const record = (await loadRecords())[channelPosterEditionId(edition)]
      return record !== undefined && !expired(record, deps.now())
    },

    async read(edition) {
      const editionId = channelPosterEditionId(edition)
      const record = (await loadRecords())[editionId]
      if (record === undefined) return { ok: false, code: 'delivery-image-unavailable', detail: 'missing' }
      // 记录绑定的版本必须就是这次发布：拿上一版的记录去发，就是把旧图当成新图。
      if (record.editionId !== editionId) {
        return { ok: false, code: 'delivery-image-source-not-allowed', detail: 'edition-mismatch' }
      }
      if (expired(record, deps.now())) {
        return { ok: false, code: 'delivery-image-unavailable', detail: 'expired' }
      }
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(await readFile(join(deps.directory, record.fileName)))
      } catch {
        // 「在但读不出来」与「没有」分开。
        return { ok: false, code: 'delivery-image-unavailable', detail: 'read-failed' }
      }
      const actual = sniffImageMime(bytes)
      if (actual !== 'image/png' && actual !== 'image/jpeg') {
        return { ok: false, code: 'delivery-image-unsupported', detail: `actual=${actual ?? 'unknown'}` }
      }
      return { ok: true, bytes, mime: actual, record }
    },

    prune
  }
}

/**
 * 进程内的那一份（组合根建一次，产品 IPC 取同一个实例）。
 *
 * 为什么用注册表而不是层层传参：`publishToPhone` 是产品 IPC，产品侧拿不到主进程装配对象；
 * 而海报暂存区必须只有**一份**（两处各建一个目录就会有两套记录）。取不到时调用方必须当作
 * 「没有暂存区」处理（`delivery-image-unavailable`），不许自己造一个临时目录顶上。
 */
let configured: ChannelPosterOutbox | null = null

export function configureChannelPosterOutbox(outbox: ChannelPosterOutbox | null): void {
  configured = outbox
}

export function getChannelPosterOutbox(): ChannelPosterOutbox | null {
  return configured
}
