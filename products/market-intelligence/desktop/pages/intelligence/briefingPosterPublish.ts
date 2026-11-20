import { toPng } from 'html-to-image'

import { MAX_CHANNEL_IMAGE_CAPTION_CHARS } from '@platform/ai/agent-platform/channels/channelImageDelivery'

import { BRIEFING_PAPER_WIDTH, posterExportBackground } from './dailyBriefingExport'

/**
 * 发布到频道前，海报这一半：**渲染一次、判一次、拿不出字节就不发**。
 *
 * 三个数各有出处，不在这里另编：
 * - **宽度 1080、`pixelRatio: 1`**：渠道要的是「纸宽 1080 的那一张」。下载版仍是 2x——两个用途
 *   两种参数，不共用（共用就是二选一，任何一个都会错）。
 * - **导读上限 1024 字符**：直接读渠道侧那个常量（`MAX_CHANNEL_IMAGE_CAPTION_CHARS`），
 *   并按**码点**数，与主进程的 `[...caption].length` 同一种数法——两边数法不同会一边放行一边拒。
 * - **字节上限 8 MiB**：主进程暂存区（`channelPosterOutbox.MAX_CHANNEL_POSTER_BYTES`）的镜像，
 *   那个文件 import 了 `node:fs`，渲染层取不到，所以这里留一份并在用例里钉住两个数相等。
 */
export const BRIEFING_PUBLISH_POSTER_MAX_BYTES = 8 * 1024 * 1024
export const BRIEFING_PUBLISH_CAPTION_MAX_CHARS = MAX_CHANNEL_IMAGE_CAPTION_CHARS

export type BriefingPosterBytes = Readonly<{ bytes: Uint8Array; mime: 'image/png' }>

/**
 * 一次发布前能得出的五种事实。`ready` 是「不带图发」（读者选只发文字，或这一版没有海报节点）。
 */
export type BriefingPublishPreparation =
  | Readonly<{ kind: 'ready' }>
  | Readonly<{ kind: 'ready-with-poster'; poster: BriefingPosterBytes }>
  | Readonly<{ kind: 'poster-render-failed' }>
  | Readonly<{ kind: 'poster-too-large'; byteLength: number }>
  | Readonly<{ kind: 'caption-too-long'; chars: number }>

/** 注入点：用例里换成假渲染，不真的画图（图渲染在无头环境里既慢又不确定）。 */
export type BriefingPosterRenderer = (root: HTMLElement) => Promise<BriefingPosterBytes | undefined>

/**
 * 渲染发布用的海报：1080 宽、1x。
 *
 * 量到 0 宽＝没有布局（用例环境），照常渲染；量到别的宽度就是别的产物（屏幕上被缩放过的纸），
 * 直接判失败——宁可一次不发，也不发一张尺寸不对、看起来还成功的图。
 */
export async function renderBriefingPosterPng(root: HTMLElement): Promise<BriefingPosterBytes | undefined> {
  const poster = root.querySelector<HTMLElement>('.mi-brief-poster') ?? root
  const measured = Math.round(poster.getBoundingClientRect().width)
  if (measured > 0 && measured !== BRIEFING_PAPER_WIDTH) return undefined
  const paper = posterExportBackground(poster)
  try {
    const dataUrl = await toPng(poster, {
      width: BRIEFING_PAPER_WIDTH,
      // 下载版是 2x；发布版只要 1x——渠道会把图再压一次，2x 只会让字节翻倍。
      pixelRatio: 1,
      cacheBust: true,
      ...(paper ? { backgroundColor: paper } : {})
    })
    const bytes = dataUrlToBytes(dataUrl)
    return bytes === undefined ? undefined : { bytes, mime: 'image/png' }
  } catch {
    return undefined
  }
}

/**
 * 发布前的一次判定，顺序固定（便宜的先判）：
 * 1. 导读超长 → 整条不发、**不渲染**、不截断（截断等于给读者半句话）；
 * 2. 没有海报节点 → 不带图发（只发文字的既有路径）；
 * 3. 渲染失败 → `poster-render-failed`，调用方一次 IPC 都不发；
 * 4. 字节超限 → `poster-too-large`，同上（主进程还会再判一次，这里先拒是为了给得出「多大算大」）。
 */
export async function prepareBriefingPublish(input: Readonly<{
  caption: string
  /** 屏幕上的海报根节点；没有就不带图。 */
  posterRoot: HTMLElement | null
  /** 用例注入；缺省走 `renderBriefingPosterPng`。 */
  render?: BriefingPosterRenderer
}>): Promise<BriefingPublishPreparation> {
  const chars = [...input.caption].length
  if (chars > BRIEFING_PUBLISH_CAPTION_MAX_CHARS) return { kind: 'caption-too-long', chars }
  if (input.posterRoot === null) return { kind: 'ready' }
  const render = input.render ?? renderBriefingPosterPng
  let poster: BriefingPosterBytes | undefined
  try {
    poster = await render(input.posterRoot)
  } catch {
    poster = undefined
  }
  if (poster === undefined || poster.bytes.byteLength === 0) return { kind: 'poster-render-failed' }
  if (poster.bytes.byteLength > BRIEFING_PUBLISH_POSTER_MAX_BYTES) {
    return { kind: 'poster-too-large', byteLength: poster.bytes.byteLength }
  }
  return { kind: 'ready-with-poster', poster }
}

/** dataURL → 字节。解不出来就是渲染失败（不拿一个空字节数组冒充成功）。 */
function dataUrlToBytes(dataUrl: string): Uint8Array | undefined {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return undefined
  try {
    const binary = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes.byteLength === 0 ? undefined : bytes
  } catch {
    return undefined
  }
}
