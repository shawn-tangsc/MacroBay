/**
 * 简报海报的**只读取图入口**（方案 §12.3）。
 *
 * 为什么用注册表而不是直接 import：海报表与文件都在简报侧（`briefing_posters` + `briefing-posters/`
 * 目录，归简报线），而用它的是通知推送执行器（平台侧）。推送路径只认「按内容 hash 取一张图」这一件事，
 * 不 import 简报的表、也不碰它的目录——两侧各自可回退（回退 = 不注册，行为回到只发正文）。
 *
 * 三种结果分得开，**不许合成一种**（方案 §12.5 第 3 条）：
 * - `poster-not-found`：这一版从没出过图，或行已被保留期删掉 → 调用方按「这张图不许发」处理；
 * - `read-failed`：行在、文件缺失或读不出来 → 按「拿不到」处理；
 * - `ok`：字节 + 声明 mime（真实格式由调用方按字节签名再判一次）。
 */
export type BriefingPosterReadOutcome =
  | { ok: false; code: 'poster-not-found'; detail: string }
  | { ok: false; code: 'read-failed'; detail: 'missing' | 'read-failed' }
  | { ok: true; mime: string; bytes: Uint8Array }

export type BriefingPosterRead = (contentHash: string) => Promise<BriefingPosterReadOutcome>

let configured: BriefingPosterRead | null = null

/** 简报线在装配时注册；传 `null` 撤回（那一支随即一律「拿不到」，不猜）。 */
export function configureBriefingPosterRead(read: BriefingPosterRead | null): void {
  configured = read
}

export function getBriefingPosterRead(): BriefingPosterRead | null {
  return configured
}