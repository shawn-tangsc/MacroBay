import type { BriefingPosterFiles } from './briefingPosterFiles'
import type { BriefingPosterStore } from './briefingPosterStore'

/**
 * 简报海报的**只读取图入口**：通道侧来源校验的简报那一支只调这里。
 *
 * 判据的顺序不是实现细节：**先查行、再读盘**。按 hash 拼路径、文件在就算，等于让任何拿到
 * 哈希的代码都能对外发图（而且会把保留下来的旧文件当成有效产物）。行不在就是「不算数」，
 * 不是「文件没找到」——两者给读者的下一步动作不同。
 *
 * 三个出口与文档 §12.3 一一对应：
 * - 行不在 / 不是 ready → `delivery-image-source-not-allowed`（detail `poster-not-found`）；
 * - 行在、文件不在 → `delivery-image-unavailable`（detail `missing`）；
 * - 行在、读盘抛错 → `delivery-image-unavailable`（detail `read-failed`）。
 *
 * 「没有」与「拿不到」在这里就已经分开，投递层不需要知道海报是什么。
 */
export type BriefingPosterSourceResult =
  | Readonly<{ ok: true; mime: string; bytes: Uint8Array }>
  | Readonly<{
    ok: false
    code: 'delivery-image-source-not-allowed' | 'delivery-image-unavailable'
    detail: string
  }>

export type BriefingPosterSource = Readonly<{
  /** 只认内容 hash：不接受文件名，也不接受「当前版次」这种会漂移的输入。 */
  read: (contentHash: string) => Promise<BriefingPosterSourceResult>
}>

/**
 * 通道侧注册口要的那一种形状（`poster-not-found` / `read-failed`），在这里翻译一次。
 *
 * 两个词表不合并：通道侧要知道「这张图不许发」还是「拿不到」，而投递层只知道投递失败码。
 * 翻译只在这一处，调用点不各自判码。
 */
export function toBriefingPosterRead(
  source: BriefingPosterSource
): (contentHash: string) => Promise<
  | Readonly<{ ok: true; mime: string; bytes: Uint8Array }>
  | Readonly<{ ok: false; code: 'poster-not-found'; detail: string }>
  | Readonly<{ ok: false; code: 'read-failed'; detail: 'missing' | 'read-failed' }>
> {
  return async (contentHash) => {
    const result = await source.read(contentHash)
    if (result.ok) return result
    if (result.code === 'delivery-image-source-not-allowed') {
      return { ok: false, code: 'poster-not-found', detail: result.detail }
    }
    return {
      ok: false,
      code: 'read-failed',
      detail: result.detail === 'missing' ? 'missing' : 'read-failed'
    }
  }
}

export function createBriefingPosterSource(input: Readonly<{
  store: Pick<BriefingPosterStore, 'byContentHash'>
  files: Pick<BriefingPosterFiles, 'read'>
}>): BriefingPosterSource {
  return {
    async read(contentHash) {
      const row = input.store.byContentHash(contentHash)
      // 行在但状态不是 ready（失败/超时留下的证据行）同样是「不算数」：那种行没有 hash，
      // 走到这里说明调用方拿了一个不该拿的 hash。
      if (!row || row.status !== 'ready' || row.contentHash !== contentHash) {
        return { ok: false, code: 'delivery-image-source-not-allowed', detail: 'poster-not-found' }
      }

      let stored: { bytes: Uint8Array; mime: string } | null
      try {
        stored = await input.files.read(contentHash)
      } catch {
        return { ok: false, code: 'delivery-image-unavailable', detail: 'read-failed' }
      }
      if (!stored) return { ok: false, code: 'delivery-image-unavailable', detail: 'missing' }
      return { ok: true, mime: stored.mime, bytes: stored.bytes }
    }
  }
}