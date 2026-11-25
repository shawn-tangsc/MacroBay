import type { NotificationApprovedLevel } from '../contracts/notificationEventCatalog'
import type { EditionPosterRow } from '../contracts/notificationContracts'

/**
 * 记录里几个「结构化字段」的归一化（从 `notificationStore` 里抽出来：那个文件已经贴着 500 行硬线）。
 *
 * 共同的判据：**认不出的值整项丢掉，不留半截**——半个期次身份、空的内容 hash 比没有更糟，
 * 它们会让下游拿一个永远对不上的键去查。三个函数都是纯函数，单独测。
 */

/**
 * 生效档位快照：闭集过滤，认不出的值丢掉；一项都不剩时返回 undefined（=老记录，交给读侧推断），
 * **不返回空数组**——空数组的意思是「哪一档都没排上」，与「不知道」是两件事。
 */
export function normalizeAppliedLevels(value: unknown): readonly NotificationApprovedLevel[] | undefined {
  if (!Array.isArray(value)) return undefined
  const allowed: readonly NotificationApprovedLevel[] = ['center', 'toast', 'popup', 'desktop', 'channel']
  const levels = value.filter((item): item is NotificationApprovedLevel => allowed.includes(item as NotificationApprovedLevel))
  return levels.length === 0 ? undefined : [...new Set(levels)]
}

/** 期次身份：`editionId` 非空、`locale` 只认中英两个值；缺一个就整项丢掉（半个身份比没有更糟）。 */
export function normalizeEdition(value: unknown): { editionId: string; locale: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { editionId?: unknown; locale?: unknown }
  const editionId = typeof candidate.editionId === 'string' ? candidate.editionId.trim() : ''
  const locale = candidate.locale === 'zh-CN' || candidate.locale === 'en-US' ? candidate.locale : undefined
  if (editionId.length === 0 || locale === undefined) return undefined
  return { editionId, locale }
}

/** 海报内容 hash：非空字符串才算；空串会让「按 hash 取图」查到一个永远找不到的文件。 */
export function normalizeEditionPoster(value: unknown): { contentHash: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const contentHash = (value as { contentHash?: unknown }).contentHash
  if (typeof contentHash !== 'string' || contentHash.trim().length === 0) return undefined
  return { contentHash: contentHash.trim() }
}

/**
 * 推送那一刻的海报表行（#46）。**三种返回值**，不许合并：
 * - `null`：那一刻表里没有行（这一版没有图，不是失败）——这是事实，要保住；
 * - `undefined`：没有这个字段（老记录、非简报推送）＝不知道；
 * - 对象：行在，只认三档 `status`；`ready` 必须带非空 hash（推送按它取图，没 hash 的 ready 说不通）。
 */
export function normalizeEditionPosterRow(value: unknown): EditionPosterRow | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { status?: unknown; contentHash?: unknown; failureCode?: unknown }
  const status = candidate.status === 'ready' || candidate.status === 'failed' || candidate.status === 'timeout'
    ? candidate.status
    : undefined
  if (status === undefined) return undefined
  const hash = typeof candidate.contentHash === 'string' ? candidate.contentHash.trim() : ''
  const code = typeof candidate.failureCode === 'string' ? candidate.failureCode.trim() : ''
  // 只有 ready 有 hash；失败两档的码原样留（`poster-render-timeout` 等），不给就 null。
  if (status === 'ready') return hash.length === 0 ? undefined : { status, contentHash: hash, failureCode: null }
  return { status, contentHash: null, failureCode: code.length === 0 ? null : code }
}
